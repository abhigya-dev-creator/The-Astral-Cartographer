import fs from 'fs';
import path from 'path';
import { isNodeBuiltin, TS_EXTS } from './languages.js';
import { PYTHON_STDLIB } from './pythonStdlib.js';
import type { PyImport } from './lightAnalyzers.js';

const posix = path.posix;

export type Resolution =
  | { kind: 'local'; target: string; via: 'relative' | 'alias' | 'baseUrl' | 'workspace' | 'imports' }
  | { kind: 'asset' }
  | { kind: 'builtin'; name: string }
  | { kind: 'external'; name: string }
  | { kind: 'url' }
  | { kind: 'unresolved'; reason: 'relative' | 'alias' | 'workspace' | 'absolute' };

interface TsAliasConfig {
  /** repo-relative directory that `paths` targets are relative to (effective baseUrl, else the config that defined `paths`) */
  pathsBase: string;
  /** directory of the config file that declared `paths` */
  pathsDir: string;
  baseUrl: string | null;
  paths: Record<string, string[]>;
}

interface WorkspacePkg {
  name: string;
  dir: string;
  pkg: any;
}

export interface ResolveContext {
  repoDir: string;
  /** Optional: returns a repo-relative file's text (null = missing). When absent, files are read from disk under repoDir. */
  readText?: (rel: string) => string | null;
  fileSet: Set<string>;
  /** files that exist on disk but were excluded from analysis (images, fonts, lockfiles, …) */
  assetSet: Set<string>;
  dirSet: Set<string>;
  declaredDeps: Set<string>;
  workspaces: Map<string, WorkspacePkg>;
  /** config directory -> alias configs that apply to files inside it (own config + referenced configs) */
  aliasConfigs: Map<string, TsAliasConfig[]>;
  /** package.json directory -> `imports` map */
  packageImports: Map<string, Record<string, any>>;
  stats: { tsconfigs: number; workspacePackages: number; parseErrors: string[] };
}

