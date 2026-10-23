import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeAtlas, type AtlasInput } from '../services/atlas/analyzeAtlas.js';
import { loadFolder } from '../services/atlas/loadFolder.js';
import { JsonFileAtlasStore, MemoryAtlasStore, encodeAtlas } from '../services/atlas/store.js';
import { CodeAnalyzer } from '../services/analyzer.js';
import type { AtlasData, Edge } from '../services/atlas/types.js';
import { memoryReader, snapshotResolutions } from './resolverSnapshot.js';
import { cleanupRepos, makeRepo } from './helpers.js';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-fixtures/atlas');
const REPO = { owner: 'test', name: 'fixture', branch: 'main', commitSha: 'a'.repeat(40), analyzedAt: '2026-01-01T00:00:00.000Z' };

function atlasOf(dir: string): AtlasData {
  const { files, skipped } = loadFolder(dir);
  return analyzeAtlas({ repo: REPO, files, skipped });
}
const run = (fixture: string) => atlasOf(path.join(FIX, fixture));
const edge = (a: AtlasData, from: string, specifier: string): Edge => {
  const e = a.edges.find((x) => x.from === from && x.specifier === specifier);
  assert.ok(e, `edge ${from} -> ${specifier} exists`);
  return e!;
};
const file = (a: AtlasData, p: string) => {
  const f = a.files.find((x) => x.path === p);
  assert.ok(f, `file ${p} exists`);
  return f!;
};

after(() => cleanupRepos());

test('extension guessing, .js -> .ts mapping and JSON targets', () => {
  const a = run('ext-guessing');
  assert.equal(edge(a, 'src/main.ts', './b').to, 'src/b.tsx');
  assert.equal(edge(a, 'src/main.ts', './c').to, 'src/c.js');
  assert.equal(edge(a, 'src/main.ts', './data').to, 'src/data.json');
  assert.equal(edge(a, 'src/main.ts', './d.js').to, 'src/d.ts');
  assert.equal(file(a, 'src/data.json').kind, 'asset');
});

test('index files, including a trailing-slash directory import', () => {
  const a = run('index-files');
  assert.equal(edge(a, 'src/app.ts', './components').to, 'src/components/index.ts');
  assert.equal(edge(a, 'src/app.ts', './utils/').to, 'src/utils/index.js');
  assert.equal(a.stats.unresolved, 0);
});

test('resolver: a trailing slash names a directory (index file only), exactly like Node', () => {
  // both a file and a folder called "utils"
  const both = atlasOf(makeRepo({
    'src/a.js': "import './utils';\nimport './utils/';\n",
    'src/utils.js': 'export default 1;\n',
    'src/utils/index.js': 'export default 2;\n',
  }));
  assert.equal(edge(both, 'src/a.js', './utils').to, 'src/utils.js', 'no slash: the file wins');
  assert.equal(edge(both, 'src/a.js', './utils/').to, 'src/utils/index.js', 'slash: the directory index');
  // only a file: './utils/' must NOT fall back to utils.js
  const fileOnly = atlasOf(makeRepo({ 'src/a.js': "import './utils/';\n", 'src/utils.js': 'export default 1;\n' }));
  assert.deepEqual([edge(fileOnly, 'src/a.js', './utils/').status, edge(fileOnly, 'src/a.js', './utils/').to], ['unresolved', null]);
  // the shared resolver itself (used by the Home analysis too)
  const dir = makeRepo({ 'lib/main.ts': "import x from '../src/';\n", 'src/index.ts': 'export default 1;\n' });
  const res = snapshotResolutions(dir) as Array<{ specifier: string; resolution: { kind: string; target?: string } }>;
  assert.deepEqual(res.map((r) => [r.specifier, r.resolution.kind, r.resolution.target]), [['../src/', 'local', 'src/index.ts']]);
});

