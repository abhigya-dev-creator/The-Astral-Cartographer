/**
 * User exclusions (Settings → excluded files and folders), repository deletion, analysis history fields and the
 * system info endpoint. Real routes + real MongoDB (mongodb-memory-server) + a local fake Supabase, like api.test.ts.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import mongoose from 'mongoose';
import { rawZip } from './helpers.js';
import { compileExcludes, normalizeExcludePatterns } from '../services/excludePatterns.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

// private temp folder: api.test.ts counts temp workspaces and runs in parallel with this file
const PRIVATE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'astral-test-admin-'));
process.env.TMP = process.env.TEMP = process.env.TMPDIR = PRIVATE_TMP;

// ---- pure: pattern syntax ------------------------------------------------------------------------
test('exclude patterns: names anywhere, rooted paths, ** and folders-only', () => {
  const m = compileExcludes(normalizeExcludePatterns(['docs', '*.test.ts', 'src/legacy', 'examples/**', 'src/**/*.gen.ts', 'build-out/']))!;
  const yes = (p: string, dir = false) => assert.ok(m(p, dir), `${p} should be excluded`);
  const no = (p: string, dir = false) => assert.ok(!m(p, dir), `${p} should be kept`);
  yes('docs', true); yes('packages/a/docs', true); yes('src/a.test.ts'); yes('src/legacy', true); yes('src/legacy/old.ts');
  yes('examples/basic/index.js'); yes('src/a/b/c.gen.ts'); yes('src/x.gen.ts'); yes('build-out', true);
  no('src/docs.ts'); no('src/a.ts'); no('src/legacyCode.ts'); no('lib/x.gen.ts'); no('build-out'); no('srcx/legacy/a.ts');
  assert.equal(compileExcludes([]), null);
});

test('exclude patterns: validation, de-duplication and stable order', () => {
  assert.deepEqual(normalizeExcludePatterns([' docs ', './docs', 'b', 'a\\c']), ['a/c', 'b', 'docs']);
  assert.deepEqual(normalizeExcludePatterns('["x"]'), ['x'], 'multipart form value (JSON text)');
  assert.deepEqual(normalizeExcludePatterns(undefined), []);
  for (const bad of [['../secret'], ['/etc'], ['a;rm -rf'], 'not json', [1], Array.from({ length: 51 }, (_, i) => `p${i}`), ['x'.repeat(201)]]) {
    assert.throws(() => normalizeExcludePatterns(bad), (e: any) => e.name === 'UserFacingError', JSON.stringify(bad).slice(0, 40));
  }
});

// ---- integration ---------------------------------------------------------------------------------
let skipReason: string | false = false;
let stopDb: (() => Promise<void>) | null = null;
let fakeSupabase: http.Server;
let api: http.Server;
let base = '';
let Repository: any, Analysis: any, PathfinderProgress: any, atlasStore: any;

const A = 'token-user-a-aaaaaaaaaaaaaaaaaaaa';
const B = 'token-user-b-bbbbbbbbbbbbbbbbbbbb';
const USERS: Record<string, string> = { [A]: 'user-a', [B]: 'user-b' };

const PROJECT = {
  'proj/src/a.js': `import './b.js'; import '../docs/guide.js'; export function a(){}`,
  'proj/src/b.js': `export const b = () => 1;`,
  'proj/src/b.test.js': `import { b } from './b.js'; b();`,
  'proj/docs/guide.js': `export const guide = 1;`,
};
const zip = () => rawZip(Object.entries(PROJECT).map(([name, data]) => ({ name, data })));

