import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, type AtlasData } from '../src/features/atlas/model';
import { boundedDistance, buildSearchIndex, search } from '../src/features/atlas/search';
import { syntheticAtlas } from '../src/features/atlas/dev/synthetic';

function repo(): AtlasData {
  const file = (path: string, functions: Array<{ name: string; line: number; kind: 'function' | 'class' | 'method' }> = []) => {
    const i = path.lastIndexOf('/');
    return { path, name: path.slice(i + 1), ext: path.slice(path.lastIndexOf('.')), folder: path.slice(0, i), size: 1, lines: 1, kind: 'code' as const, functions, exports: [] };
  };
  const files = [
    file('src/components/Button.tsx', [{ name: 'Button', line: 3, kind: 'function' }]),
    file('src/components/ButtonGroup.tsx'),
    file('src/components/IconButton.tsx'),
    file('src/hooks/useButton.ts'),
    file('src/lib/format.ts', [{ name: 'formatDate', line: 10, kind: 'function' }, { name: 'Formatter', line: 20, kind: 'class' }]),
    file('src/buttons/legacy.ts'),
  ];
  return { version: 1, repo: { owner: 'o', name: 'r', branch: 'main', commitSha: '', analyzedAt: '' }, files, edges: [], cycles: [], stats: { files: files.length, edges: 0, unresolved: 0, parseErrors: 0, skipped: [] } };
}

test('exact matches rank first, then prefix, then word-start, then substring', () => {
  const idx = buildSearchIndex(buildModel(repo()));
  const r = search(idx, 'button');
  assert.deepEqual(r.slice(0, 2).map((x) => [x.kind, x.name]), [['file', 'Button.tsx'], ['function', 'Button']]);
  const names = r.map((x) => x.name);
  assert.ok(names.indexOf('ButtonGroup.tsx') < names.indexOf('IconButton.tsx'), 'prefix before word-start');
  assert.ok(names.indexOf('IconButton.tsx') < names.indexOf('legacy.ts'), 'word-start before path-only match');
  assert.equal(r.find((x) => x.name === 'useButton.ts')?.tier, 2, 'camelCase word start');
});

test('folders, functions and classes are searchable with their type and path', () => {
  const idx = buildSearchIndex(buildModel(repo()));
  const fmt = search(idx, 'format');
  assert.deepEqual(fmt.map((x) => [x.kind, x.name, x.path, x.line]).slice(0, 3), [
    ['file', 'format.ts', 'src/lib/format.ts', undefined],
    ['class', 'Formatter', 'src/lib/format.ts', 20],
    ['function', 'formatDate', 'src/lib/format.ts', 10],
  ]);
  assert.equal(search(idx, 'hooks')[0].kind, 'folder');
});

test('small typos are tolerated but rank after real matches', () => {
  const idx = buildSearchIndex(buildModel(repo()));
  assert.equal(search(idx, 'buton')[0]?.name, 'Button.tsx', 'missing letter');
  assert.equal(search(idx, 'buttno')[0]?.name, 'Button.tsx', 'two neighbouring letters swapped');
  assert.equal(search(idx, 'formattr').find((x) => x.name === 'Formatter')?.tier, 5);
  assert.deepEqual(search(idx, 'xyz'), [], 'short unrelated queries match nothing');
  assert.equal(boundedDistance('abc', 'abcdef', 1), 2, 'bound is respected');
});

test('search over a 10,000-file synthetic repository stays fast', () => {
  const idx = buildSearchIndex(buildModel(syntheticAtlas(10000)));
  const t = performance.now();
  for (const q of ['file123', 'fiel12', 'group3', 'fn99']) search(idx, q);
  const ms = (performance.now() - t) / 4;
  console.log(`  search: ${idx.length} entries, ${ms.toFixed(1)} ms per query`);
  assert.ok(ms < 150, `${ms} ms`);
});
