import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseAtlasData, type AtlasData, type Edge } from '../src/features/atlas/model';
import { buildRepoFacts, isTestPath } from '../src/features/pathfinder/repoFacts';
import { buildLearningPath, nextStepReason, MAX_STEPS } from '../src/features/pathfinder/learningPath';
import { deriveOpportunities, describeTests, filterOpportunities, suggestTestPath } from '../src/features/pathfinder/opportunities';
import { answerBeginner, answerContributor, mentionedFile } from '../src/features/pathfinder/companionAnswers';
import { codeViewLink, githubFileUrl } from '../src/lib/codeLinks';
import type { IArchitecturalIssue } from '../src/lib/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = () => parseAtlasData(JSON.parse(fs.readFileSync(path.join(here, '../src/features/atlas/sample/atlas-sample.json'), 'utf8')));

function repo(files: Record<string, number>, edges: Array<[string, string, number?]>, extra: Partial<AtlasData> = {}): AtlasData {
  const fs_ = Object.entries(files).map(([p, lines]) => {
    const i = p.lastIndexOf('/');
    const name = p.slice(i + 1);
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    const code = /\.(ts|tsx|js|jsx|java)$/.test(name);
    return { path: p, name, ext, folder: i < 0 ? '' : p.slice(0, i), size: lines * 30, lines, kind: code ? 'code' as const : 'other' as const, functions: [], exports: code ? ['x'] : [] };
  });
  const es: Edge[] = edges.map(([from, to, line]) => ({ from, to, specifier: `./${to}`, line: line ?? 1, kind: 'import', status: 'resolved' }));
  return { version: 1, repo: { owner: 'o', name: 'r', branch: 'main', commitSha: 'a'.repeat(40), analyzedAt: '' }, files: fs_, edges: es, cycles: [], stats: { files: fs_.length, edges: es.length, unresolved: 0, parseErrors: 0, skipped: [] }, ...extra };
}

test('learning path on a real analysis: README/manifests, entry points, then their main modules; every step is a real file', () => {
  const facts = buildRepoFacts(sample());
  const steps = buildLearningPath(facts);
  assert.ok(steps.length >= 8 && steps.length <= MAX_STEPS);
  for (const s of steps) assert.ok(facts.file(s.path), `${s.path} exists`);
  assert.equal(new Set(steps.map((s) => s.path)).size, steps.length, 'no duplicates');
  const roles = steps.map((s) => s.role);
  assert.ok(roles.indexOf('manifest') < roles.indexOf('entry') && roles.indexOf('entry') < roles.indexOf('root'), 'manifest -> entry -> main module');
  const entries = steps.filter((s) => s.role === 'entry').map((s) => s.path);
  assert.deepEqual(entries.sort(), ['astral-cartographer/client/src/main.tsx', 'astral-cartographer/server/src/index.ts']);
  for (const e of entries) assert.equal(facts.importedBy(e).length, 0, 'entry points are imported by nothing');
  const app = steps.find((s) => s.path.endsWith('client/src/App.tsx'))!;
  assert.equal(app.role, 'root');
  assert.match(app.what[0], /main\.tsx imports this file \(line \d+\)/);
  // the role comes from the parent folder or the file name, not from any folder in the path ("client")
  const api = steps.find((s) => s.path.endsWith('client/src/lib/api.ts'))!;
  assert.match(api.what[0], /^Its name \("api"\)/);
});

test('learning path: fewer than three structural steps fall back to the largest files, honestly labelled', () => {
  const facts = buildRepoFacts(repo({ 'src/A.java': 300, 'src/B.java': 120, 'src/C.java': 50 }, []));
  const steps = buildLearningPath(facts);
  assert.deepEqual(steps.map((s) => s.path), ['src/A.java', 'src/B.java', 'src/C.java']);
  assert.match(steps[0].what[0], /chosen by size/);
});

test('next-step reasons use the import graph when it links the two steps', () => {
  const facts = buildRepoFacts(repo({ 'src/main.ts': 10, 'src/app.ts': 40, 'src/x.ts': 5, 'src/y.ts': 5 }, [['src/main.ts', 'src/app.ts', 3], ['src/app.ts', 'src/x.ts'], ['src/app.ts', 'src/y.ts']]));
  const [entry, root] = buildLearningPath(facts);
  assert.deepEqual([entry.path, root.path], ['src/main.ts', 'src/app.ts']);
  assert.equal(nextStepReason(facts, entry, root), 'main.ts imports app.ts (line 3), so it continues the path you just followed.');
});

