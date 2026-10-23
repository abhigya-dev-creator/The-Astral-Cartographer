import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allFolders, buildModel, defaultExpanded, type AtlasData, type Edge } from '../src/features/atlas/model';
import { computeLayout, type AtlasLayout, type LayoutCache } from '../src/features/atlas/layout';
import { isolateSet, relatedInOrder, tracePath } from '../src/features/atlas/graph';
import { buildExplorerTree, explorerAncestors, flattenVisible, searchExplorer } from '../src/features/atlas/explorerTree';
import { EXTERNAL_REASON, isExternalPath, packageOf, withExternalPackages } from '../src/features/atlas/externals';
import { filePassesFilters } from '../src/features/atlas/filters';
import { distToPolyline } from '../src/features/atlas/render2d';
import { syntheticAtlas } from '../src/features/atlas/dev/synthetic';

function repo(edges: Array<[string, string]>, extra: Partial<AtlasData> = {}): AtlasData {
  const paths = [...new Set(edges.flat())].sort();
  const files = paths.map((path) => {
    const i = path.lastIndexOf('/');
    return { path, name: path.slice(i + 1), ext: path.slice(path.lastIndexOf('.')), folder: i < 0 ? '' : path.slice(0, i), size: 1, lines: 1, kind: 'code' as const, functions: [], exports: [] };
  });
  const es: Edge[] = edges.map(([from, to], n) => ({ from, to, specifier: `./${to}`, line: n + 1, kind: 'import', status: 'resolved' }));
  return { version: 1, repo: { owner: 'o', name: 'r', branch: 'main', commitSha: '', analyzedAt: '' }, files, edges: es, cycles: [], stats: { files: files.length, edges: es.length, unresolved: 0, parseErrors: 0, skipped: [] }, ...extra };
}

test('incremental layout: toggling folders never overlaps clusters, keeps colours, and leaves unrelated clusters still in small repos', () => {
  for (const n of [67, 500, 2000]) {
    const m = buildModel(syntheticAtlas(n));
    const cache: LayoutCache = new Map();
    let expanded = defaultExpanded(m.root);
    let prev: AtlasLayout = computeLayout(m.root, expanded, cache);
    const colours = new Map(prev.colorByTop);
    for (const f of allFolders(m.root).filter((x) => x.depth >= 1).slice(0, 25)) {
      const next = new Set(expanded);
      if (next.has(f.path)) next.delete(f.path); else next.add(f.path);
      const l = computeLayout(m.root, next, cache, prev);
      const tops = l.clusters.filter((c) => !c.parent);
      for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
        const a = tops[i], b = tops[j];
        assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) >= a.r + b.r - 1e-6, `${n}: ${a.key} overlaps ${b.key} after toggling ${f.path}`);
      }
      assert.deepEqual([...l.colorByTop], [...colours], `${n}: colours unchanged`);
      if (n <= 500) {
        let top = f; while (top.parent && top.parent !== m.root) top = top.parent;
        for (const c of tops) if (c.key !== top.path) {
          const p = prev.clusterByPath.get(c.key)!;
          assert.ok(Math.hypot(p.cx - c.cx, p.cy - c.cy) < 1e-6, `${n}: ${c.key} moved after toggling ${f.path}`);
        }
      }
      expanded = next;
      prev = l;
    }
  }
});

test('trace: shortest import chain, reported reversed when it only exists the other way, null when none', () => {
  const m = buildModel(repo([['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts'], ['src/a.ts', 'src/x.ts'], ['src/x.ts', 'src/y.ts'], ['src/y.ts', 'src/c.ts'], ['src/lone.ts', 'src/z.ts']]));
  const t = tracePath(m, 'src/a.ts', 'src/c.ts');
  assert.deepEqual([t.path, t.reversed, t.steps.map((s) => s.line)], [['src/a.ts', 'src/b.ts', 'src/c.ts'], false, [1, 2]]);
  const back = tracePath(m, 'src/c.ts', 'src/a.ts');
  assert.deepEqual([back.path, back.reversed], [['src/a.ts', 'src/b.ts', 'src/c.ts'], true]);
  assert.equal(tracePath(m, 'src/a.ts', 'src/z.ts').path, null);
  // relationship-type filter is respected
  const noB = tracePath(m, 'src/a.ts', 'src/c.ts', (e) => e.from !== 'src/b.ts');
  assert.deepEqual(noB.path, ['src/a.ts', 'src/x.ts', 'src/y.ts', 'src/c.ts']);
});