test('tsconfig paths and baseUrl, inherited through "extends" (JSONC with comments and trailing commas)', () => {
  const a = run('tsconfig-paths');
  assert.equal(edge(a, 'src/main.ts', '@app/helpers/helper').to, 'src/helpers/helper.ts');
  assert.equal(edge(a, 'src/main.ts', '@lib').to, 'src/lib/index.ts');
  assert.equal(edge(a, 'src/main.ts', 'src/config').to, 'src/config.ts');
});

test('re-exports are edges of kind "reexport" and appear in exports', () => {
  const a = run('reexports');
  const e = a.edges.filter((x) => x.from === 'src/index.ts');
  assert.deepEqual(e.map((x) => [x.specifier, x.kind, x.to]), [
    ['./a', 'reexport', 'src/a.ts'],
    ['./b', 'reexport', 'src/b.ts'],
    ['./c', 'reexport', 'src/c.ts'],
    ['./types', 'reexport', 'src/types.ts'],
  ]);
  assert.deepEqual(file(a, 'src/index.ts').exports, ['*', 'T', 'bee', 'cNs']);
});

test('require() with string literals, TS import-equals, and non-literal require marked unresolved', () => {
  const a = run('require');
  assert.equal(edge(a, 'lib/main.cjs', './util').to, 'lib/util.cjs');
  assert.equal(edge(a, 'lib/main.cjs', './util').kind, 'require');
  assert.deepEqual([edge(a, 'lib/main.cjs', 'lodash/get').status, edge(a, 'lib/main.cjs', 'path').reason], ['external', 'built-in module']);
  assert.equal(edge(a, 'lib/legacy.ts', './util.cjs').to, 'lib/util.cjs');
  const dyn = edge(a, 'lib/main.cjs', '<dynamic expression>');
  assert.deepEqual([dyn.status, dyn.reason, dyn.to, dyn.line], ['unresolved', 'dynamic path', null, 5]);
});

test('literal dynamic imports resolve; template strings with ${} are "dynamic path"', () => {
  const a = run('dynamic-imports');
  assert.equal(edge(a, 'src/router.ts', './pages/Lazy').to, 'src/pages/Lazy.ts');
  assert.equal(edge(a, 'src/router.ts', './pages/Static').to, 'src/pages/Static.ts');
  const d = edge(a, 'src/router.ts', '<dynamic expression>');
  assert.deepEqual([d.kind, d.status, d.reason, d.line], ['dynamic', 'unresolved', 'dynamic path', 4]);
});

test('unresolved imports keep a reason and never get a target', () => {
  const a = run('unresolved');
  assert.equal(a.stats.unresolved, 4);
  for (const e of a.edges) assert.deepEqual([e.status, e.to], ['unresolved', null]);
  assert.equal(edge(a, 'src/main.ts', './missing').reason, 'file not found');
  assert.equal(edge(a, 'src/main.ts', '../outside/repo').reason, 'file not found');
  assert.match(edge(a, 'src/main.ts', '@/not-configured').reason!, /alias/);
});

test('external packages, built-ins and URLs are "external" and never become file nodes', () => {
  const a = run('external');
  assert.deepEqual(a.edges.map((e) => [e.specifier, e.status, e.reason, e.to]), [
    ['react', 'external', 'package', null],
    ['lodash/get', 'external', 'package', null],
    ['@scope/ui/button', 'external', 'package', null],
    ['node:fs', 'external', 'built-in module', null],
    ['path', 'external', 'built-in module', null],
    ['https://cdn.example.com/lib.js', 'external', 'URL import', null],
  ]);
  assert.deepEqual(a.files.map((f) => f.path), ['src/main.ts']);
});

test('circular imports are reported as strongly connected components', () => {
  const a = run('circular');
  assert.deepEqual(a.cycles, [['src/a.ts', 'src/b.ts', 'src/c.ts'], ['src/d.ts', 'src/e.ts']]);
  assert.ok(!a.cycles.flat().includes('src/leaf.ts'), 'a file that only imports a cycle is not part of it');
});