test('test detection covers common conventions', () => {
  for (const p of ['a/b.test.ts', 'a/b.spec.tsx', '__tests__/x.js', 'tests/x.ts', 'src/test/java/a/BTest.java', 'pkg/test_x.py', 'x_test.go']) assert.ok(isTestPath(p), p);
  for (const p of ['src/testing.ts', 'test-fixtures/a.ts', 'src/latest.ts', 'src/contest/a.ts']) assert.ok(!isTestPath(p), p);
});

test('opportunities: only evidence-backed, every listed existing file is real, suggested files are marked as new', () => {
  const facts = buildRepoFacts(sample());
  const { list, limits } = deriveOpportunities(facts, []);
  assert.ok(list.length > 0);
  assert.ok(limits.some((l) => /accessibility/i.test(l)), 'states what cannot be derived');
  for (const o of list) {
    assert.ok(o.evidence.length > 0, `${o.title} has evidence`);
    for (const f of o.files) assert.equal(!!facts.file(f.path), f.exists, `${f.path} exists = ${f.exists}`);
    assert.ok(['Low', 'Medium', 'High'].includes(o.effort));
  }
  assert.equal(new Set(list.map((o) => o.id)).size, list.length, 'ids are unique');
  const t = list.find((o) => o.id === 'tests:astral-cartographer/client/src/lib/analysisFormat.ts')!;
  assert.ok(t, 'untested, widely imported module');
  assert.ok(!facts.testedDirectly.has(t.files[0].path));
  // this analysis has tests only in server/, so no location is invented for a client module
  assert.ok(!t.files.some((f) => !f.exists));
  const server = list.find((o) => o.id.startsWith('tests:astral-cartographer/server/'));
  if (server) for (const f of server.files.filter((x) => !x.exists)) assert.match(f.path, /^astral-cartographer\/server\/src\/test\/[^/]+\.test\.ts$/);
  // a module the tests import is not suggested
  assert.ok(!list.some((o) => o.id === 'tests:astral-cartographer/client/src/features/atlas/filters.ts'));
  assert.equal(describeTests(facts)?.includes('*.test.ts'), true);
});

test('opportunities from findings keep the analyzer certainty; without findings the limitation is stated', () => {
  const data = repo({ 'src/a.ts': 20, 'src/b.ts': 20, 'src/big.ts': 900, 'src/u.ts': 10, 'src/v.ts': 10, 'README.md': 40 }, [['src/a.ts', 'src/b.ts', 2], ['src/b.ts', 'src/a.ts', 4], ['src/u.ts', 'src/big.ts'], ['src/v.ts', 'src/big.ts']]);
  const facts = buildRepoFacts(data);
  const issues: IArchitecturalIssue[] = [
    { id: 'c1', type: 'circular_dependency', severity: 'error', confidence: 'confirmed', file: 'src/a.ts', line: 2, affectedFiles: ['src/a.ts', 'src/b.ts'], description: 'Circular dependency detected: src/a.ts -> src/b.ts -> src/a.ts.', rule: 'No Circular Dependencies' },
    { id: 'o1', type: 'oversized_file', severity: 'warning', confidence: 'heuristic', file: 'src/big.ts', line: 1, affectedFiles: ['src/big.ts'], description: 'Module exceeds recommended size.', rule: 'Single Responsibility Principle' },
  ];
  const { list } = deriveOpportunities(facts, issues);
  const cycle = list.find((o) => o.id === 'finding:c1')!;
  assert.equal(cycle.certainty, 'confirmed');
  assert.equal(cycle.title, 'Break the circular import between a.ts and b.ts');
  assert.equal(cycle.effort, 'Medium');
  const big = list.find((o) => o.id === 'finding:o1')!;
  assert.equal(big.certainty, 'heuristic');
  assert.equal(big.goodFirst, false, 'heuristics are never "good first issue"');
  assert.deepEqual(big.files.map((f) => f.path), ['src/big.ts', 'src/u.ts', 'src/v.ts']);
  assert.ok(deriveOpportunities(facts, null).limits[0].includes('not available'));
});

test('opportunities: unresolved imports, JavaScript files in a TypeScript area, missing README; nothing else invented', () => {
  const data = repo({ 'app/a.ts': 10, 'app/b.ts': 10, 'app/c.ts': 10, 'app/d.ts': 10, 'app/e.ts': 10, 'app/old.js': 30, 'app/vite.config.js': 5 }, [['app/a.ts', 'app/b.ts'], ['app/old.js', 'app/a.ts']]);
  data.edges.push({ from: 'app/a.ts', to: null, specifier: './gone', line: 7, kind: 'import', status: 'unresolved', reason: 'file not found' });
  data.edges.push({ from: 'app/b.ts', to: null, specifier: '<dynamic expression>', line: 2, kind: 'dynamic', status: 'unresolved', reason: 'dynamic path' });
  const { list } = deriveOpportunities(buildRepoFacts(data), []);
  const ids = list.map((o) => o.id).sort();
  assert.ok(ids.includes('unresolved:app/a.ts:./gone'));
  assert.ok(!ids.some((i) => i.startsWith('unresolved:app/b.ts')), 'dynamic paths are not reported as broken');
  const ts = list.find((o) => o.type === 'Type Safety')!;
  assert.deepEqual(ts.files.map((f) => f.path), ['app/old.js'], 'tool configs are not counted');
  assert.ok(ids.includes('docs:readme'));
  assert.ok(ids.includes('tests:first'), 'no test files at all: one "first test" opportunity');
});