// ---------------------------------------------------------------------------------------------
// JSONC (tsconfig) parsing
// ---------------------------------------------------------------------------------------------
export function parseJsonc(text: string): any {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  out = out.replace(/^\uFEFF/, '').replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

function readJson(ctx: { repoDir: string; readText?: (rel: string) => string | null }, rel: string, jsonc: boolean): any | null {
  try {
    const raw = ctx.readText ? ctx.readText(rel) : fs.readFileSync(path.join(ctx.repoDir, rel), 'utf-8');
    if (raw === null) return null;
    return jsonc ? parseJsonc(raw) : JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Context construction
// ---------------------------------------------------------------------------------------------
export function buildResolveContext(
  repoDir: string,
  fileSet: Set<string>,
  assetSet: Set<string>,
  readText?: (rel: string) => string | null
): ResolveContext {
  const dirSet = new Set<string>(['']);
  for (const f of [...fileSet, ...assetSet]) {
    let d = posix.dirname(f);
    while (d !== '.' && d !== '' && !dirSet.has(d)) {
      dirSet.add(d);
      d = posix.dirname(d);
    }
  }
  dirSet.add('.');

  const ctx: ResolveContext = {
    repoDir,
    readText,
    fileSet,
    assetSet,
    dirSet,
    declaredDeps: new Set(),
    workspaces: new Map(),
    aliasConfigs: new Map(),
    packageImports: new Map(),
    stats: { tsconfigs: 0, workspacePackages: 0, parseErrors: [] },
  };

  const files = [...fileSet].sort();

  // package.json files: declared dependencies, workspace packages, `imports`
  for (const f of files) {
    if (posix.basename(f) !== 'package.json') continue;
    const pkg = readJson(ctx, f, false);
    if (!pkg || typeof pkg !== 'object') {
      ctx.stats.parseErrors.push(f);
      continue;
    }
    const dir = posix.dirname(f) === '.' ? '' : posix.dirname(f);
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const name of Object.keys(pkg[key] || {})) ctx.declaredDeps.add(name);
    }
    if (typeof pkg.name === 'string' && pkg.name && !ctx.workspaces.has(pkg.name)) {
      ctx.workspaces.set(pkg.name, { name: pkg.name, dir, pkg });
    }
    if (pkg.imports && typeof pkg.imports === 'object') ctx.packageImports.set(dir, pkg.imports);
  }
  ctx.stats.workspacePackages = ctx.workspaces.size;

  // tsconfig / jsconfig
  const loadCache = new Map<string, TsAliasConfig | null>();
  const loadConfig = (rel: string, depth: number): TsAliasConfig | null => {
    if (loadCache.has(rel)) return loadCache.get(rel)!;
    loadCache.set(rel, null);
    if (depth > 8 || !fileSet.has(rel)) return null;
    const json = readJson(ctx, rel, true);
    if (!json || typeof json !== 'object') {
      ctx.stats.parseErrors.push(rel);
      return null;
    }
    const dir = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);
    let inheritedBaseUrl: string | null = null;
    let inheritedPaths: Record<string, string[]> = {};
    let inheritedPathsDir = dir;

    const ext = json.extends;
    for (const e of Array.isArray(ext) ? ext : ext ? [ext] : []) {
      if (typeof e !== 'string' || !(e.startsWith('.') || e.startsWith('/'))) continue; // package presets carry no alias info
      let target = posix.normalize(posix.join(dir, e));
      if (!fileSet.has(target) && fileSet.has(`${target}.json`)) target += '.json';
      const parent = loadConfig(target, depth + 1);
      if (parent) {
        if (parent.baseUrl !== null) inheritedBaseUrl = parent.baseUrl;
        if (Object.keys(parent.paths).length) {
          inheritedPaths = parent.paths;
          inheritedPathsDir = parent.pathsDir;
        }
      }
    }

    const co = json.compilerOptions || {};
    let baseUrl = inheritedBaseUrl;
    if (typeof co.baseUrl === 'string') baseUrl = normalizeRel(posix.join(dir, co.baseUrl));
    let paths = inheritedPaths;
    let pathsDir = inheritedPathsDir;
    if (co.paths && typeof co.paths === 'object') {
      paths = co.paths;
      pathsDir = dir;
    }
    const cfg: TsAliasConfig = { pathsBase: baseUrl !== null ? baseUrl : pathsDir, pathsDir, baseUrl, paths };
    loadCache.set(rel, cfg);
    return cfg;
  };

  for (const f of files) {
    const base = posix.basename(f);
    if (base !== 'tsconfig.json' && base !== 'jsconfig.json') continue;
    const dir = posix.dirname(f) === '.' ? '' : posix.dirname(f);
    if (ctx.aliasConfigs.has(dir) && base === 'jsconfig.json') continue; // tsconfig wins
    const json = readJson(ctx, f, true);
    const own = loadConfig(f, 0);
    if (!own) continue;
    ctx.stats.tsconfigs++;
    const list: TsAliasConfig[] = [own];
    for (const ref of json?.references || []) {
      if (!ref || typeof ref.path !== 'string') continue;
      let t = posix.normalize(posix.join(dir, ref.path));
      if (!t.endsWith('.json')) t = posix.join(t, 'tsconfig.json');
      const refCfg = loadConfig(t, 1);
      if (refCfg) list.push(refCfg);
    }
    ctx.aliasConfigs.set(dir, list);
  }

  return ctx;
}

// ---------------------------------------------------------------------------------------------
// File resolution helpers
// ---------------------------------------------------------------------------------------------
const TS_FIRST = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json'];
const JS_FIRST = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.mts', '.cts', '.d.ts'];
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts'],
};

