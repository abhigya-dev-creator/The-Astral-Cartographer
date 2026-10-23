import path from 'path';
import { buildResolveContext, resolveJsImport, type Resolution } from '../analysis/resolver.js';
import { stronglyConnected } from '../analysis/architecture.js';
import { extractFile } from './extract.js';
import { javaDependencies } from './javaDeps.js';
import type { AtlasData, AtlasRepo, Edge, FileNode, SkippedEntry } from './types.js';

const posix = path.posix;

/** One repository file. `text: null` = binary or unreadable (kept in the structure, no lines). */
export interface SourceFile {
  path: string;
  text: string | null;
  /** bytes; defaults to the UTF-8 length of `text` */
  size?: number;
}

export interface AtlasInput {
  repo: Omit<AtlasRepo, 'analyzedAt'> & { analyzedAt?: string };
  files: SourceFile[];
  /** entries the caller already skipped (e.g. ignored directories it never read) */
  skipped?: SkippedEntry[];
}

export const ATLAS_LIMITS = { MAX_FILE_BYTES: 1024 * 1024 };
export const CODE_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.java']);
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const MINIFIED = /\.min\.[cm]?js$/i;
const DECLARATION = /\.d\.[cm]?ts$/i;

const UNRESOLVED_REASON: Record<Extract<Resolution, { kind: 'unresolved' }>['reason'], string> = {
  relative: 'file not found',
  absolute: 'file not found',
  alias: 'alias not defined in tsconfig/jsconfig paths',
  workspace: 'workspace package entry not found',
};

/** Why a path is excluded, or null if it is analysed. Shared by the folder loader so both agree. */
export function skipReason(p: string, size: number): SkippedEntry['reason'] | null {
  const segs = p.split('/');
  if (segs.slice(0, -1).some((s) => IGNORED_DIRS.has(s))) return 'ignored directory';
  if (MINIFIED.test(p)) return 'minified';
  if (DECLARATION.test(p)) return 'type declaration';
  if (size > ATLAS_LIMITS.MAX_FILE_BYTES) return 'too large';
  return null;
}

function normalizePath(p: string): string {
  return posix.normalize(p.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/^\/+/, '');
}

function countLines(text: string | null): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith('\n') ? n - 1 : n;
}

/**
 * Pure analysis: repository files in, AtlasData out. No disk or network access; source text is not kept.
 * Deterministic: the same input always yields the same output (apart from `analyzedAt`).
 */
export function analyzeAtlas(input: AtlasInput): AtlasData {
  const skipped: SkippedEntry[] = [...(input.skipped ?? [])];
  const included = new Map<string, SourceFile & { size: number }>();
  for (const f of input.files) {
    const p = normalizePath(f.path);
    if (!p || p.startsWith('..')) continue;
    const size = f.size ?? (f.text === null ? 0 : Buffer.byteLength(f.text, 'utf8'));
    const reason = skipReason(p, size);
    if (reason) skipped.push({ path: p, reason });
    else included.set(p, { ...f, path: p, size });
  }
  const paths = [...included.keys()].sort();
  const skippedByPath = new Map(skipped.map((s) => [s.path, s.reason]));

  const ctx = buildResolveContext('', new Set(paths), new Set(), (rel) => included.get(rel)?.text ?? null);
  const java = javaDependencies(new Map(paths.filter((p) => p.endsWith('.java')).map((p) => [p, included.get(p)!.text ?? ''])));

  const files: FileNode[] = [];
  const edges: Edge[] = [];
  for (const p of paths) {
    const f = included.get(p)!;
    const ext = posix.extname(p).toLowerCase();
    const folder = posix.dirname(p) === '.' ? '' : posix.dirname(p);
    const node: FileNode = {
      path: p, name: posix.basename(p), ext, folder, size: f.size, lines: countLines(f.text),
      kind: CODE_EXTS.has(ext) ? 'code' : 'other', functions: [], exports: [],
    };
    const j = java.get(p);
    if (j) {
      node.functions = j.classes;
      edges.push(...j.edges);
    } else if (node.kind === 'code') {
      const x = extractFile(f.text ?? '', ext);
      node.functions = x.functions;
      node.exports = x.exports;
      // A file that produced no AST has unknown complexity/tokens: leave them out instead of reporting 1 / 0.
      if (!x.failed) {
        node.complexity = x.complexity;
        node.tokens = x.tokens;
      }
      if (x.parseError) node.parseError = x.parseError;
      for (const imp of x.imports) edges.push(toEdge(p, folder, imp.specifier, imp.kind, imp.line));
    }
    files.push(node);
  }

  function toEdge(from: string, fromDir: string, specifier: string | null, kind: Edge['kind'], line: number): Edge {
    if (specifier === null) return { from, to: null, specifier: '<dynamic expression>', line, kind, status: 'unresolved', reason: 'dynamic path' };
    const r = resolveJsImport(ctx, from, specifier);
    switch (r.kind) {
      case 'local': return { from, to: r.target, specifier, line, kind, status: 'resolved' };
      case 'external': return { from, to: null, specifier, line, kind, status: 'external', reason: 'package' };
      case 'builtin': return { from, to: null, specifier, line, kind, status: 'external', reason: 'built-in module' };
      case 'url': return { from, to: null, specifier, line, kind, status: 'external', reason: 'URL import' };
      case 'asset': return { from, to: null, specifier, line, kind, status: 'unresolved', reason: 'asset not analysed' };
      case 'unresolved': {
        // Point at an excluded target (e.g. ./types -> types.d.ts) instead of a vague "not found".
        if (specifier.startsWith('.')) {
          const base = normalizePath(posix.join(fromDir, specifier));
          for (const c of [base, ...['.d.ts', '.js', '.mjs', '.cjs'].map((e) => base.replace(/\.[cm]?js$/, '') + e)]) {
            const why = skippedByPath.get(c);
            if (why) return { from, to: null, specifier, line, kind, status: 'unresolved', reason: `target not analysed (${why})` };
          }
        }
        return { from, to: null, specifier, line, kind, status: 'unresolved', reason: UNRESOLVED_REASON[r.reason] };
      }
    }
  }

  // Imported non-code files become asset nodes.
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const e of edges) if (e.to) { const t = byPath.get(e.to)!; if (t.kind === 'other') t.kind = 'asset'; }

  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.line - b.line || (a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0)));

  // Cycles: strongly connected components over resolved edges (size > 1, or a file importing itself).
  const adj = new Map<string, string[]>();
  for (const e of edges) if (e.to) { const l = adj.get(e.from) ?? []; if (!l.includes(e.to)) l.push(e.to); adj.set(e.from, l); }
  const cycles = stronglyConnected(paths, adj)
    .filter((c) => c.length > 1 || (adj.get(c[0]) ?? []).includes(c[0]))
    .map((c) => [...c].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    version: 1,
    repo: { ...input.repo, analyzedAt: input.repo.analyzedAt ?? new Date().toISOString() },
    files,
    edges,
    cycles,
    stats: {
      files: files.length,
      edges: edges.length,
      unresolved: edges.filter((e) => e.status === 'unresolved').length,
      parseErrors: files.filter((f) => f.parseError).length,
      skipped,
    },
  };
}