test('a file with a syntax error is kept with parseError and does not stop the analysis', () => {
  const a = run('syntax-error');
  const broken = file(a, 'src/broken.ts');
  assert.ok(broken.parseError);
  assert.equal(broken.complexity, undefined, 'unknown, not a made-up 1');
  assert.equal(broken.tokens, undefined);
  assert.equal(a.stats.parseErrors, 1);
  assert.equal(edge(a, 'src/user.ts', './broken').to, 'src/broken.ts');
  assert.equal(edge(a, 'src/user.ts', './ok').to, 'src/ok.ts');
});

test('monorepo workspace packages resolve to their source folders (main, exports, subpath exports)', () => {
  const a = run('monorepo');
  const from = 'packages/app/src/main.tsx';
  assert.equal(edge(a, from, '@acme/ui').to, 'packages/ui/src/index.ts');
  assert.equal(edge(a, from, '@acme/core').to, 'packages/core/src/main.ts');
  assert.equal(edge(a, from, '@acme/core/util').to, 'packages/core/src/util.ts');
  assert.equal(edge(a, from, 'react').status, 'external');
});

test('imports in comments and strings are ignored; assets, functions, exports, complexity and tokens', () => {
  const a = run('assets-and-traps');
  assert.deepEqual(a.edges.map((e) => e.specifier), ['./App.css', './logo.svg', './config.json']);
  assert.deepEqual(['src/App.css', 'src/logo.svg', 'src/config.json'].map((p) => file(a, p).kind), ['asset', 'asset', 'asset']);
  assert.equal(file(a, 'README.md').kind, 'other');
  const app = file(a, 'src/App.tsx');
  assert.deepEqual(app.functions, [
    { name: 'App', line: 7, kind: 'class' },
    { name: 'method', line: 8, kind: 'method' },
    { name: 'helper', line: 10, kind: 'function' },
    { name: 'arrow', line: 14, kind: 'function' },
  ]);
  assert.deepEqual(app.exports, ['arrow', 'default', 'helper']);
  // 1 + if, &&, ??, ?: (method) + for-of, case, case, catch, || (helper); `default:` is not a decision
  assert.equal(app.complexity, 10);
  assert.ok((app.tokens ?? 0) > 100);
  assert.equal(app.lines, 14);
});

test('skip rules: ignored directories, minified, .d.ts and files over 1 MB are listed, not analysed', () => {
  const a = run('skip-rules');
  assert.deepEqual(a.stats.skipped, [
    { path: 'coverage', reason: 'ignored directory' },
    { path: 'dist', reason: 'ignored directory' },
    { path: 'node_modules', reason: 'ignored directory' },
    { path: 'src/types.d.ts', reason: 'type declaration' },
    { path: 'src/vendor.min.js', reason: 'minified' },
  ]);
  assert.deepEqual(a.files.map((f) => f.path), ['src/main.ts']);
  assert.equal(edge(a, 'src/main.ts', './types').reason, 'target not analysed (type declaration)');

  const big = makeRepo({ 'src/big.js': `// ${'x'.repeat(1024 * 1024)}\n`, 'src/ok.js': "import './big';\n" });
  const b = atlasOf(big);
  assert.deepEqual(b.stats.skipped, [{ path: 'src/big.js', reason: 'too large' }]);
  assert.equal(edge(b, 'src/ok.js', './big').reason, 'target not analysed (too large)');
});

test('same input gives identical output; every resolved target is a real file node', () => {
  for (const d of fs.readdirSync(FIX)) {
    if (!fs.statSync(path.join(FIX, d)).isDirectory()) continue;
    const one = run(d);
    assert.deepEqual(run(d), one, `${d} is deterministic`);
    const paths = new Set(one.files.map((f) => f.path));
    for (const e of one.edges) {
      if (e.status === 'resolved') assert.ok(e.to && paths.has(e.to), `${d}: ${e.from} -> ${e.to} exists`);
      else assert.equal(e.to, null, `${d}: ${e.status} edge has no target`);
    }
  }
});