test('isolate: neighbours in both directions up to the chosen depth; related files in a stable order', () => {
  const m = buildModel(repo([['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/c.ts'], ['src/c.ts', 'src/d.ts'], ['src/e.ts', 'src/b.ts']]));
  assert.deepEqual([...isolateSet(m, 'src/b.ts', 1)].sort(), ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/e.ts']);
  assert.deepEqual([...isolateSet(m, 'src/b.ts', 2)].sort(), ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']);
  assert.deepEqual(relatedInOrder(m, 'src/b.ts'), ['src/c.ts', 'src/a.ts', 'src/e.ts'], 'dependencies first, then dependents');
});

test('explorer tree: real hierarchy, folders first, skipped entries included and marked', () => {
  const data = repo([['src/app/main.ts', 'src/lib/util.ts'], ['README.md', 'src/app/main.ts']], {
    stats: { files: 3, edges: 2, unresolved: 0, parseErrors: 0, skipped: [{ path: 'node_modules', reason: 'ignored directory' }, { path: 'src/lib/types.d.ts', reason: 'type declaration' }] },
  });
  const tree = buildExplorerTree(data);
  assert.deepEqual(tree.children.map((c) => [c.name, c.kind]), [['node_modules', 'skipped-dir'], ['src', 'folder'], ['README.md', 'file']]);
  assert.equal(tree.files, 3);
  const lib = tree.children[1].children.find((c) => c.name === 'lib')!;
  assert.deepEqual(lib.children.map((c) => [c.name, c.kind, c.reason]), [['types.d.ts', 'skipped-file', 'type declaration'], ['util.ts', 'file', undefined]]);
  assert.deepEqual(flattenVisible(tree, new Set(['', 'src'])).map((r) => `${'  '.repeat(r.depth)}${r.node.name}`), ['node_modules', 'src', '  app', '  lib', 'README.md']);
  assert.deepEqual(searchExplorer(tree, 'util').results.map((n) => n.path), ['src/lib/util.ts']);
  // folder name match first, then path-only matches by path length
  assert.deepEqual(searchExplorer(tree, 'lib').results.map((n) => n.path), ['src/lib', 'src/lib/util.ts', 'src/lib/types.d.ts']);
  assert.deepEqual(explorerAncestors('src/lib/util.ts'), ['', 'src', 'src/lib']);
});

test('external packages: grouped per package, built-ins as node:*, URL imports left out, original data untouched', () => {
  const base = repo([['src/a.ts', 'src/b.ts']]);
  const ext = (specifier: string, reason: string): Edge => ({ from: 'src/a.ts', to: null, specifier, line: 9, kind: 'import', status: 'external', reason });
  base.edges.push(ext('lodash/get', 'package'), ext('lodash', 'package'), ext('@scope/ui/button', 'package'), ext('fs/promises', 'built-in module'), ext('https://x.dev/m.js', 'URL import'));
  const before = JSON.stringify(base);
  const out = withExternalPackages(base);
  assert.equal(JSON.stringify(base), before, 'input not modified');
  const pkgs = out.files.filter((f) => isExternalPath(f.path)).map((f) => f.path);
  assert.deepEqual(pkgs, ['External packages/@scope/ui', 'External packages/lodash', 'External packages/node:fs']);
  assert.equal(out.edges.filter((e) => e.reason === EXTERNAL_REASON).length, 4);
  assert.equal(out.edges.find((e) => e.specifier.startsWith('https'))?.status, 'external');
  assert.deepEqual(out.stats, base.stats, 'repository statistics are not changed by the view option');
  assert.equal(packageOf(ext('npm:chalk@5', 'package')), 'chalk');
  const java = (specifier: string, reason: string): Edge => ({ from: 'src/A.java', to: null, specifier, line: 1, kind: 'import', status: 'external', reason });
  assert.deepEqual([java('org.springframework.boot.SpringApplication', 'package'), java('static org.junit.Assert.assertEquals', 'package'), java('java.util.*', 'built-in module'), java('lombok.Data', 'package')].map(packageOf), ['org.springframework.boot', 'org.junit', 'java.util', 'lombok']);
  const m = buildModel(out);
  assert.equal(m.incoming.get('External packages/lodash')?.length, 2);
});

test('findings filter dims files without findings', () => {
  const m = buildModel(repo([['src/a.ts', 'src/b.ts']]));
  const f = { hiddenFolders: new Set<string>(), hiddenTypes: new Set<never>(), hiddenKinds: new Set<never>(), cyclesOnly: false, findingsOnly: true };
  const findings = new Map([['src/a.ts', [1]]]);
  assert.equal(filePassesFilters(m.fileByPath.get('src/a.ts')!, f, m, findings), true);
  assert.equal(filePassesFilters(m.fileByPath.get('src/b.ts')!, f, m, findings), false);
});

test('link hit testing: distance to a drawn polyline', () => {
  const pts = [0, 0, 10, 0, 10, 10];
  assert.equal(distToPolyline(5, 3, pts), 3);
  assert.equal(distToPolyline(12, 5, pts), 2);
  assert.equal(distToPolyline(-4, -3, pts), 5);
});
