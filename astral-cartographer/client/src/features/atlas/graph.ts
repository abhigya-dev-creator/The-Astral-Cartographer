import type { AtlasModel, Edge } from './model';

export interface TraceResult {
  from: string;
  to: string;
  /** file paths from `from` to `to` following imports; null when no chain exists in either direction */
  path: string[] | null;
  /** the chain only exists the other way round: `to` (transitively) imports `from` */
  reversed: boolean;
  /** the edge used for each step (path[i] -> path[i+1]) */
  steps: Edge[];
}

/** Breadth-first search over resolved imports, deterministic (neighbours in path order). */
function shortest(model: AtlasModel, from: string, to: string, allow: (e: Edge) => boolean): { path: string[]; steps: Edge[] } | null {
  if (from === to) return { path: [from], steps: [] };
  const prev = new Map<string, Edge>();
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const p of frontier) {
      const out = (model.outgoing.get(p) ?? []).filter((e) => e.status === 'resolved' && e.to && allow(e)).sort((a, b) => (a.to! < b.to! ? -1 : a.to! > b.to! ? 1 : a.line - b.line));
      for (const e of out) {
        if (seen.has(e.to!)) continue;
        seen.add(e.to!);
        prev.set(e.to!, e);
        if (e.to === to) {
          const steps: Edge[] = [];
          for (let cur = to; cur !== from; cur = prev.get(cur)!.from) steps.unshift(prev.get(cur)!);
          return { path: [from, ...steps.map((s) => s.to!)], steps };
        }
        next.push(e.to!);
      }
    }
    frontier = next;
  }
  return null;
}

/** Shortest import chain from `from` to `to`; if none, the chain from `to` to `from` (reported as reversed). */
export function tracePath(model: AtlasModel, from: string, to: string, allow: (e: Edge) => boolean = () => true): TraceResult {
  const fwd = shortest(model, from, to, allow);
  if (fwd) return { from, to, path: fwd.path, reversed: false, steps: fwd.steps };
  const back = shortest(model, to, from, allow);
  if (back) return { from, to, path: back.path, reversed: true, steps: back.steps };
  return { from, to, path: null, reversed: false, steps: [] };
}

/** Files within `depth` import steps of `path`, in either direction (the file itself included). */
export function isolateSet(model: AtlasModel, path: string, depth: number, allow: (e: Edge) => boolean = () => true): Set<string> {
  const out = new Set([path]);
  let frontier = [path];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const p of frontier) {
      const nbrs = [
        ...(model.outgoing.get(p) ?? []).filter((e) => e.status === 'resolved' && e.to && allow(e)).map((e) => e.to!),
        ...(model.incoming.get(p) ?? []).filter(allow).map((e) => e.from),
      ];
      for (const n of nbrs) if (!out.has(n)) { out.add(n); next.push(n); }
    }
    frontier = next;
  }
  return out;
}

/** Direct neighbours in a stable order (dependencies first, then dependents), for keyboard stepping. */
export function relatedInOrder(model: AtlasModel, path: string): string[] {
  const deps = [...new Set((model.outgoing.get(path) ?? []).filter((e) => e.status === 'resolved' && e.to).map((e) => e.to!))].sort();
  const dependents = [...new Set((model.incoming.get(path) ?? []).map((e) => e.from))].filter((p) => !deps.includes(p)).sort();
  return [...deps, ...dependents];
}
