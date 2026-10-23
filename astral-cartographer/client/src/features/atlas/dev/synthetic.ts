import type { AtlasData, Edge, FileNode } from '../model';

/**
 * Synthetic AtlasData for layout tests and the dev performance mode (`/atlas?synthetic=2000`).
 * It is clearly labelled as synthetic and never shown for a real repository.
 * Random imports point "backwards" (file i -> earlier file); a few cycles are planted on top, and `cycles`
 * is then computed from the edges with Tarjan's algorithm, so it is exact for the generated graph.
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Iterative Tarjan over resolved edges; same output shape as the server (sorted members, sorted list). */
function stronglyConnectedCycles(nodes: string[], edges: Edge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of edges) if (e.to) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ v: string; i: number }> = [{ v: root, i: 0 }];
    index.set(root, counter); low.set(root, counter++); stack.push(root); onStack.add(root);
    while (work.length) {
      const fr = work[work.length - 1];
      const nb = adj.get(fr.v) ?? [];
      if (fr.i < nb.length) {
        const w = nb[fr.i++];
        if (!index.has(w)) { index.set(w, counter); low.set(w, counter++); stack.push(w); onStack.add(w); work.push({ v: w, i: 0 }); }
        else if (onStack.has(w)) low.set(fr.v, Math.min(low.get(fr.v)!, index.get(w)!));
      } else {
        if (low.get(fr.v) === index.get(fr.v)) {
          const comp: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== fr.v);
          if (comp.length > 1 || (adj.get(comp[0]) ?? []).includes(comp[0])) out.push(comp.sort());
        }
        work.pop();
        if (work.length) { const p = work[work.length - 1].v; low.set(p, Math.min(low.get(p)!, low.get(fr.v)!)); }
      }
    }
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const TOP = ['app', 'components', 'hooks', 'lib', 'pages', 'utils', 'assets', 'config', 'types', 'services', 'store', 'features'];
const EXTS = ['.ts', '.tsx', '.ts', '.js', '.tsx', '.css', '.json'];

export function syntheticAtlas(n: number, seed = 7): AtlasData {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const files: FileNode[] = [];
  for (let i = 0; i < n; i++) {
    let folder = `src/${pick(TOP)}`;
    const depth = Math.floor(rnd() * 3);
    for (let d = 0; d < depth; d++) folder += `/group${Math.floor(rnd() * 5)}`;
    const ext = pick(EXTS);
    const name = `file${i}${ext}`;
    const code = ext !== '.css' && ext !== '.json';
    files.push({
      path: `${folder}/${name}`, name, ext, folder, size: 200 + Math.floor(rnd() * 8000), lines: 10 + Math.floor(rnd() * 400),
      kind: code ? 'code' : 'asset',
      functions: code ? [{ name: `fn${i}`, line: 3, kind: 'function' }] : [],
      exports: code ? [`fn${i}`] : [],
      ...(code ? { complexity: 1 + Math.floor(rnd() * 20), tokens: 50 + Math.floor(rnd() * 3000) } : {}),
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const code = files.filter((f) => f.kind === 'code');
  const edges: Edge[] = [];
  code.forEach((f, i) => {
    const k = Math.floor(rnd() * 5);
    for (let e = 0; e < k && i > 0; e++) {
      const t = files[Math.floor(rnd() * files.indexOf(f))];
      if (t && t !== f) edges.push({ from: f.path, to: t.path, specifier: `./${t.name}`, line: e + 1, kind: 'import', status: 'resolved' });
    }
    if (rnd() < 0.3) edges.push({ from: f.path, to: null, specifier: 'react', line: 1, kind: 'import', status: 'external', reason: 'package' });
    if (rnd() < 0.03) edges.push({ from: f.path, to: null, specifier: './missing', line: 2, kind: 'import', status: 'unresolved', reason: 'file not found' });
  });
  // plant a few cycles a -> b -> c -> a
  for (let c = 0, planted = 0; c + 2 < code.length && planted < Math.max(1, Math.floor(n / 400)); c += 37, planted++) {
    const [a, b, d] = [code[c], code[c + 1], code[c + 2]];
    edges.push({ from: a.path, to: b.path, specifier: `./${b.name}`, line: 90, kind: 'import', status: 'resolved' });
    edges.push({ from: b.path, to: d.path, specifier: `./${d.name}`, line: 90, kind: 'import', status: 'resolved' });
    edges.push({ from: d.path, to: a.path, specifier: `./${a.name}`, line: 90, kind: 'import', status: 'resolved' });
  }
  const cycles = stronglyConnectedCycles(files.map((f) => f.path), edges);
  return {
    version: 1,
    repo: { owner: 'synthetic', name: `synthetic-${n}`, branch: 'main', commitSha: '', analyzedAt: new Date(0).toISOString(), source: 'zip' },
    files,
    edges,
    cycles,
    stats: { files: files.length, edges: edges.length, unresolved: edges.filter((e) => e.status === 'unresolved').length, parseErrors: 0, skipped: [] },
  };
}
