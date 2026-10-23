/**
 * Layout benchmark (not a test). Run from client/:
 *   ../server/node_modules/.bin/tsx tests/layout.bench.ts
 * Median of 5 runs per measurement, synthetic data (same generator as the dev `?synthetic=N` mode).
 */
import { allFolders, buildModel, defaultExpanded, type FolderNode } from '../src/features/atlas/model';
import { computeLayout, type LayoutCache } from '../src/features/atlas/layout';
import { bundleEdges } from '../src/features/atlas/render2d';
import { syntheticAtlas } from '../src/features/atlas/dev/synthetic';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function time<T>(fn: () => T, runs = 5): { ms: number; value: T } {
  const ts: number[] = [];
  let value!: T;
  for (let i = 0; i < runs; i++) { const t = performance.now(); value = fn(); ts.push(performance.now() - t); }
  return { ms: median(ts), value };
}

for (const n of [500, 2000, 10000]) {
  const data = syntheticAtlas(n);
  const model = time(() => buildModel(data));
  const m = model.value;
  const def = defaultExpanded(m.root);
  const all = new Set(allFolders(m.root).map((f) => f.path));
  const cold = time(() => computeLayout(m.root, def, new Map()));
  const coldAll = time(() => computeLayout(m.root, all, new Map()));

  // incremental: toggle one deep folder with a warm cache (what a click does)
  const cache: LayoutCache = new Map();
  computeLayout(m.root, all, cache);
  const leaf = allFolders(m.root).filter((f: FolderNode) => f.depth >= 3).sort((a, b) => (a.path < b.path ? -1 : 1))[0];
  let flip = false;
  const incr = time(() => {
    flip = !flip;
    const ex = new Set(all);
    if (flip) ex.delete(leaf.path);
    return computeLayout(m.root, ex, cache);
  }, 9);

  const bundles = time(() => bundleEdges(m, coldAll.value));
  const v = (l: typeof cold.value) => l.files.length + l.clusters.length;
  console.log(
    `${String(n).padStart(6)} files | model ${model.ms.toFixed(1)} ms | layout (default, ${v(cold.value)} visible) ${cold.ms.toFixed(1)} ms | ` +
      `layout (all expanded, ${v(coldAll.value)} visible) ${coldAll.ms.toFixed(1)} ms | expand/collapse one folder ${incr.ms.toFixed(2)} ms | ` +
      `Show All bundles (${bundles.value.paths.length} edges) ${bundles.ms.toFixed(1)} ms`
  );
}
