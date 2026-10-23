/**
 * Dependency Atlas: pipeline integration, GridFS storage and GET /api/repositories/:id/atlas.
 * Same setup as api.test.ts: real routes + real MongoDB (MONGODB_TEST_URI or mongodb-memory-server) + a local fake Supabase.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import type { AddressInfo } from 'net';
import express from 'express';
import mongoose from 'mongoose';
import { rawZip } from './helpers.js';
import type { AtlasData } from '../services/atlas/types.js';

let skipReason: string | false = false;
let stopDb: (() => Promise<void>) | null = null;
let fakeSupabase: http.Server;
let api: http.Server;
let base = '';
let Repository: any, Analysis: any;
let atlas: typeof import('../services/atlas/gridfsStore.js');
let atlasService: typeof import('../services/atlas/atlasService.js');

const TOKENS: Record<string, { id: string; email: string }> = {
  'token-atlas-user-a-aaaaaaaaaaaaaa': { id: 'atlas-a', email: 'a@example.com' },
  'token-atlas-user-b-bbbbbbbbbbbbbb': { id: 'atlas-b', email: 'b@example.com' },
};
const A = 'token-atlas-user-a-aaaaaaaaaaaaaa';
const B = 'token-atlas-user-b-bbbbbbbbbbbbbb';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const project = (extra: Record<string, string> = {}) =>
  rawZip(Object.entries({
    'proj/src/a.js': "import './b.js';\nimport './utils/';\nimport React from 'react';\nexport function a() {}\n",
    'proj/src/b.js': 'export const b = () => 1;\n',
    'proj/src/utils/index.js': 'export default 1;\n',
    ...extra,
  }).map(([name, data]) => ({ name, data })));

async function upload(token: string, bytes: Buffer, name: string, force = false) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'application/zip' }), `${name}.zip`);
  fd.append('projectName', name);
  if (force) fd.append('force', 'true');
  const res = await fetch(`${base}/api/repositories/analyze-zip`, { method: 'POST', headers: auth(token), body: fd });
  return { status: res.status, body: (await res.json()) as any };
}
const tmpAstralDirs = () => fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('astral-') && !d.startsWith('astral-test') && !d.startsWith('astral-sec'));

/** Raw HTTP GET (no automatic decompression) so headers and bytes can be checked exactly. */
function rawGet(path: string, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}${path}`, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}

// Test files run in parallel. api.test.ts counts `astral-*` work folders in the system temp directory, so this file
// sends its own pipeline work folders to a private temp directory (os.tmpdir() reads these variables on every call).
const savedTemp = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
const privateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-api-tmp-'));
process.env.TMP = process.env.TEMP = process.env.TMPDIR = privateTmp;

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
  await mongoose.connect(uri, { dbName: `astral_atlas_test_${process.pid}` });
  await mongoose.connection.dropDatabase();

  fakeSupabase = http.createServer((req, res) => {
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

  const [{ default: routes }, { errorHandler }, repoModel, analysisModel, gridfs, svc] = await Promise.all([
    import('../routes/repositoryRoutes.js'),
    import('../middleware/errorHandler.js'),
    import('../models/Repository.js'),
    import('../models/Analysis.js'),
    import('../services/atlas/gridfsStore.js'),
    import('../services/atlas/atlasService.js'),
  ]);
  Repository = repoModel.Repository; Analysis = analysisModel.Analysis; atlas = gridfs; atlasService = svc;
  await Promise.all([Repository.init(), Analysis.init()]);
  const app = express();
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
  for (const [k, v] of Object.entries(savedTemp)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(privateTmp, { recursive: true, force: true });
});

const t = (name: string, fn: () => Promise<void>) => test(name, async (ctx) => { if (skipReason) return ctx.skip(skipReason); await fn(); });

describe('Dependency Atlas pipeline and API', () => {
  let repoId = '';

  t('an analysis stores its Atlas in GridFS (texts reused from the analyzer) and the endpoint streams gzip', async () => {
    const r = await upload(A, project(), 'atlas-demo');
    assert.equal(r.status, 200);
    repoId = r.body.repository._id;
    const meta = r.body.analysis.atlas;
    assert.ok(meta, 'analysis has atlas metadata');
    assert.equal(meta.key, r.body.analysis._id);
    assert.equal(meta.sourcesFrom, 'memory');
    assert.equal(meta.files, 3);
    assert.ok(await atlas.atlasStore.exists(meta.key));

    const res = await rawGet(`/api/repositories/${repoId}/atlas`, { ...auth(A), 'Accept-Encoding': 'gzip' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.headers['content-type']?.split(';')[0], 'application/json');
    assert.equal(res.headers['cache-control'], 'private, no-cache');
    assert.equal(Number(res.headers['content-length']), meta.storedBytes);
    assert.ok(res.headers.etag);
    const data = JSON.parse(zlib.gunzipSync(res.body).toString('utf8')) as AtlasData;
    assert.equal(data.version, 1);
    const edge = (spec: string) => data.edges.find((e) => e.from === 'src/a.js' && e.specifier === spec)!;
    assert.equal(edge('./b.js').to, 'src/b.js');
    assert.equal(edge('./utils/').to, 'src/utils/index.js', 'trailing-slash fix applies to stored maps');
    assert.equal(edge('react').status, 'external');
    assert.equal(data.repo.source, 'zip');
    assert.ok(!JSON.stringify(data).includes('export const b = () => 1'), 'no source code stored');

    // conditional request
    const again = await rawGet(`/api/repositories/${repoId}/atlas`, { ...auth(A), 'If-None-Match': String(res.headers.etag) });
    assert.equal(again.status, 304);
    // a client that does not accept gzip gets plain JSON
    const plain = await rawGet(`/api/repositories/${repoId}/atlas`, { ...auth(A), 'Accept-Encoding': 'identity' });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.deepEqual(JSON.parse(plain.body.toString('utf8')), data);
  });

  t('sign-in and ownership are enforced', async () => {
    assert.equal((await rawGet(`/api/repositories/${repoId}/atlas`, {})).status, 401);
    const other = await rawGet(`/api/repositories/${repoId}/atlas`, auth(B));
    assert.equal(other.status, 404);
    assert.match(other.body.toString(), /not found/i);
    assert.equal((await rawGet('/api/repositories/not-an-id/atlas', auth(A))).status, 400);
    assert.equal((await rawGet(`/api/repositories/${new mongoose.Types.ObjectId()}/atlas`, auth(A))).status, 404);
  });

  t('missing map -> 404 NO_ATLAS; no completed analysis -> 404 NO_ANALYSIS; over 50 MB -> 413', async () => {
    const latest = await Analysis.findOne({ repositoryId: repoId, status: 'completed' }).sort({ createdAt: -1 });
    const saved = latest.atlas;
    await Analysis.updateOne({ _id: latest._id }, { $set: { atlas: null } });
    let r = await rawGet(`/api/repositories/${repoId}/atlas`, auth(A));
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.body.toString()).code, 'NO_ATLAS');

    await Analysis.updateOne({ _id: latest._id }, { $set: { atlas: { ...saved, bytes: 60 * 1024 * 1024 } } });
    r = await rawGet(`/api/repositories/${repoId}/atlas`, auth(A));
    assert.equal(r.status, 413);
    assert.match(JSON.parse(r.body.toString()).error, /too large to display \(60\.0 MB; the limit is 50 MB\)/);
    await Analysis.updateOne({ _id: latest._id }, { $set: { atlas: saved } });

    const fresh = await Repository.create({ userId: 'atlas-a', name: 'empty', owner: 'Local Upload', fullName: 'Local Upload / empty', source: 'zip' });
    r = await rawGet(`/api/repositories/${fresh._id}/atlas`, auth(A));
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.body.toString()).code, 'NO_ANALYSIS');
  });

  t('an Atlas failure never breaks the analysis or the work-folder cleanup', async () => {
    const dirsBefore = tmpAstralDirs().length;
    const original = atlas.atlasStore.save;
    atlas.atlasStore.save = async () => { throw new Error('simulated GridFS outage'); };
    try {
      const r = await upload(A, project({ 'proj/src/c.js': '// changed\n' }), 'atlas-demo');
      assert.equal(r.status, 200, 'analysis still succeeds');
      assert.equal(r.body.analysis.status, 'completed');
      assert.equal(r.body.analysis.atlas, null);
      assert.ok(r.body.analysis.warnings.some((w: string) => /dependency map could not be generated/.test(w)));
    } finally {
      atlas.atlasStore.save = original;
    }
    assert.equal(tmpAstralDirs().length, dirsBefore, 'work folder removed');
    const r = await rawGet(`/api/repositories/${repoId}/atlas`, auth(A));
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.body.toString()).code, 'NO_ATLAS', 'the newest analysis has no map: say so, never serve an empty map');
  });

  t('client aborts close the GridFS stream and the server keeps serving', async () => {
    // a large map (random names compress poorly) so the response spans many GridFS chunks
    const latest = await Analysis.findOne({ repositoryId: repoId, status: 'completed' }).sort({ createdAt: -1 });
    const big: AtlasData = {
      version: 1, repo: { owner: 'o', name: 'n', branch: 'b', commitSha: '', analyzedAt: '' }, edges: [], cycles: [],
      files: Array.from({ length: 30000 }, () => { const p = `src/${crypto.randomBytes(24).toString('hex')}.ts`; return { path: p, name: p.slice(4), ext: '.ts', folder: 'src', size: 1, lines: 1, kind: 'code' as const, functions: [], exports: [] }; }),
      stats: { files: 30000, edges: 0, unresolved: 0, parseErrors: 0, skipped: [] },
    };
    const meta = await atlas.atlasStore.save(String(latest._id), big);
    await Analysis.updateOne({ _id: latest._id }, { $set: { atlas: meta } });
    assert.ok(meta.storedBytes > 512 * 1024, `stored ${meta.storedBytes} bytes (GridFS chunks are 255 KB)`);

    const original = atlas.atlasStore.openGzipStream.bind(atlas.atlasStore);
    let opened: any = null;
    atlas.atlasStore.openGzipStream = (k: string) => (opened = original(k));
    try {
      await new Promise<void>((resolve) => {
        const req = http.get(`${base}/api/repositories/${repoId}/atlas`, { headers: { ...auth(A), 'Accept-Encoding': 'gzip' } }, (res) => {
          res.once('data', () => { req.destroy(); resolve(); });
        });
        req.on('error', () => resolve());
      });
      const deadline = Date.now() + 3000;
      while (!opened?.destroyed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      assert.equal(opened?.destroyed, true, 'download stream destroyed after the client went away');
    } finally {
      atlas.atlasStore.openGzipStream = original;
    }
    const ok = await rawGet(`/api/repositories/${repoId}/atlas`, { ...auth(A), 'Accept-Encoding': 'gzip' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.length, meta.storedBytes);
  });

  t('pruned analyses lose their Atlas files; orphan cleanup and repository deletion remove the rest', async () => {
    for (let i = 0; i < 7; i++) assert.equal((await upload(A, project({ 'proj/src/c.js': `// v${i}\n` }), 'atlas-prune')).status, 200);
    const prunedRepo = await Repository.findOne({ userId: 'atlas-a', name: 'atlas-prune' });
    const kept = await Analysis.find({ repositoryId: prunedRepo._id }).select('_id atlas').lean();
    assert.ok(kept.length <= 5, `${kept.length} analyses kept`);
    const keys = new Set(await atlas.atlasStore.keys());
    for (const a of kept) assert.ok(keys.has(String(a._id)), 'kept analyses keep their maps');
    assert.equal((await atlasService.cleanupOrphanAtlasFiles()), 0, 'pruning left no orphans behind');

    // orphans: a stray name and a map whose analysis is gone
    const sample = await atlas.atlasStore.load(String(kept[0]._id));
    await atlas.atlasStore.save('not-an-object-id', sample!);
    await atlas.atlasStore.save(String(new mongoose.Types.ObjectId()), sample!);
    assert.equal(await atlasService.cleanupOrphanAtlasFiles(), 2);
    for (const a of kept) assert.ok(await atlas.atlasStore.exists(String(a._id)), 'live maps are kept');

    await atlasService.deleteAtlasForRepository(prunedRepo._id);
    for (const a of kept) assert.equal(await atlas.atlasStore.exists(String(a._id)), false);
  });
});
