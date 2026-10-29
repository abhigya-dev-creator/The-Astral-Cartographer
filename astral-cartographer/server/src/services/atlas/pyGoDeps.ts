import path from 'path';
import type { Edge } from './types.js';

const posix = path.posix;
const lineOf = (text: string, idx: number) => text.slice(0, idx).split('\n').length;
const ext = (from: string, specifier: string, line: number, reason: string): Edge => ({ from, to: null, specifier, line, kind: 'import', status: 'external', reason });

/**
 * Python: `import a.b` and `from a.b import c` / `from . import x`, resolved to repository files
 * (a/b.py or a/b/__init__.py, searched from any folder, shortest path wins). Anything else is a package.
 */
export function pythonDependencies(sources: ReadonlyMap<string, string>): Map<string, Edge[]> {
  const files = new Set(sources.keys());
  const byModule = new Map<string, string>(); // "a.b" -> file, for every suffix of every path
  for (const p of [...files].sort((a, b) => a.length - b.length)) {
    const mod = p.replace(/\/__init__\.pyi?$/, '').replace(/\.pyi?$/, '').split('/');
    for (let i = 0; i < mod.length; i++) { const k = mod.slice(i).join('.'); if (!byModule.has(k)) byModule.set(k, p); }
  }
  const resolveAbs = (m: string) => byModule.get(m) ?? null;
  const resolveRel = (dir: string, m: string) => {
    const base = posix.join(dir, ...m.split('.').filter(Boolean));
    for (const c of [`${base}.py`, `${base}/__init__.py`, `${base}.pyi`]) if (files.has(c)) return c;
    return null;
  };
  const out = new Map<string, Edge[]>();
  for (const [p, text] of sources) {
    const code = text.replace(/#.*$/gm, '');
    const edges: Edge[] = [];
    const dir = posix.dirname(p) === '.' ? '' : posix.dirname(p);
    const add = (spec: string, line: number, target: string | null) => {
      if (target && target !== p) edges.push({ from: p, to: target, specifier: spec, line, kind: 'import', status: 'resolved' });
      else if (!target) edges.push(ext(p, spec, line, 'package'));
    };
    for (const m of code.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm)) {
      const line = lineOf(code, m.index!);
      for (const part of m[1].split(',')) { const mod = part.trim().split(/\s+/)[0]; add(mod, line, resolveAbs(mod)); }
    }
    for (const m of code.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+\(?([\w ,*\t]+)/gm)) {
      const line = lineOf(code, m.index!);
      const dots = m[1].length, mod = m[2];
      const names = m[3].split(',').map((n) => n.trim().split(/\s+/)[0]).filter((n) => n && n !== '*');
      if (dots) {
        let d = dir; for (let i = 1; i < dots; i++) d = posix.dirname(d) === '.' ? '' : posix.dirname(d);
        const subs = names.map((n) => resolveRel(d, mod ? `${mod}.${n}` : n)).filter((x): x is string => !!x);
        const target = subs.length ? null : resolveRel(d, mod);
        for (const s of subs) add(`${m[1]}${mod}`, line, s);
        if (!subs.length) edges.push(target ? { from: p, to: target, specifier: `${m[1]}${mod}`, line, kind: 'import', status: 'resolved' } : { from: p, to: null, specifier: `${m[1]}${mod}`, line, kind: 'import', status: 'unresolved', reason: 'file not found' });
      } else {
        const subs = names.map((n) => resolveAbs(`${mod}.${n}`)).filter((x): x is string => !!x);
        if (subs.length) for (const s of new Set(subs)) add(mod, line, s);
        else add(mod, line, resolveAbs(mod));
      }
    }
    out.set(p, edges);
  }
  return out;
}

/**
 * Go: imports of packages inside this module (go.mod `module` path) link to the package folder's non-test files;
 * standard-library imports (no dot in the first segment) are built-in; everything else is a package.
 */
export function goDependencies(sources: ReadonlyMap<string, string>, goMods: ReadonlyMap<string, string>): Map<string, Edge[]> {
  const mods = [...goMods].map(([p, t]) => ({ dir: posix.dirname(p) === '.' ? '' : posix.dirname(p), module: /^module\s+(\S+)/m.exec(t)?.[1] ?? '' })).filter((m) => m.module);
  const byDir = new Map<string, string[]>();
  for (const p of sources.keys()) if (!p.endsWith('_test.go')) { const d = posix.dirname(p) === '.' ? '' : posix.dirname(p); byDir.set(d, [...(byDir.get(d) ?? []), p]); }
  const out = new Map<string, Edge[]>();
  for (const [p, text] of sources) {
    const edges: Edge[] = [];
    const code = text.replace(/\/\/.*$/gm, '');
    const specs: Array<{ s: string; i: number }> = [];
    for (const m of code.matchAll(/^import[ \t]+(?:[\w.]+[ \t]+)?"([^"]+)"/gm)) specs.push({ s: m[1], i: m.index! });
    for (const b of code.matchAll(/^import[ \t]*\(([\s\S]*?)\)/gm)) for (const m of b[1].matchAll(/"([^"]+)"/g)) specs.push({ s: m[1], i: b.index! + 8 + m.index! });
    for (const { s, i } of specs) {
      const line = lineOf(code, i);
      const mod = mods.find((m) => s === m.module || s.startsWith(`${m.module}/`));
      if (mod) {
        const dir = posix.join(mod.dir, s.slice(mod.module.length).replace(/^\//, '')).replace(/^\.$/, '');
        const targets = (byDir.get(dir === '.' ? '' : dir) ?? []).filter((t) => t !== p);
        if (targets.length) for (const t of targets) edges.push({ from: p, to: t, specifier: s, line, kind: 'import', status: 'resolved' });
        else edges.push({ from: p, to: null, specifier: s, line, kind: 'import', status: 'unresolved', reason: 'file not found' });
      } else edges.push(ext(p, s, line, s.split('/')[0].includes('.') ? 'package' : 'built-in module'));
    }
    out.set(p, edges);
  }
  return out;
}

/** Functions, methods and classes/types declared in a Python or Go file (pattern-based). */
export function declaredSymbols(p: string, text: string): Array<{ name: string; line: number; kind: 'function' | 'class' | 'method' }> {
  const out: Array<{ name: string; line: number; kind: 'function' | 'class' | 'method' }> = [];
  const re = p.endsWith('.go')
    ? /^(?:func[ \t]+(\([^)]*\)[ \t]*)?(\w+)|type[ \t]+(\w+)[ \t]+(?:struct|interface))/gm
    : /^([ \t]*)(?:async[ \t]+)?(?:def[ \t]+(\w+)|class[ \t]+(\w+))/gm;
  for (const m of text.matchAll(re)) {
    const line = lineOf(text, m.index!);
    if (m[3]) out.push({ name: m[3], line, kind: 'class' });
    else if (m[2]) out.push({ name: m[2], line, kind: m[1] ? 'method' : 'function' });
  }
  return out;
}