function normalizeRel(p: string): string {
  const n = posix.normalize(p).replace(/^\.\//, '');
  return n === '.' ? '' : n;
}

/** Resolve a path (without knowing extension) to a file in the repository, Node + TypeScript style. */
export function resolveFile(ctx: ResolveContext, base: string, importerIsTs: boolean): string | null {
  // Node semantics: a trailing slash ('./utils/') names a directory, so only its index file can match
  const dirOnly = /\/$/.test(base);
  const p = normalizeRel(base).replace(/\/+$/, '');
  if (p.startsWith('..')) return null;
  const files = ctx.fileSet;
  if (p && !dirOnly && files.has(p)) return p;

  // TypeScript ESM: `./x.js` actually refers to `./x.ts`
  const ext = dirOnly ? '' : posix.extname(p);
  if (JS_TO_TS[ext]) {
    const stem = p.slice(0, -ext.length);
    for (const e of JS_TO_TS[ext]) if (files.has(stem + e)) return stem + e;
  }

  const order = importerIsTs ? TS_FIRST : JS_FIRST;
  if (!dirOnly) for (const e of order) if (p && files.has(p + e)) return p + e;
  const dirPrefix = p ? `${p}/` : '';
  for (const e of order) if (files.has(`${dirPrefix}index${e}`)) return `${dirPrefix}index${e}`;
  return null;
}

function assetExists(ctx: ResolveContext, p: string): boolean {
  const n = normalizeRel(p);
  return !!n && !n.startsWith('..') && (ctx.assetSet.has(n) || ctx.fileSet.has(n));
}

function packageNameOf(spec: string): string {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

function nearestAliasConfigs(ctx: ResolveContext, importer: string): TsAliasConfig[] {
  let dir = posix.dirname(importer);
  if (dir === '.') dir = '';
  for (;;) {
    const c = ctx.aliasConfigs.get(dir);
    if (c) return c;
    if (dir === '') return [];
    dir = posix.dirname(dir);
    if (dir === '.') dir = '';
  }
}

function matchPaths(spec: string, paths: Record<string, string[]>): string[][] {
  // longest matching prefix first, exactly as TypeScript does
  const hits: Array<{ len: number; targets: string[] }> = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (pattern === spec) hits.push({ len: pattern.length, targets: targets.slice() });
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length) {
        const captured = spec.slice(prefix.length, spec.length - suffix.length);
        hits.push({ len: prefix.length, targets: targets.map((t) => t.replace('*', captured)) });
      }
    }
  }
  return hits.sort((a, b) => b.len - a.len).map((h) => h.targets);
}

function firstStringLeaf(v: any, prefer: string[] = ['import', 'module', 'default', 'require', 'types']): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = firstStringLeaf(x, prefer);
      if (r) return r;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const k of prefer) if (k in v) { const r = firstStringLeaf(v[k], prefer); if (r) return r; }
    for (const k of Object.keys(v)) { const r = firstStringLeaf(v[k], prefer); if (r) return r; }
  }
  return null;
}

