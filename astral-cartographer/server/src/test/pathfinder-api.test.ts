/**
 * Onboarding Pathfinder persistence: real routes + real MongoDB + a local fake Supabase (same setup as api.test.ts).
 * MongoDB comes from MONGODB_TEST_URI, or mongodb-memory-server if its binary is available; otherwise the suite is skipped.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import mongoose from 'mongoose';

let skipReason: string | false = false;
let stopDb: (() => Promise<void>) | null = null;
let fakeSupabase: http.Server;
let api: http.Server;
let base = '';
let repoA = '';
let repoB = '';

const TOKENS: Record<string, { id: string }> = {
  'token-user-a-aaaaaaaaaaaaaaaaaaaa': { id: 'user-a' },
  'token-user-b-bbbbbbbbbbbbbbbbbbbb': { id: 'user-b' },
};
const A = 'token-user-a-aaaaaaaaaaaaaaaaaaaa';
const B = 'token-user-b-bbbbbbbbbbbbbbbbbbbb';

async function call(method: string, p: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
  await mongoose.connect(uri, { dbName: `astral_pathfinder_test_${process.pid}` });
  await mongoose.connection.dropDatabase();

  fakeSupabase = http.createServer((req, res) => {
    const tok = /^Bearer (.+)$/.exec(String(req.headers.authorization))?.[1] || '';
    const u = TOKENS[tok];
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/auth/v1/user') && u) {
      return res.end(JSON.stringify({ id: u.id, aud: 'authenticated', role: 'authenticated', email: `${u.id}@example.com`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }));
  });
  await new Promise<void>((r) => fakeSupabase.listen(0, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(fakeSupabase.address() as AddressInfo).port}`;
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';

  const [{ default: routes }, { errorHandler }, { Repository }, { PathfinderProgress }] = await Promise.all([
    import('../routes/pathfinderRoutes.js'),
    import('../middleware/errorHandler.js'),
    import('../models/Repository.js'),
    import('../models/PathfinderProgress.js'),
  ]);
  await Promise.all([Repository.init(), PathfinderProgress.init()]);
  const mk = (userId: string, name: string) => Repository.create({ userId, name, owner: 'o', fullName: `o/${name}`, source: 'github' });
  repoA = String((await mk('user-a', 'alpha'))._id);
  repoB = String((await mk('user-b', 'beta'))._id);

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

t('pathfinder state: empty by default, partial updates persist, duplicates removed', async () => {
  assert.deepEqual((await call('GET', `/api/repositories/${repoA}/pathfinder`, A)).body, { completed: [], current: null, saved: [] });
  let r = await call('PUT', `/api/repositories/${repoA}/pathfinder`, A, { completed: ['README.md', 'package.json', 'README.md'], current: 'src/main.tsx' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { completed: ['README.md', 'package.json'], current: 'src/main.tsx', saved: [] });
  r = await call('PUT', `/api/repositories/${repoA}/pathfinder`, A, { saved: ['tests:src/lib/api.ts'] });
  assert.deepEqual(r.body, { completed: ['README.md', 'package.json'], current: 'src/main.tsx', saved: ['tests:src/lib/api.ts'] }, 'fields not sent are kept');
  assert.deepEqual((await call('GET', `/api/repositories/${repoA}/pathfinder`, A)).body.saved, ['tests:src/lib/api.ts']);
  r = await call('PUT', `/api/repositories/${repoA}/pathfinder`, A, { current: null });
  assert.equal(r.body.current, null);
});

t('pathfinder state: only the owner can read or write it', async () => {
  assert.equal((await call('GET', `/api/repositories/${repoA}/pathfinder`, null)).status, 401);
  assert.equal((await call('GET', `/api/repositories/${repoA}/pathfinder`, B)).status, 404);
  assert.equal((await call('PUT', `/api/repositories/${repoA}/pathfinder`, B, { completed: ['x'] })).status, 404);
  assert.deepEqual((await call('GET', `/api/repositories/${repoB}/pathfinder`, B)).body.completed, [], 'user B has separate state');
  assert.equal((await call('GET', '/api/repositories/not-an-id/pathfinder', A)).status, 400);
});

t('pathfinder state: invalid input is rejected without changing anything', async () => {
  const before = (await call('GET', `/api/repositories/${repoA}/pathfinder`, A)).body;
  for (const bad of [{ completed: 'README.md' }, { completed: [''] }, { saved: [1] }, { current: 5 }, { completed: Array.from({ length: 501 }, (_, i) => `f${i}`) }, { saved: ['x'.repeat(1025)] }]) {
    assert.equal((await call('PUT', `/api/repositories/${repoA}/pathfinder`, A, bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.deepEqual((await call('GET', `/api/repositories/${repoA}/pathfinder`, A)).body, before);
});