test('suggested test paths mirror the repository conventions (Java src/test, colocated specs)', () => {
  const java = buildRepoFacts(repo({ 'svc/src/main/java/com/x/A.java': 50, 'svc/src/test/java/com/x/OtherTest.java': 20 }, []));
  assert.deepEqual(suggestTestPath(java, java.file('svc/src/main/java/com/x/A.java')!)?.path, 'svc/src/test/java/com/x/ATest.java');
  const colocated = buildRepoFacts(repo({ 'src/a.ts': 10, 'src/a.spec.ts': 10, 'src/lib/b.ts': 10 }, []));
  assert.equal(suggestTestPath(colocated, colocated.file('src/lib/b.ts')!)?.path, 'src/lib/b.spec.ts');
});

test('filters combine type, effort, area and saved', () => {
  const { list } = deriveOpportunities(buildRepoFacts(sample()), []);
  const saved = new Set([list[0].id]);
  const base = { type: 'all', effort: 'all', area: 'all', savedOnly: false };
  assert.equal(filterOpportunities(list, base, saved).length, list.length);
  assert.ok(filterOpportunities(list, { ...base, type: 'Testing' }, saved).every((o) => o.type === 'Testing'));
  assert.ok(filterOpportunities(list, { ...base, effort: 'Low' }, saved).every((o) => o.effort === 'Low'));
  assert.ok(filterOpportunities(list, { ...base, area: 'server' }, saved).every((o) => o.areas.includes('server')));
  assert.deepEqual(filterOpportunities(list, { ...base, savedOnly: true }, saved).map((o) => o.id), [list[0].id]);
  assert.equal(filterOpportunities(list, { ...base, type: 'Testing', effort: 'High', area: 'nowhere' }, saved).length, 0);
});

test('companion answers come from the analysis and admit what needs an AI model', () => {
  const facts = buildRepoFacts(sample());
  const steps = buildLearningPath(facts);
  const main = 'astral-cartographer/client/src/main.tsx';
  const why = answerBeginner({ id: 'why-entry' }, facts, main, steps);
  assert.equal(why.kind, 'analysis');
  assert.ok(why.bullets!.some((b) => b.includes('No other analysed file imports it')));
  const dep = answerBeginner({ text: 'what depends on api.ts?' }, facts, main, steps);
  assert.equal(dep.title, 'Files that import api.ts');
  assert.equal(dep.bullets!.length, facts.importedBy('astral-cartographer/client/src/lib/api.ts').length);
  const free = answerBeginner({ text: 'Why did they choose zustand over redux?' }, facts, main, steps);
  assert.equal(free.kind, 'limit');
  assert.match(free.paragraphs[0], /No AI model is connected/);
  assert.equal(mentionedFile('explain supabase.ts please', facts), 'astral-cartographer/client/src/lib/supabase.ts');
  const { list } = deriveOpportunities(facts, []);
  const o = list[0];
  assert.deepEqual(answerContributor({ id: 'changes' }, facts, o, list).bullets, o.steps);
  assert.equal(answerContributor({ text: 'which one should I start with?' }, facts, null, list).kind, 'analysis');
});

test('code links: Dependency Atlas until the Code Explorer exists; GitHub only with a valid commit', () => {
  const r = { _id: 'abc', owner: 'octo', name: 'repo', source: 'github' as const };
  assert.deepEqual(codeViewLink(r, 'src/a b.ts', 12), { to: '/explorer?repo=abc&file=src%2Fa+b.ts&line=12', label: 'Open in Code Explorer' });
  assert.equal(githubFileUrl(r, 'f'.repeat(40), 'src/a b.ts', 3), `https://github.com/octo/repo/blob/${'f'.repeat(40)}/src/a%20b.ts#L3`);
  assert.equal(githubFileUrl(r, 'main', 'src/a.ts'), null);
  assert.equal(githubFileUrl({ ...r, source: 'zip' }, 'f'.repeat(40), 'src/a.ts'), null);
  assert.equal(githubFileUrl(r, 'f'.repeat(40), '../etc/passwd'), null);
});