async function upload(token: string, exclude?: string[], force = false) {
  const fd = new FormData();
  fd.append('file', new Blob([zip()], { type: 'application/zip' }), 'demo.zip');
  fd.append('projectName', 'demo');
  if (exclude) fd.append('exclude', JSON.stringify(exclude));
  if (force) fd.append('force', 'true');
  const res = await fetch(`${base}/api/repositories/analyze-zip`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, body: (await res.json()) as any };
}
async function call(method: string, p: string, token: string | null) {
  const res = await fetch(`${base}${p}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: (await res.json()) as any };
}

before(async () => {
  let uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      const mem = await MongoMemoryServer.create();
      uri = mem.getUri();
      stopDb = async () => { await mem.stop(); };
    } catch (e: any) {
      skipReason = `no MongoDB available (set MONGODB_TEST_URI): ${String(e.message).slice(0, 80)}`;
      return;
    }
  }
  await mongoose.connect(uri, { dbName: `astral_admin_test_${process.pid}` });
  await mongoose.connection.dropDatabase();

  fakeSupabase = http.createServer((req, res) => {
    const id = USERS[/^Bearer (.+)$/.exec(String(req.headers.authorization))?.[1] || ''];
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/auth/v1/user') && id) {
      return res.end(JSON.stringify({ id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.com`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }));
  });
  await new Promise<void>((r) => fakeSupabase.listen(0, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(fakeSupabase.address() as AddressInfo).port}`;
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';

  const [{ default: repoRoutes }, { default: pfRoutes }, { default: sysRoutes }, { errorHandler }, repoModel, analysisModel, pfModel, store] = await Promise.all([
    import('../routes/repositoryRoutes.js'),
    import('../routes/pathfinderRoutes.js'),
    import('../routes/systemRoutes.js'),
    import('../middleware/errorHandler.js'),
    import('../models/Repository.js'),
    import('../models/Analysis.js'),
    import('../models/PathfinderProgress.js'),
    import('../services/atlas/gridfsStore.js'),
  ]);
  Repository = repoModel.Repository; Analysis = analysisModel.Analysis; PathfinderProgress = pfModel.PathfinderProgress; atlasStore = store.atlasStore;
  await Promise.all([Repository.init(), Analysis.init(), PathfinderProgress.init()]);
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/repositories', repoRoutes);
  app.use('/api/repositories', pfRoutes);
  app.use('/api/system', sysRoutes);
  app.use(errorHandler);
  api = http.createServer(app);
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

after(async () => {
  api?.close(); fakeSupabase?.close();
  if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  await stopDb?.();
});

const t = (name: string, fn: () => Promise<void>) => test(name, async (ctx) => { if (skipReason) return ctx.skip(skipReason); await fn(); });

describe('user exclusions in the analysis pipeline', () => {
  t('excluded files are skipped by the analyzer and the map, and listed as excluded', async () => {
    const r = await upload(A, ['docs', '*.test.js']);
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    const analysis = await Analysis.findById(r.body.analysis._id).lean();
    assert.deepEqual(analysis.excludePatterns, ['*.test.js', 'docs']);
    assert.ok(analysis.metrics.coverage.excluded.user_excluded >= 2, JSON.stringify(analysis.metrics.coverage.excluded));
    assert.deepEqual(analysis.files.map((f: any) => f.path).sort(), ['src/a.js', 'src/b.js']);
    const atlas = await atlasStore.load(analysis.atlas.key);
    assert.deepEqual(atlas.files.map((f: any) => f.path).sort(), ['src/a.js', 'src/b.js']);
    assert.deepEqual(atlas.stats.skipped.filter((s: any) => s.reason === 'excluded by settings').map((s: any) => s.path).sort(), ['docs', 'src/b.test.js']);
    // the import of the excluded folder is reported as pointing at an excluded target, not as a broken import
    const toDocs = atlas.edges.find((e: any) => e.specifier === '../docs/guide.js');
    assert.deepEqual([toDocs.status, toDocs.reason], ['unresolved', 'target not analysed (excluded by settings)']);
  });

  t('an analysis is only reused when the same exclusions were used', async () => {
    const same = await upload(A, ['*.test.js', 'docs']); // same set, different order
    assert.equal(same.body.reused, true);
    const none = await upload(A);
    assert.equal(none.body.reused, false, 'no exclusions: a new analysis');
    assert.equal(none.body.analysis.files.length, 4);
    const noneAgain = await upload(A, []);
    assert.equal(noneAgain.body.reused, true, 'empty list = no exclusions');
  });

  t('invalid exclusions are rejected before any work is done', async () => {
    const before = await Analysis.countDocuments();
    const r = await upload(A, ['../outside']);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not allowed/);
    assert.equal(await Analysis.countDocuments(), before);
  });
});

describe('analysis history', () => {
  t('history carries line counts and finding severities for real trend charts', async () => {
    const repo = await Repository.findOne({ userId: 'user-a' }).lean();
    const r = await call('GET', `/api/repositories/${repo._id}`, A);
    const h = r.body.analysisHistory.find((x: any) => x.status === 'completed');
    assert.equal(typeof h.metrics.totalLines, 'number');
    assert.ok(Array.isArray(h.issues));
    for (const i of h.issues) assert.deepEqual(Object.keys(i).filter((k) => k !== '_id').sort(), ['severity', 'type']);
  });
});

describe('deleting a repository', () => {
  t('removes the repository, its analyses, stored maps and saved progress; only for the owner', async () => {
    const repo = await Repository.findOne({ userId: 'user-a' }).lean();
    const analyses = await Analysis.find({ repositoryId: repo._id }).lean();
    const keys = analyses.filter((a: any) => a.atlas?.key).map((a: any) => a.atlas.key);
    assert.ok(keys.length > 0);
    await PathfinderProgress.create({ userId: 'user-a', repositoryId: repo._id, completed: ['src/a.js'] });

    assert.equal((await call('DELETE', `/api/repositories/${repo._id}`, B)).status, 404, 'other users cannot delete it');
    assert.equal((await call('DELETE', `/api/repositories/${repo._id}`, null)).status, 401);
    const r = await call('DELETE', `/api/repositories/${repo._id}`, A);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
    assert.equal(await Repository.countDocuments({ _id: repo._id }), 0);
    assert.equal(await Analysis.countDocuments({ repositoryId: repo._id }), 0);
    assert.equal(await PathfinderProgress.countDocuments({ repositoryId: repo._id }), 0);
    for (const k of keys) assert.equal(await atlasStore.exists(k), false, `map ${k} removed`);
    assert.equal((await call('DELETE', `/api/repositories/${repo._id}`, A)).status, 404);
  });

  t('is refused while an analysis is running', async () => {
    const repo = await Repository.create({ userId: 'user-a', name: 'busy', owner: 'o', fullName: 'o/busy', source: 'github', analysisStatus: 'analyzing' });
    const r = await call('DELETE', `/api/repositories/${repo._id}`, A);
    assert.equal(r.status, 409);
    assert.equal(await Repository.countDocuments({ _id: repo._id }), 1);
  });
});

describe('system info', () => {
  t('reports the real limits, skipped folders and language support (signed-in users only)', async () => {
    assert.equal((await call('GET', '/api/system/info', null)).status, 401);
    const r = await call('GET', '/api/system/info', A);
    assert.equal(r.status, 200);
    assert.equal(r.body.limits.maxFiles, 5000);
    assert.equal(r.body.limits.maxZipUploadBytes, 50 * 1024 * 1024);
    assert.ok(r.body.alwaysSkippedFolders.includes('node_modules'));
    const ts = r.body.languages.find((l: any) => l.name === 'TypeScript');
    assert.deepEqual([ts.functions, ts.dependencies], ['full', 'full']);
    assert.equal(r.body.languages.find((l: any) => l.name === 'Java').dependencies, 'map only');
    assert.equal(typeof r.body.githubTokenConfigured, 'boolean');
  });
});
