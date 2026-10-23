import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { allFolders, buildModel, defaultExpanded, parseAtlasData, type AtlasData, type FolderNode } from '../src/features/atlas/model';
import { computeLayout, type AtlasLayout, type LayoutCache } from '../src/features/atlas/layout';
import { assignFolderColors, folderPalette, hashString } from '../src/features/atlas/palette';
import { syntheticAtlas } from '../src/features/atlas/dev/synthetic';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = parseAtlasData(JSON.parse(fs.readFileSync(path.join(here, '../src/features/atlas/sample/atlas-sample.json'), 'utf8')));

const allExpanded = (root: FolderNode) => new Set(allFolders(root).map((f) => f.path));
const snapshot = (l: AtlasLayout) =>
  JSON.stringify({
    c: l.clusters.map((c) => [c.key, c.x, c.y, c.r, c.color, c.expanded]),
    f: l.files.map((f) => [f.file.path, f.x, f.y]),
  });

/** Every pair of siblings inside a cluster (files and subclusters) and every pair of top-level clusters must not overlap. */
function assertNoOverlap(l: AtlasLayout, label: string) {
  const groups = new Map<string, Array<{ id: string; x: number; y: number; r: number }>>();
  const add = (parent: string, item: { id: string; x: number; y: number; r: number }) => (groups.get(parent) ?? groups.set(parent, []).get(parent)!).push(item);
  for (const c of l.clusters) add(c.parent ? c.parent.key : '<top>', { id: `dir:${c.key}`, x: c.cx, y: c.cy, r: c.r });
  for (const f of l.files) add(f.cluster.key + (f.cluster.isRootFiles ? '#root' : ''), { id: f.file.path, x: f.x, y: f.y, r: f.r });
  let pairs = 0;
  for (const [parent, items] of groups) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        pairs++;
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 1e-6, `${label}: ${a.id} overlaps ${b.id} in ${parent}`);
      }
    }
  }
  // children also stay off their own hub
  for (const f of l.files) assert.ok(Math.hypot(f.x - f.cluster.x, f.y - f.cluster.y) >= f.cluster.hubR + f.r - 1e-6, `${label}: ${f.file.path} on hub`);
  return pairs;
}

const cases: Array<[string, AtlasData]> = [['sample', sample], ['synthetic-500', syntheticAtlas(500)], ['synthetic-2000', syntheticAtlas(2000)]];

test('layout is identical for the same input (fresh caches, default and fully expanded)', () => {
  for (const [name, data] of cases) {
    const m1 = buildModel(data);
    const m2 = buildModel(JSON.parse(JSON.stringify(data)));
    assert.equal(snapshot(computeLayout(m1.root, defaultExpanded(m1.root))), snapshot(computeLayout(m2.root, defaultExpanded(m2.root))), name);
    assert.equal(snapshot(computeLayout(m1.root, allExpanded(m1.root))), snapshot(computeLayout(m2.root, allExpanded(m2.root))), `${name} expanded`);
  }
});

test('no two clusters (or sibling nodes) overlap', () => {
  for (const [name, data] of cases) {
    const m = buildModel(data);
    const pairs = assertNoOverlap(computeLayout(m.root, allExpanded(m.root)), name) + assertNoOverlap(computeLayout(m.root, defaultExpanded(m.root)), `${name} default`);
    assert.ok(pairs > 0);
  }
});

test('expanding one folder re-lays out only that folder and its ancestors', () => {
  const m = buildModel(syntheticAtlas(500));
  const cache: LayoutCache = new Map();
  const expanded = defaultExpanded(m.root);
  computeLayout(m.root, expanded, cache);
  const before = new Map(cache);
  const target = allFolders(m.root).find((f) => f.depth >= 2 && f.folders.length === 0 && !expanded.has(f.path))
    ?? allFolders(m.root).find((f) => f.depth >= 2 && f.folders.length === 0)!;
  const toggled = new Set(expanded);
  if (toggled.has(target.path)) toggled.delete(target.path); else toggled.add(target.path);
  computeLayout(m.root, toggled, cache);
  const chain = new Set<string>();
  for (let f: FolderNode | null = target; f; f = f.parent) chain.add(f.path);
  let reused = 0;
  for (const [key, rel] of cache) {
    if (!before.has(key)) continue;
    if (chain.has(key)) continue;
    assert.equal(rel, before.get(key), `${key} was recomputed although it did not change`);
    reused++;
  }
  assert.ok(reused > 0);
});

test('large folders start collapsed; visible items stay within the budget', () => {
  const m = buildModel(syntheticAtlas(10000));
  const expanded = defaultExpanded(m.root);
  const layout = computeLayout(m.root, expanded);
  assert.ok(layout.files.length + layout.clusters.length <= 600 + m.root.folders.length + 1, `visible ${layout.files.length + layout.clusters.length}`);
  assert.ok(layout.clusters.some((c) => !c.expanded), 'some folders start collapsed');
});

test('folder colours: hash of the name, stable across repositories, unique or neighbour-distinct', () => {
  const size = folderPalette().length;
  const a = assignFolderColors(['components', 'hooks', 'lib'], new Map(), size);
  const b = assignFolderColors(['components', 'pages', 'utils', 'zz'], new Map(), size);
  assert.equal(a.get('components'), b.get('components'), 'same name, same colour in another repository');
  assert.equal(a.get('components'), hashString('components') % size, 'no collision -> hashed colour');
  const many = Array.from({ length: size }, (_, i) => `folder${i}`);
  assert.equal(new Set(assignFolderColors(many, new Map(), size).values()).size, size, 'all distinct when they fit');
  // more folders than colours: every folder differs from its neighbours
  const names = Array.from({ length: size + 6 }, (_, i) => `dir${i}`);
  const neighbours = new Map(names.map((n, i) => [n, new Set([names[(i + 1) % names.length], names[(i + names.length - 1) % names.length]])]));
  const colours = assignFolderColors(names, neighbours, size);
  for (const [n, ns] of neighbours) for (const x of ns) assert.notEqual(colours.get(n), colours.get(x), `${n} vs ${x}`);
  // and the real layout: same input, same colours; 2D/3D share this exact map
  const m = buildModel(sample);
  assert.deepEqual([...computeLayout(m.root, defaultExpanded(m.root)).colorByTop], [...computeLayout(m.root, defaultExpanded(m.root)).colorByTop]);
});

test('model: dependents are derived from the same edges as dependencies', () => {
  const m = buildModel(sample);
  let count = 0;
  for (const [to, list] of m.incoming) for (const e of list) { assert.equal(e.to, to); assert.ok(m.outgoing.get(e.from)!.includes(e)); count++; }
  assert.equal(count, sample.edges.filter((e) => e.status === 'resolved').length);
});
