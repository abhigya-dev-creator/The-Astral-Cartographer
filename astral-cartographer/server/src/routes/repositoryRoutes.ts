import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import zlib from 'zlib';
import { pipeline } from 'stream';
import { atlasStore } from '../services/atlas/gridfsStore.js';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { Repository } from '../models/Repository.js';
import { Analysis } from '../models/Analysis.js';
import { RepositoryService, UserFacingError } from '../services/repositoryService.js';
import { normalizeExcludePatterns } from '../services/excludePatterns.js';
import { deleteAtlasForRepository } from '../services/atlas/atlasService.js';
import { PathfinderProgress } from '../models/PathfinderProgress.js';
import { inspectSourceCode } from '../services/analysis/codeInspection/index.js';

const router = Router();

// ZIP uploads: 50 MB in-memory buffer limit, content verified by magic bytes in the service.
export const ZIP_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ZIP_UPLOAD_MAX_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.zip') || file.mimetype.includes('zip')) cb(null, true);
    else cb(new UserFacingError('Only .zip archive files are accepted for repository analysis.'));
  },
});

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
const wrap =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req as AuthenticatedRequest, res).catch(next);

const validId = (id: string) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;

/** Per-user sliding-window limiter for the expensive analyze endpoints. */
const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, number[]>();
function analyzeRateLimit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = req.user!.id;
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  // forget users with no recent requests, so the map does not grow forever
  if (hits.size > 1000) for (const [k, ts] of hits) if (!ts.length || now - ts[ts.length - 1] >= WINDOW_MS) hits.delete(k);
  if (recent.length >= (Number(process.env.ANALYZE_RATE_LIMIT) || 15)) {
    res.setHeader('Retry-After', String(Math.ceil((WINDOW_MS - (now - recent[0])) / 1000)));
    return res.status(429).json({ error: 'Too many analysis requests. Please wait a few minutes and try again.' });
  }
  recent.push(now);
  hits.set(key, recent);
  next();
}

/** Heavy fields are excluded from list responses; the detail endpoint returns everything. */
const LIGHT_PROJECTION = '-files -issues -dependencyGraph';

/**
 * Newest *completed* analysis per repository. Uses Repository.latestAnalysisId when present and falls back to a
 * query for repositories analysed before that field existed. A later failed run never hides a good result.
 */
async function latestAnalyses(repos: any[], light: boolean): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  const proj = light ? LIGHT_PROJECTION : '';
  const ids = repos.map((r) => r.latestAnalysisId).filter(Boolean);
  if (ids.length) {
    for (const a of await Analysis.find({ _id: { $in: ids } }).select(proj).lean()) out.set(String(a.repositoryId), a);
  }
  const missing = repos.filter((r) => !out.has(String(r._id))).map((r) => r._id);
  if (missing.length) {
    const newest = await Analysis.aggregate([
      { $match: { repositoryId: { $in: missing }, status: 'completed' } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$repositoryId', id: { $first: '$_id' } } },
    ]);
    if (newest.length) {
      for (const a of await Analysis.find({ _id: { $in: newest.map((n) => n.id) } }).select(proj).lean()) out.set(String(a.repositoryId), a);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------------------------

/** GET /api/repositories – the user's repositories with their latest completed analysis (without bulky detail). */
router.get('/', requireAuth, wrap(async (req, res) => {
  const repositories = await Repository.find({ userId: req.user!.id }).sort({ lastAnalyzedAt: -1 }).limit(200).lean();
  const map = await latestAnalyses(repositories, true);
  return res.json({ repositories: repositories.map((repo) => ({ ...repo, latestAnalysis: map.get(String(repo._id)) || null })) });
}));

/** GET /api/repositories/search?q=... */
router.get('/search', requireAuth, wrap(async (req, res) => {
  const userId = req.user!.id;
  const query = String(req.query.q ?? '').trim().slice(0, 100);
  const filter: any = { userId };
  if (query) {
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: regex }, { owner: regex }, { fullName: regex }, { primaryLanguage: regex }];
  }
  const repositories = await Repository.find(filter).sort({ lastAnalyzedAt: -1 }).limit(10).lean();
  return res.json({ repositories });
}));

/** GET /api/repositories/:id – repository + full latest completed analysis + short history. */
router.get('/:id', requireAuth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid repository id.' });
  const repository = await Repository.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
  if (!repository) return res.status(404).json({ error: 'Repository not found or access denied.' });

  const map = await latestAnalyses([repository], false);
  const history = await Analysis.find({ repositoryId: repository._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('status errorMessage commitSha branch analyzerVersion createdAt metrics.totalFiles metrics.totalLines metrics.functions metrics.dependencies metrics.architecturalIssues metrics.coverage.analyzedCodeFiles issues.type issues.severity')
    .lean();

  return res.json({ repository, latestAnalysis: map.get(String(repository._id)) || null, analysisHistory: history });
}));

/** POST /api/repositories/analyze-github  { url, force? } */
router.post('/analyze-github', requireAuth, analyzeRateLimit, wrap(async (req, res) => {
  const url = req.body?.url;
  if (typeof url !== 'string' || !url.trim()) throw new UserFacingError('GitHub repository URL is required.');
  const exclude = normalizeExcludePatterns(req.body?.exclude);
  const result = await RepositoryService.analyzeGitHubRepo(req.user!.id, url.trim(), { force: req.body?.force === true, exclude });
  return res.status(200).json({ success: true, repository: result.repository, analysis: result.analysis, reused: result.reused });
}));

/** POST /api/repositories/analyze-zip  multipart: file, projectName?, force? */
router.post('/analyze-zip', requireAuth, analyzeRateLimit, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new UserFacingError('No ZIP file uploaded.');
  const rawName = typeof req.body?.projectName === 'string' ? req.body.projectName : '';
  const projectName = rawName.trim() || req.file.originalname.replace(/\.zip$/i, '');
  const exclude = normalizeExcludePatterns(req.body?.exclude);
  const result = await RepositoryService.analyzeZipUpload(req.user!.id, projectName, req.file.buffer, { force: req.body?.force === 'true', exclude });
  return res.status(200).json({ success: true, repository: result.repository, analysis: result.analysis, reused: result.reused });
}));