function resolveWorkspace(ctx: ResolveContext, spec: string, importerIsTs: boolean): string | null | undefined {
  const name = packageNameOf(spec);
  const ws = ctx.workspaces.get(name);
  if (!ws) return undefined; // not a workspace package
  const sub = spec.slice(name.length).replace(/^\//, '');
  const dir = ws.dir;
  const join = (...p: string[]) => normalizeRel(posix.join(dir, ...p));
  const cands: string[] = [];

  if (sub) {
    const exp = ws.pkg.exports?.[`./${sub}`];
    const leaf = firstStringLeaf(exp);
    if (leaf) cands.push(join(leaf));
    cands.push(join(sub), join('src', sub), join('lib', sub));
  } else {
    const exp = ws.pkg.exports;
    const leaf = firstStringLeaf(exp && typeof exp === 'object' && '.' in exp ? exp['.'] : exp);
    for (const v of [leaf, ws.pkg.source, ws.pkg.module, ws.pkg.main, ws.pkg.types, ws.pkg.typings]) {
      if (typeof v === 'string') cands.push(join(v));
    }
    cands.push(join('src', 'index'), join('source', 'index'), join('index'), join('src', 'main'), join('lib', 'index'));
  }
  for (const c of cands) {
    const direct = resolveFile(ctx, c, importerIsTs);
    if (direct) return direct;
    // The entry usually points at built output ("distribution/index.js", "dist/x.d.ts") that is not part of the
    // source tree. Map "<anything>/<rest>" to "src|source|lib/<rest>" with the build extension removed.
    const rel = posix.relative(dir || '.', c);
    const segs = rel.split('/');
    if (segs.length >= 2 && !rel.startsWith('..')) {
      const rest = segs.slice(1).join('/').replace(/\.d\.[cm]?ts$|\.[cm]?[jt]sx?$/, '');
      for (const srcDir of ['src', 'source', 'lib']) {
        const alt = resolveFile(ctx, join(srcDir, rest), importerIsTs);
        if (alt) return alt;
      }
    }
  }
  return null;
}

function resolvePackageImports(ctx: ResolveContext, importer: string, spec: string, importerIsTs: boolean): string | null | undefined {
  let dir = posix.dirname(importer);
  if (dir === '.') dir = '';
  for (;;) {
    const map = ctx.packageImports.get(dir);
    if (map) {
      for (const [key, value] of Object.entries(map)) {
        const star = key.indexOf('*');
        let captured: string | null = null;
        if (star === -1) { if (key === spec) captured = ''; }
        else if (spec.startsWith(key.slice(0, star)) && spec.endsWith(key.slice(star + 1))) {
          captured = spec.slice(star, spec.length - (key.length - star - 1));
        }
        if (captured === null) continue;
        const leaf = firstStringLeaf(value, ['import', 'default', 'node', 'require']);
        if (!leaf) return null;
        if (!leaf.startsWith('.')) return undefined; // maps to an external package
        return resolveFile(ctx, posix.join(dir, leaf.replace('*', captured)), importerIsTs);
      }
      return null;
    }
    if (dir === '') return null;
    dir = posix.dirname(dir);
    if (dir === '.') dir = '';
  }
}

// ---------------------------------------------------------------------------------------------
// JS / TS resolution
// ---------------------------------------------------------------------------------------------
const ALIAS_LIKE = /^(?:@\/|~\/|~$|@$|#|\$lib\/|\$lib$)/;

export function cleanSpecifier(raw: string): string {
  let s = raw.trim();
  const bang = s.lastIndexOf('!'); // webpack loader syntax: `style-loader!css-loader!./a.css`
  if (bang !== -1) s = s.slice(bang + 1);
  const q = s.search(/[?]/); // `./icon.svg?react`, `./a?raw`
  if (q > 0) s = s.slice(0, q);
  return s;
}

export function resolveJsImport(ctx: ResolveContext, importer: string, rawSpec: string): Resolution {
  const spec = cleanSpecifier(rawSpec);
  const importerIsTs = TS_EXTS.has(posix.extname(importer));
  if (!spec) return { kind: 'unresolved', reason: 'relative' };

  if (/^(?:https?:)?\/\//i.test(spec) || /^(?:data|blob):/i.test(spec)) return { kind: 'url' };

  if (spec.startsWith('node:')) return { kind: 'builtin', name: spec.slice(5) };

  const importerDir = posix.dirname(importer) === '.' ? '' : posix.dirname(importer);

  // relative
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    const base = posix.join(importerDir, spec);
    const target = resolveFile(ctx, base, importerIsTs);
    if (target) return { kind: 'local', target, via: 'relative' };
    if (assetExists(ctx, base)) return { kind: 'asset' };
    return { kind: 'unresolved', reason: 'relative' };
  }

  // absolute (web-root style, e.g. "/src/main.tsx")
  if (spec.startsWith('/')) {
    const base = spec.slice(1);
    const target = resolveFile(ctx, base, importerIsTs);
    if (target) return { kind: 'local', target, via: 'relative' };
    if (assetExists(ctx, base)) return { kind: 'asset' };
    return { kind: 'unresolved', reason: 'absolute' };
  }

  // tsconfig/jsconfig `paths` and `baseUrl`
  const configs = nearestAliasConfigs(ctx, importer);
  for (const cfg of configs) {
    for (const targetGroup of matchPaths(spec, cfg.paths)) {
      for (const t of targetGroup) {
        const base = posix.join(cfg.pathsBase, t);
        const target = resolveFile(ctx, base, importerIsTs);
        if (target) return { kind: 'local', target, via: 'alias' };
        if (assetExists(ctx, base)) return { kind: 'asset' };
      }
    }
  }
  for (const cfg of configs) {
    if (cfg.baseUrl !== null) {
      const target = resolveFile(ctx, posix.join(cfg.baseUrl, spec), importerIsTs);
      if (target) return { kind: 'local', target, via: 'baseUrl' };
    }
  }

  // package.json "imports" (#subpath)
  if (spec.startsWith('#')) {
    const r = resolvePackageImports(ctx, importer, spec, importerIsTs);
    if (typeof r === 'string') return { kind: 'local', target: r, via: 'imports' };
    return { kind: 'unresolved', reason: 'alias' };
  }

  // monorepo workspace packages
  const ws = resolveWorkspace(ctx, spec, importerIsTs);
  if (typeof ws === 'string') return { kind: 'local', target: ws, via: 'workspace' };
  if (ws === null) return { kind: 'unresolved', reason: 'workspace' };

  // bundler aliases we cannot evaluate (`@/`, `~/`, `$lib/`): never count them as npm packages
  if (ALIAS_LIKE.test(spec)) return { kind: 'unresolved', reason: 'alias' };

  // built-ins. A bare name that the project explicitly declares as a dependency is the npm package (e.g. `events`).
  const parts = spec.split('/');
  const root = parts[0];
  let builtinName: string | null = null;
  if (isNodeBuiltin(spec, false)) builtinName = spec; // 'fs', 'fs/promises', 'assert/strict'
  else if (parts.length > 2 && isNodeBuiltin(`${parts[0]}/${parts[1]}`, false)) builtinName = `${parts[0]}/${parts[1]}`;
  if (builtinName && !ctx.declaredDeps.has(root)) return { kind: 'builtin', name: builtinName };

  // deno-style prefixes: npm:chalk@5, jsr:@std/path@1
  const prefixed = /^(?:npm|jsr):(.+)$/.exec(spec);
  const pkgSpec = prefixed ? prefixed[1] : spec;
  let name = packageNameOf(pkgSpec);
  if (prefixed) name = name.replace(/(?<=[^/])@[^@/]*$/, '');
  return { kind: 'external', name };
}

// ---------------------------------------------------------------------------------------------
// Python resolution
// ---------------------------------------------------------------------------------------------
export type PyResolution =
  | { kind: 'local'; targets: string[] }
  | { kind: 'builtin'; name: string }
  | { kind: 'external'; name: string }
  | { kind: 'unresolved' };

function pyModuleFile(ctx: ResolveContext, baseDir: string, parts: string[]): string | null {
  const stem = normalizeRel(posix.join(baseDir, ...parts));
  if (parts.length === 0) {
    // the package directory itself
    const init = stem === '' ? '__init__.py' : `${stem}/__init__.py`;
    return ctx.fileSet.has(init) ? init : null;
  }
  for (const c of [`${stem}.py`, `${stem}.pyi`, `${stem}/__init__.py`, `${stem}/__init__.pyi`]) {
    if (ctx.fileSet.has(c)) return c;
  }
  return null;
}

function pyPackageRoot(ctx: ResolveContext, importer: string): string {
  let dir = posix.dirname(importer) === '.' ? '' : posix.dirname(importer);
  while (dir !== '' && ctx.fileSet.has(`${dir}/__init__.py`)) {
    dir = posix.dirname(dir) === '.' ? '' : posix.dirname(dir);
  }
  return dir;
}

export function resolvePythonImport(ctx: ResolveContext, importer: string, imp: PyImport): PyResolution {
  const parts = imp.module ? imp.module.split('.') : [];
  const importerDir = posix.dirname(importer) === '.' ? '' : posix.dirname(importer);

  /**
   * `import a.b.c` / `from a.b import x, y`: the target is the module file; for `from pkg import name` a
   * `name` that is itself a submodule file is linked instead of (or in addition to) the package __init__.
   */
  const withSubmodules = (baseDir: string, modParts: string[]): string[] => {
    const modFile = pyModuleFile(ctx, baseDir, modParts);
    const pkgDir = normalizeRel(posix.join(baseDir, ...modParts));
    const out = new Set<string>();
    let nonSubmoduleName = imp.names.length === 0;
    for (const name of imp.names) {
      const sub = name === '*' ? null : pyModuleFile(ctx, pkgDir, [name]);
      if (sub) out.add(sub);
      else nonSubmoduleName = true;
    }
    if (modFile && nonSubmoduleName) out.add(modFile);
    return [...out];
  };

  if (imp.level > 0) {
    let base = importerDir;
    for (let i = 1; i < imp.level; i++) {
      if (base === '') return { kind: 'unresolved' };
      base = posix.dirname(base) === '.' ? '' : posix.dirname(base);
    }
    const targets = withSubmodules(base, parts).filter((t) => t !== importer);
    return targets.length ? { kind: 'local', targets } : { kind: 'unresolved' };
  }

  const top = parts[0];
  if (!top) return { kind: 'unresolved' };

  // Absolute imports never resolve against a *package's* own directory in Python 3 (so `import logging` inside
  // flask/ is the stdlib, not flask/logging.py); plain script directories are on sys.path, so they are included.
  const importerIsPackage = ctx.fileSet.has(importerDir ? `${importerDir}/__init__.py` : '__init__.py');
  const roots = [...new Set(['', 'src', 'lib', 'app', pyPackageRoot(ctx, importer), ...(importerIsPackage ? [] : [importerDir])])];
  const topLocal = roots.some((r) => {
    const stem = normalizeRel(posix.join(r, top));
    return ctx.fileSet.has(`${stem}.py`) || ctx.dirSet.has(stem);
  });

  for (const root of roots) {
    const targets = withSubmodules(root, parts).filter((t) => t !== importer);
    if (targets.length) return { kind: 'local', targets };
  }
  if (!topLocal && PYTHON_STDLIB.has(top)) return { kind: 'builtin', name: top };
  if (topLocal) return { kind: 'unresolved' };
  return { kind: 'external', name: top };
}
