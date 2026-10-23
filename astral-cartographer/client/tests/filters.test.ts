import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, type AtlasData, type Edge } from '../src/features/atlas/model';
import { edgePassesFilters, filePassesFilters } from '../src/features/atlas/filters';
import type { AtlasFilters } from '../src/features/atlas/atlasStore';

function fixture(): AtlasData {
  const f = (path: string) => {
    const i = path.lastIndexOf('/');
    return { path, name: path.slice(i + 1), ext: path.slice(path.lastIndexOf('.')), folder: path.slice(0, i), size: 1, lines: 1, kind: 'code' as const, functions: [], exports: [] };
  };
  const files = [f('src/app/main.ts'), f('src/app/view.tsx'), f('src/lib/util.js'), f('src/lib/style.css'), f('src/lib/a.ts'), f('src/lib/b.ts')];
  files[3].kind = 'asset' as never;
  const e = (from: string, to: string, kind: Edge['kind'] = 'import', line = 1): Edge => ({ from, to, specifier: `./${to}`, line, kind, status: 'resolved' });
  const edges: Edge[] = [
    e('src/app/main.ts', 'src/lib/util.js'),
    e('src/app/main.ts', 'src/app/view.tsx', 'dynamic', 2),
    e('src/app/view.tsx', 'src/lib/style.css'),
    e('src/lib/util.js', 'src/lib/a.ts', 'require'),
    e('src/lib/a.ts', 'src/lib/b.ts'),
    e('src/lib/b.ts', 'src/lib/a.ts', 'reexport'),
    { from: 'src/app/main.ts', to: null, specifier: 'react', line: 3, kind: 'import', status: 'external', reason: 'package' },
  ];
  return {
    version: 1, repo: { owner: 'o', name: 'r', branch: 'main', commitSha: '', analyzedAt: '' }, files, edges,
    cycles: [['src/lib/a.ts', 'src/lib/b.ts']], stats: { files: files.length, edges: edges.length, unresolved: 0, parseErrors: 0, skipped: [] },
  };
}
const none = (): AtlasFilters => ({ hiddenFolders: new Set(), hiddenTypes: new Set(), hiddenKinds: new Set(), cyclesOnly: false, findingsOnly: false });
const m = buildModel(fixture());
const file = (p: string) => m.fileByPath.get(p)!;
const drawn = (f: AtlasFilters) => m.data.edges.filter((e) => edgePassesFilters(e, f, m)).map((e) => `${e.from}>${e.to}`);

test('no filters: every file passes and every resolved edge is drawn (external edges never are)', () => {
  assert.ok(m.data.files.every((x) => filePassesFilters(x, none(), m)));
  assert.equal(drawn(none()).length, 6);
});

test('folder filter hides a top-level folder and every edge touching it', () => {
  // the root is "src" (single-child chain), so top-level folders are app and lib
  const f = { ...none(), hiddenFolders: new Set(['lib']) };
  assert.equal(filePassesFilters(file('src/lib/util.js'), f, m), false);
  assert.equal(filePassesFilters(file('src/app/main.ts'), f, m), true);
  assert.deepEqual(drawn(f), ['src/app/main.ts>src/app/view.tsx']);
});

test('file-type filter hides styles and the edges to them', () => {
  const f = { ...none(), hiddenTypes: new Set(['Styles' as const]) };
  assert.equal(filePassesFilters(file('src/lib/style.css'), f, m), false);
  assert.ok(!drawn(f).includes('src/app/view.tsx>src/lib/style.css'));
  assert.equal(drawn(f).length, 5);
});

test('relationship-type filter hides edges by kind, never files', () => {
  const f = { ...none(), hiddenKinds: new Set<Edge['kind']>(['dynamic', 'require']) };
  assert.ok(m.data.files.every((x) => filePassesFilters(x, f, m)));
  assert.deepEqual(drawn(f).sort(), ['src/app/main.ts>src/lib/util.js', 'src/app/view.tsx>src/lib/style.css', 'src/lib/a.ts>src/lib/b.ts', 'src/lib/b.ts>src/lib/a.ts']);
});

test('cycles-only keeps cycle members and cycle edges, combined with the other filters', () => {
  const f = { ...none(), cyclesOnly: true };
  assert.deepEqual(m.data.files.filter((x) => filePassesFilters(x, f, m)).map((x) => x.path), ['src/lib/a.ts', 'src/lib/b.ts']);
  assert.deepEqual(drawn(f).sort(), ['src/lib/a.ts>src/lib/b.ts', 'src/lib/b.ts>src/lib/a.ts']);
  assert.deepEqual(drawn({ ...f, hiddenKinds: new Set<Edge['kind']>(['reexport']) }), ['src/lib/a.ts>src/lib/b.ts']);
});
