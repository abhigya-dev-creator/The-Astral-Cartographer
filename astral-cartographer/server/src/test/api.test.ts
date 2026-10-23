/**
 * Integration tests: real Express routes + real MongoDB + real Supabase client talking to a local fake Supabase.
 * MongoDB comes from MONGODB_TEST_URI, or mongodb-memory-server if its binary is available; otherwise the suite is skipped.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import express from 'express';
import mongoose from 'mongoose';
import { rawZip } from './helpers.js';

let skipReason: string | false = false;
let stopDb: (() => Promise<void>) | null = null;
let fakeSupabase: http.Server;
let api: http.Server;
let base = '';
let supabaseDown = false;
let Repository: any, Analysis: any, RepositoryService: any;

const TOKENS: Record<string, { id: string; email: string }> = {
  'token-user-a-aaaaaaaaaaaaaaaaaaaa': { id: 'user-a', email: 'a@example.com' },
  'token-user-b-bbbbbbbbbbbbbbbbbbbb': { id: 'user-b', email: 'b@example.com' },
};
const A = 'token-user-a-aaaaaaaaaaaaaaaaaaaa';
const B = 'token-user-b-bbbbbbbbbbbbbbbbbbbb';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const project = (extra: Record<string, string> = {}) =>
  rawZip(Object.entries({ 'proj/a.js': `import './b.js'; export function a(){}`, 'proj/b.js': `export const b = () => 1;`, ...extra }).map(([name, data]) => ({ name, data })));

async function upload(token: string, bytes: Buffer, name = 'demo', extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'application/zip' }), `${name}.zip`);
  fd.append('projectName', name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const res = await fetch(`${base}/api/repositories/analyze-zip`, { method: 'POST', headers: auth(token), body: fd });
  return { status: res.status, body: (await res.json()) as any };
}
const get = async (p: string, token?: string) => {
  const res = await fetch(`${base}${p}`, { headers: token ? auth(token) : {} });
  return { status: res.status, body: (await res.json()) as any };
};
const tmpAstralDirs = () => fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('astral-') && !d.startsWith('astral-test') && !d.startsWith('astral-sec'));

before(async () => {
  // --- database
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
  await mongoose.connect(uri, { dbName: `astral_api_test_${process.pid}` });
  await mongoose.connection.dropDatabase();

  // --- fake Supabase: validates tokens the way the real /auth/v1/user endpoint does
  fakeSupabase = http.createServer((req, res) => {
    if (supabaseDown) return req.socket.destroy();
    const tok = /^Bearer (.+)$/.exec(String(req.headers.authorization))?.[1] || '';
    const u = TOKENS[tok];
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/auth/v1/user') && u) {
      return res.end(JSON.stringify({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }));
  });
  await new Promise<void>((r) => fakeSupabase.listen(0, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(fakeSupabase.address() as AddressInfo).port}`;
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';

  // --- app under test (real routes + real error handler)
  const [{ default: routes }, { errorHandler }, repoModel, analysisModel, svc] = await Promise.all([
    import('../routes/repositoryRoutes.js'),
    import('../middleware/errorHandler.js'),
    import('../models/Repository.js'),
    import('../models/Analysis.js'),
    import('../services/repositoryService.js'),
  ]);
  Repository = repoModel.Repository; Analysis = analysisModel.Analysis; RepositoryService = svc.RepositoryService;
  await Promise.all([Repository.init(), Analysis.init()]);
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/repositories', routes);
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

describe('authentication', () => {
  t('missing / malformed Authorization header -> 401', async () => {
    assert.equal((await get('/api/repositories')).status, 401);
    assert.equal((await get('/api/repositories', 'short')).status, 401);
  });

  t('a forged, well-formed JWT is rejected (no unverified-payload fallback)', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-a', exp: 9999999999 })}.${'x'.repeat(43)}`;
    assert.equal((await get('/api/repositories', forged)).status, 401);
    // the OLD middleware parsed the payload of any token whenever getUser() returned no user -> authenticated as `sub`.
    supabaseDown = true;
    try { assert.equal((await get('/api/repositories', forged)).status, 503, 'fails closed when the auth service is unreachable'); }
    finally { supabaseDown = false; }
  });

  t('a valid token authenticates', async () => {
    assert.equal((await get('/api/repositories', A)).status, 200);
  });
});

describe('analysis, persistence and API behaviour', () => {
  t('ZIP analysis persists a complete, pinned result', async () => {
    const before = tmpAstralDirs().length;
    const zip = project();
    const r = await upload(A, zip, 'demo');
    assert.equal(r.status, 200);
    assert.equal(r.body.reused, false);
    assert.equal(r.body.analysis.commitSha, crypto.createHash('sha256').update(zip).digest('hex').slice(0, 40));
    const stored = await Analysis.findById(r.body.analysis._id).lean();
    assert.equal(stored.status, 'completed');
    assert.equal(stored.metrics.functions, 2);
    assert.equal(stored.metrics.dependencyMetrics.localDependencies, 1);
    assert.equal(stored.metrics.coverage.rules.length, 4);
    assert.ok(stored.metrics.coverage.excluded && typeof stored.metrics.coverage.excluded === 'object', 'empty objects are not stripped');
    assert.equal(stored.files.find((f: any) => f.path === 'a.js').resolvedLocalDeps[0], 'b.js');
    assert.equal(tmpAstralDirs().length, before, 'temporary workspace removed after success');
    const repo = await Repository.findById(r.body.repository._id).lean();
    assert.equal(String(repo.latestAnalysisId), String(stored._id));
    assert.equal(repo.analysisStatus, 'completed');
    assert.equal(repo.primaryLanguage, 'JavaScript');
  });

  t('same content is reused; force re-analyses; changed content creates a new analysis', async () => {
    const zip = project();
    const again = await upload(A, zip, 'demo');
    assert.equal(again.body.reused, true);
    const forced = await upload(A, zip, 'demo', { force: 'true' });
    assert.equal(forced.body.reused, false);
    const changed = await upload(A, project({ 'proj/c.js': 'export const c = 1;' }), 'demo');
    assert.equal(changed.body.reused, false);
    assert.equal(changed.body.analysis.metrics.totalFiles, 3);
  });

  t('list endpoint is lightweight; detail endpoint returns the full latest completed analysis', async () => {
    const list = await get('/api/repositories', A);
    const repo = list.body.repositories.find((x: any) => x.name === 'demo');
    assert.ok(repo.latestAnalysis.metrics.totalFiles >= 2);
    assert.equal(repo.latestAnalysis.files, undefined);
    assert.equal(repo.latestAnalysis.dependencyGraph, undefined);
    const detail = await get(`/api/repositories/${repo._id}`, A);
    assert.ok(detail.body.latestAnalysis.files.length >= 2);
    assert.ok(detail.body.analysisHistory.length >= 2);
    const st = await get(`/api/repositories/${repo._id}/status`, A);
    assert.equal(st.body.status, 'completed');
    assert.ok(st.body.commitSha);
  });

  t('ids are validated and repositories are private to their owner', async () => {
    const repo = (await get('/api/repositories', A)).body.repositories[0];
    assert.equal((await get('/api/repositories/not-an-id', A)).status, 400);
    assert.equal((await get(`/api/repositories/${new mongoose.Types.ObjectId()}`, A)).status, 404);
    assert.equal((await get(`/api/repositories/${repo._id}`, B)).status, 404, "another user cannot read A's repository");
    assert.equal((await get(`/api/repositories/${repo._id}/status`, B)).status, 404);
    assert.equal((await get('/api/repositories', B)).body.repositories.length, 0);
  });

  t('invalid uploads are rejected with a 4xx and a clear message', async () => {
    const notZip = await upload(A, Buffer.from('<html>definitely not a zip</html>'), 'bad');
    assert.equal(notZip.status, 400);
    assert.match(notZip.body.error, /not a valid ZIP/i);
    const traversal = await upload(A, rawZip([{ name: '../../evil.js', data: 'x' }]), 'evil');
    assert.equal(traversal.status, 400);
    assert.match(traversal.body.error, /traversal/i);
    assert.equal(fs.existsSync('/tmp/evil.js'), false);
    const noFile = await fetch(`${base}/api/repositories/analyze-zip`, { method: 'POST', headers: auth(A), body: new FormData() });
    assert.equal(noFile.status, 400);
    const badUrl = await fetch(`${base}/api/repositories/analyze-github`, { method: 'POST', headers: { ...auth(A), 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://evil.com/github.com/a/b' }) });
    assert.equal(badUrl.status, 400);
  });

  t('a failed re-analysis is recorded but never hides the last good result; workspace is cleaned up', async () => {
    const before = tmpAstralDirs().length;
    const good = await upload(A, project(), 'keepme');
    assert.equal(good.status, 200);
    // valid ZIP signature but corrupt body for the same project name
    const bad = await upload(A, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 7)]), 'keepme');
    assert.equal(bad.status, 400);
    const repoId = good.body.repository._id;
    const afterBad = await get(`/api/repositories/${repoId}`, A);
    assert.equal(afterBad.body.repository.analysisStatus, 'failed', 'the failed run is recorded, not hidden');
    assert.match(afterBad.body.repository.statusMessage, /not a valid ZIP|corrupt/i);
    assert.ok(afterBad.body.latestAnalysis, 'previous completed analysis is still returned');
    assert.equal(afterBad.body.latestAnalysis.metrics.functions, 2);
    // a second, different failure (valid container, no files)
    const empty = await upload(A, rawZip([]), 'keepme');
    assert.equal(empty.status, 400);
    const after = await get(`/api/repositories/${repoId}`, A);
    assert.match(after.body.repository.statusMessage, /no files/i);
    assert.equal(after.body.latestAnalysis.metrics.functions, 2);
    assert.ok(after.body.analysisHistory.filter((h: any) => h.status === 'failed').length >= 2, 'failures are visible in history');
    assert.equal(tmpAstralDirs().length, before, 'temporary workspace removed after failure');
  });

  t('concurrent analysis of the same repository is rejected with 409', async () => {
    const zip = project({ 'proj/x.js': 'export const x = 1;' });
    const results = await Promise.allSettled([
      RepositoryService.analyzeZipUpload('user-c', 'race', zip),
      RepositoryService.analyzeZipUpload('user-c', 'race', zip),
    ]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? 200 : (r.reason as any).status)).sort();
    assert.deepEqual(statuses, [200, 409]);
  });

  t('only the newest few analyses are kept per repository', async () => {
    const zip = project({ 'proj/p.js': 'export const p = 1;' });
    for (let i = 0; i < 8; i++) await RepositoryService.analyzeZipUpload('user-d', 'prune', zip, { force: true });
    const repo = await Repository.findOne({ userId: 'user-d' }).lean();
    assert.equal(await Analysis.countDocuments({ repositoryId: repo._id }), 5);
    assert.ok(await Analysis.findById(repo.latestAnalysisId), 'latest analysis was not pruned');
  });

  t('interrupted runs are marked failed on startup instead of "analyzing" forever', async () => {
    const stuck = await Repository.create({ userId: 'user-e', name: 's', owner: 'o', fullName: 'o/s', source: 'github', analysisStatus: 'analyzing' });
    await RepositoryService.recoverInterrupted();
    const r = await Repository.findById(stuck._id).lean();
    assert.equal(r.analysisStatus, 'failed');
    assert.match(r.statusMessage, /interrupted/i);
  });

  t('analyze endpoints are rate limited per user', async () => {
    process.env.ANALYZE_RATE_LIMIT = '2';
    try {
      const zip = project();
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) codes.push((await upload('token-user-b-bbbbbbbbbbbbbbbbbbbb', zip, 'rl')).status);
      assert.deepEqual(codes, [200, 200, 429]);
    } finally { delete process.env.ANALYZE_RATE_LIMIT; }
  });

  t('repository names are case-insensitively unique per user', async () => {
    const r1 = await upload(A, project(), 'CaseTest');
    const r2 = await upload(A, project({ 'proj/q.js': 'export const q=1;' }), 'casetest');
    assert.equal(r1.body.repository._id, r2.body.repository._id);
  });
});
