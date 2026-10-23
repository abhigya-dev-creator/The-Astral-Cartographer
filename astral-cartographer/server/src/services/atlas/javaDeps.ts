import path from 'path';
import type { Edge, FunctionInfo } from './types.js';

const posix = path.posix;

/**
 * Java dependencies for the Dependency Atlas, without a Java parser:
 *  - `package` and `import` declarations are read from source with comments and string literals blanked out;
 *  - explicit imports resolve to the repository file declaring that class (nested classes resolve to their file);
 *  - `import a.b.*` and same-package references (which need no import in Java) link only to the classes of that
 *    package whose simple name actually appears in the file, so no edge is guessed from a package alone.
 * Imports of the JDK are reported as built-in modules, other classes outside the repository as packages.
 */

interface JavaImport { name: string; isStatic: boolean; wildcard: boolean; line: number }
interface JavaFile { path: string; pkg: string; imports: JavaImport[]; /** identifier -> line of its first use outside package/import declarations */ idents: Map<string, number>; classes: FunctionInfo[] }

const JDK = /^(?:java|javax|jdk|sun|com\.sun)\./;

/** Replace comments, string, text-block and char literals with spaces; newlines are kept so offsets map to lines. */
export function scrubJava(code: string): string {
  const out = code.split('');
  const blank = (from: number, to: number) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { const e = code.indexOf('\n', i); const end = e < 0 ? code.length : e; blank(i, end); i = end; }
    else if (c === '/' && n === '*') { const e = code.indexOf('*/', i + 2); const end = e < 0 ? code.length : e + 2; blank(i, end); i = end; }
    else if (c === '"' && code.startsWith('"""', i)) { const e = code.indexOf('"""', i + 3); const end = e < 0 ? code.length : e + 3; blank(i, end); i = end; }
    else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      blank(i, j + 1); i = j + 1;
    } else i++;
  }
  return out.join('');
}

/** offset -> 1-based line, by binary search over the line starts */
function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) starts.push(k + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

function readJava(p: string, code: string): JavaFile {
  const s = scrubJava(code);
  const lineAt = lineIndex(s);
  const pkg = /^[ \t]*package\s+([\w.]+)\s*;/m.exec(s)?.[1] ?? '';
  const imports: JavaImport[] = [];
  let body = s.replace(/^[ \t]*package\s+[\w.]+\s*;/m, (m) => ' '.repeat(m.length));
  body = body.replace(/^[ \t]*import\s+(static\s+)?([\w.]+?)(\s*\.\s*\*)?\s*;/gm, (m, st: string | undefined, name: string, star: string | undefined, off: number) => {
    imports.push({ name, isStatic: !!st, wildcard: !!star, line: lineAt(off + m.length - m.trimStart().length) });
    return m.replace(/[^\n]/g, ' ');
  });
  const idents = new Map<string, number>();
  for (const m of body.matchAll(/[A-Za-z_$][\w$]*/g)) if (!idents.has(m[0])) idents.set(m[0], lineAt(m.index!));
  const classes: FunctionInfo[] = [];
  for (const m of body.matchAll(/\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g)) classes.push({ name: m[1], line: lineAt(m.index!), kind: 'class' });
  return { path: p, pkg, imports, idents, classes };
}

/** Edges and declared classes for every `.java` file in `sources` (path -> text). */
export function javaDependencies(sources: ReadonlyMap<string, string>): Map<string, { edges: Edge[]; classes: FunctionInfo[] }> {
  const files = [...sources].map(([p, t]) => readJava(p, t));
  const byFqn = new Map<string, string>();
  const byPkg = new Map<string, Map<string, string>>();
  for (const f of files) {
    const simple = posix.basename(f.path, '.java');
    byFqn.set(f.pkg ? `${f.pkg}.${simple}` : simple, f.path);
    (byPkg.get(f.pkg) ?? byPkg.set(f.pkg, new Map()).get(f.pkg)!).set(simple, f.path);
  }
  // first two package segments of the repository's own code (e.g. "com.example"): unknown classes there are unresolved, not external
  const ownRoots = new Set([...byPkg.keys()].filter(Boolean).map((k) => k.split('.').slice(0, 2).join('.')));
  const resolveClass = (name: string): string | null => {
    const segs = name.split('.');
    while (segs.length) {
      const hit = byFqn.get(segs.join('.'));
      if (hit) return hit;
      segs.pop();
      if (!segs.length || !/^[A-Z]/.test(segs[segs.length - 1])) return null; // only strip nested-class segments
    }
    return null;
  };

  const out = new Map<string, { edges: Edge[]; classes: FunctionInfo[] }>();
  for (const f of files) {
    const edges: Edge[] = [];
    const linked = new Set<string>([f.path]);
    const explicit = new Set<string>(); // simple names brought in by explicit imports (they shadow same-package classes)
    const link = (to: string, specifier: string, line: number) => {
      if (linked.has(to)) return;
      linked.add(to);
      edges.push({ from: f.path, to, specifier, line, kind: 'import', status: 'resolved' });
    };

    for (const imp of f.imports) {
      const spec = `${imp.isStatic ? 'static ' : ''}${imp.name}${imp.wildcard ? '.*' : ''}`;
      if (!imp.wildcard || imp.isStatic) {
        const cls = imp.isStatic && !imp.wildcard ? imp.name.split('.').slice(0, -1).join('.') : imp.name;
        if (!imp.isStatic) explicit.add(imp.name.split('.').pop()!);
        const target = resolveClass(cls);
        if (target) { link(target, spec, imp.line); continue; }
      } else {
        const members = byPkg.get(imp.name);
        if (members) {
          for (const [simple, to] of members) if (to !== f.path && f.idents.has(simple)) link(to, spec, imp.line);
          continue;
        }
      }
      const external = JDK.test(imp.name) ? 'built-in module' : ownRoots.has(imp.name.split('.').slice(0, 2).join('.')) ? null : 'package';
      edges.push(external
        ? { from: f.path, to: null, specifier: spec, line: imp.line, kind: 'import', status: 'external', reason: external }
        : { from: f.path, to: null, specifier: spec, line: imp.line, kind: 'import', status: 'unresolved', reason: 'class not found in repository (generated?)' });
    }
    // same package: no import statement needed in Java
    for (const [simple, to] of byPkg.get(f.pkg) ?? []) {
      if (to === f.path || explicit.has(simple)) continue;
      const line = f.idents.get(simple);
      if (line !== undefined) link(to, f.pkg ? `${f.pkg}.${simple}` : simple, line);
    }
    out.set(f.path, { edges, classes: f.classes });
  }
  return out;
}