/**
 * DELETE /api/repositories/:id – remove a repository with all its analyses, stored dependency maps and saved
 * Pathfinder progress. Refused while an analysis of it is running.
 */
router.delete('/:id', requireAuth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid repository id.' });
  const repository = await Repository.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
  if (!repository) return res.status(404).json({ error: 'Repository not found or access denied.' });
  if (repository.analysisStatus === 'analyzing' || repository.analysisStatus === 'pending') {
    return res.status(409).json({ error: 'This repository is being analysed right now. Delete it when the analysis has finished.' });
  }
  await deleteAtlasForRepository(repository._id);
  const analyses = await Analysis.deleteMany({ repositoryId: repository._id });
  await PathfinderProgress.deleteMany({ repositoryId: repository._id });
  await Repository.deleteOne({ _id: repository._id });
  return res.json({ deleted: true, analyses: analyses.deletedCount });
}));

/** GET /api/repositories/:id/status – poll progress of a running analysis. */
router.get('/:id/status', requireAuth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid repository id.' });
  const repository = await Repository.findOne({ _id: req.params.id, userId: req.user!.id }, 'analysisStatus analysisStage statusMessage fileCount lastAnalyzedAt commitSha').lean();
  if (!repository) return res.status(404).json({ error: 'Repository not found.' });
  return res.json({
    status: repository.analysisStatus,
    stage: repository.analysisStage || null,
    message: repository.statusMessage,
    fileCount: repository.fileCount,
    commitSha: repository.commitSha || null,
    lastAnalyzedAt: repository.lastAnalyzedAt,
  });
}));

/** Largest uncompressed AtlasData the API serves. */
const ATLAS_MAX_BYTES = 50 * 1024 * 1024;

/** GET /api/repositories/:id/atlas – Dependency Atlas of the newest completed analysis (gzip JSON from GridFS). */
router.get('/:id/atlas', requireAuth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid repository id.' });
  const repository = await Repository.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
  if (!repository) return res.status(404).json({ error: 'Repository not found or access denied.' });
  const analysis = (await latestAnalyses([repository], true)).get(String(repository._id));
  if (!analysis) return res.status(404).json({ error: 'This repository has no completed analysis yet.', code: 'NO_ANALYSIS' });
  const meta = analysis.atlas;
  if (!meta || !(await atlasStore.exists(meta.key))) {
    return res.status(404).json({ error: 'No dependency map is stored for the latest analysis. Re-analyze the repository to create one.', code: 'NO_ATLAS' });
  }
  if (meta.bytes > ATLAS_MAX_BYTES) {
    return res.status(413).json({ error: `This repository's dependency map is too large to display (${(meta.bytes / 1048576).toFixed(1)} MB; the limit is 50 MB).`, code: 'ATLAS_TOO_LARGE' });
  }
  const etag = `"atlas-${meta.key}-${meta.storedBytes}"`;
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', etag);
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  const gzipOk = /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''));
  res.status(200).type('application/json');
  if (gzipOk) { res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Content-Length', String(meta.storedBytes)); }
  const source = atlasStore.openGzipStream(meta.key);
  // pipeline() destroys every stream (and closes the GridFS cursor) when the client aborts or anything fails
  await new Promise<void>((resolve) => {
    const done = (err?: NodeJS.ErrnoException | null) => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.warn(`[Atlas] streaming ${meta.key} failed: ${err.message}`);
      resolve();
    };
    if (gzipOk) pipeline(source, res, done); else pipeline(source, zlib.createGunzip(), res, done);
  });
}));

/** POST /api/repositories/inspect-snippet – run intelligent bug detection on raw code */
router.post('/inspect-snippet', requireAuth, wrap(async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const filePath = typeof req.body?.path === 'string' ? req.body.path : 'snippet.ts';
  if (!code.trim()) return res.json({ ok: true, result: { file: filePath, issues: [], summary: { total: 0, errors: 0, warnings: 0, info: 0, confirmed: 0, heuristic: 0, byCategory: {} }, durationMs: 0 } });
  const result = inspectSourceCode(code, filePath);
  return res.json({ ok: true, result });
}));

/** POST /api/repositories/:id/inspect-file – run intelligent bug detection on a specific file */
router.post('/:id/inspect-file', requireAuth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid repository id.' });
  const repository = await Repository.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
  if (!repository) return res.status(404).json({ error: 'Repository not found or access denied.' });

  const filePath = typeof req.body?.path === 'string' ? req.body.path : '';
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!filePath) return res.status(400).json({ error: 'File path is required.' });

  const result = inspectSourceCode(code, filePath);
  return res.json({ ok: true, result });
}));

export default router;