test('analysis input is path + text: identical result without touching the disk', () => {
  const dir = path.join(FIX, 'monorepo');
  const { files } = loadFolder(dir);
  const fromMemory = analyzeAtlas({ repo: REPO, files: files.map((f) => ({ path: f.path, text: f.text })) } as AtlasInput);
  assert.deepEqual(fromMemory, run('monorepo'));
});

test('no source code is stored in AtlasData', () => {
  const a = run('assets-and-traps');
  const json = JSON.stringify(a);
  for (const fragment of ['return xs.length', 'color: red', 'import fake from']) assert.ok(!json.includes(fragment), fragment);
});

test('resolver: disk-based results are identical to before the readText option, and readText matches disk', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(FIX, 'resolver-baseline.json'), 'utf8'));
  for (const [name, expected] of Object.entries(baseline)) {
    const dir = path.join(FIX, name);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshotResolutions(dir))), expected, `${name}: disk unchanged`);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshotResolutions(dir, memoryReader(dir)))), expected, `${name}: readText`);
  }
});

test('CodeAnalyzer keepSources: off by default, reused texts give an identical map, cap falls back to disk and logs', async () => {
  const dir = path.join(FIX, 'monorepo');
  const fromDisk = atlasOf(dir);
  const stable = (x: unknown) => JSON.parse(JSON.stringify(x));

  // backward compatible: without the option nothing is kept and the analysis result is unchanged
  const plain = new CodeAnalyzer(dir);
  const plainResult = await plain.analyze();
  assert.equal(plain.keptSources, null);
  const kept = new CodeAnalyzer(dir, { keepSources: true });
  const keptResult = await kept.analyze();
  assert.deepEqual(stable({ ...keptResult.metrics, coverage: { ...keptResult.metrics.coverage, analysisMs: 0 } }), stable({ ...plainResult.metrics, coverage: { ...plainResult.metrics.coverage, analysisMs: 0 } }));
  assert.ok(kept.keptSources && kept.keptSources.size > 0);
  assert.equal(kept.keptSourcesCapped, false);

  // the map built from kept texts equals the map built from disk, and needs no disk reads for text files
  const viaMemory = loadFolder(dir, { texts: kept.keptSources });
  assert.equal(viaMemory.diskReads, 0);
  assert.deepEqual(analyzeAtlas({ repo: REPO, files: viaMemory.files, skipped: viaMemory.skipped }), fromDisk);

  // memory cap: stop keeping, warn once, and the map is still identical (remaining files are re-read from disk)
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); };
  let capped: CodeAnalyzer;
  try {
    capped = new CodeAnalyzer(dir, { keepSources: { maxBytes: 80 } });
    await capped.analyze();
  } finally {
    console.warn = warn;
  }
  assert.equal(capped.keptSourcesCapped, true);
  assert.equal(warnings.filter((w) => /keepSources cap .* reached/.test(w)).length, 1);
  const partial = loadFolder(dir, { texts: capped.keptSources });
  assert.ok(partial.diskReads > 0, 'fell back to disk');
  assert.deepEqual(analyzeAtlas({ repo: REPO, files: partial.files, skipped: partial.skipped }), fromDisk);
});

test('stores keep gzip-compressed JSON and round-trip exactly', async () => {
  const a = run('monorepo');
  const mem = new MemoryAtlasStore();
  const meta = await mem.save('k1', a);
  assert.deepEqual(await mem.load('k1'), a);
  assert.ok(meta.storedBytes < meta.bytes);
  assert.equal(meta.bytes, encodeAtlas(a).bytes);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-'));
  try {
    const store = new JsonFileAtlasStore(dir);
    await store.save('repo_1', a);
    assert.deepEqual(await store.load('repo_1'), a);
    await store.remove('repo_1');
    assert.equal(await store.load('repo_1'), null);
    await assert.rejects(store.save('../escape', a), /Invalid atlas key/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
