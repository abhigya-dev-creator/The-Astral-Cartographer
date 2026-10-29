import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { Repository } from '../models/Repository.js';
import { Analysis } from '../models/Analysis.js';
import { PathfinderProgress } from '../models/PathfinderProgress.js';
import { atlasStore } from '../services/atlas/gridfsStore.js';
import type { AtlasData } from '../services/atlas/types.js';
import {
  generateDynamicRoadmap,
  generateDeterministicFileExplanation,
  enrichExplanationWithAI,
} from '../services/pathfinder/dynamicLearningService.js';

/**
 * Onboarding Pathfinder persistence & dynamic learning routes, mounted under /api/repositories:
 *   GET  /:id/pathfinder         -> { completed, current, saved, commitSha }
 *   PUT  /:id/pathfinder         { completed?, current?, saved?, commitSha? } -> updated state
 *   GET  /:id/learning-roadmap   -> dynamic 5-stage personalized learning roadmap
 *   POST /:id/file-explanation   { filePath, forceAi? } -> 7-section structured explanation
 */
const router = Router();

const wrap =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req as AuthenticatedRequest, res).catch(next);

const validId = (id: string) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;

export const PATHFINDER_LIMITS = { MAX_ITEMS: 500, MAX_LENGTH: 1024 };

const atlasCache = new Map<string, AtlasData>();

async function getAtlas(analysis: any): Promise<AtlasData | null> {
  if (!analysis?.atlas?.key) return null;
  let atlas = atlasCache.get(analysis.atlas.key);
  if (!atlas) {
    atlas = (await atlasStore.load(analysis.atlas.key)) ?? undefined;
    if (atlas) {
      atlasCache.set(analysis.atlas.key, atlas);
      if (atlasCache.size > 20) atlasCache.delete(atlasCache.keys().next().value as string);
    }
  }
  return atlas ?? null;
}

async function loadFileSource(owner: string, name: string, sha: string, path: string): Promise<string | null> {
  if (!/^[0-9a-f]{40}$/i.test(sha)) return null;
  try {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${sha}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
    const { data } = await axios.get(url, {
      timeout: 8000,
      responseType: 'text',
      maxContentLength: 1024 * 1024,
      transformResponse: (x) => x,
    });
    return String(data);
  } catch {
    return null;
  }
}

function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > PATHFINDER_LIMITS.MAX_ITEMS) return null;
  if (!v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= PATHFINDER_LIMITS.MAX_LENGTH)) return null;
  return [...new Set(v as string[])];
}

const view = (doc: any) => {
  const result: { completed: string[]; current: string | null; saved: string[]; commitSha?: string } = {
    completed: doc?.completed ?? [],
    current: doc?.current ?? null,
    saved: doc?.saved ?? [],
  };
  if (doc?.commitSha) {
    result.commitSha = doc.commitSha;
  }
  return result;
};

async function ownRepository(req: AuthenticatedRequest, res: Response) {
  if (!validId(req.params.id)) {
    res.status(400).json({ error: 'Invalid repository id.' });
    return null;
  }
  const repo = await Repository.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
  if (!repo) {
    res.status(404).json({ error: 'Repository not found or access denied.' });
    return null;
  }
  return repo;
}

// 1. GET saved pathfinder state
router.get(
  '/:id/pathfinder',
  requireAuth,
  wrap(async (req, res) => {
    const repo = await ownRepository(req, res);
    if (!repo) return;
    const doc = await PathfinderProgress.findOne({ userId: req.user!.id, repositoryId: repo._id }).lean();
    return res.json(view(doc));
  })
);

// 2. PUT update pathfinder state
router.put(
  '/:id/pathfinder',
  requireAuth,
  wrap(async (req, res) => {
    const repo = await ownRepository(req, res);
    if (!repo) return;
    const body = req.body ?? {};
    const update: Record<string, unknown> = {};

    for (const key of ['completed', 'saved'] as const) {
      if (body[key] === undefined) continue;
      const list = stringList(body[key]);
      if (!list)
        return res
          .status(400)
          .json({ error: `"${key}" must be a list of at most ${PATHFINDER_LIMITS.MAX_ITEMS} non-empty strings.` });
      update[key] = list;
    }

    if (body.current !== undefined) {
      const c = body.current;
      if (c !== null && !(typeof c === 'string' && c.length > 0 && c.length <= PATHFINDER_LIMITS.MAX_LENGTH)) {
        return res.status(400).json({ error: '"current" must be a file path or null.' });
      }
      update.current = c;
    }

    if (typeof body.commitSha === 'string') {
      update.commitSha = body.commitSha;
    }

    const doc = await PathfinderProgress.findOneAndUpdate(
      { userId: req.user!.id, repositoryId: repo._id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json(view(doc));
  })
);

// 3. GET dynamic learning roadmap (zero hardcoded logic, purely graph-theoretic)
router.get(
  '/:id/learning-roadmap',
  requireAuth,
  wrap(async (req, res) => {
    const repo = await ownRepository(req, res);
    if (!repo) return;

    const analysis: any = await Analysis.findOne(
      repo.latestAnalysisId ? { _id: repo.latestAnalysisId } : { repositoryId: repo._id, status: 'completed' }
    )
      .sort({ createdAt: -1 })
      .select('atlas issues commitSha metrics languages')
      .lean();

    if (!analysis) {
      return res.status(404).json({ error: 'No analysis found for this repository. Please analyze first.' });
    }

    const atlas = await getAtlas(analysis);
    if (!atlas) {
      return res.status(404).json({ error: 'No dependency graph stored for this analysis.' });
    }

    const roadmap = generateDynamicRoadmap(atlas, analysis);
    return res.json({
      success: true,
      commitSha: analysis.commitSha,
      roadmap,
    });
  })
);

// 4. POST file-by-file explanation (7 mandatory sections, cached per commit & path)
router.post(
  '/:id/file-explanation',
  requireAuth,
  wrap(async (req, res) => {
    const repo = await ownRepository(req, res);
    if (!repo) return;

    const filePath = typeof req.body?.filePath === 'string' ? req.body.filePath.trim() : '';
    const forceAi = Boolean(req.body?.forceAi);

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required.' });
    }

    const analysis: any = await Analysis.findOne(
      repo.latestAnalysisId ? { _id: repo.latestAnalysisId } : { repositoryId: repo._id, status: 'completed' }
    )
      .sort({ createdAt: -1 })
      .select('atlas issues commitSha metrics languages')
      .lean();

    if (!analysis) {
      return res.status(404).json({ error: 'No analysis found for this repository.' });
    }

    const commitSha = analysis.commitSha || 'latest';
    const cacheKey = `${commitSha}:${filePath}`;
    const safeKey = cacheKey.replace(/\./g, '_');

    // Check user progress cache if not forced AI refresh
    const progress = await PathfinderProgress.findOne({ userId: req.user!.id, repositoryId: repo._id }).lean();
    if (!forceAi && progress?.explanations && (progress.explanations as Record<string, any>)[safeKey]) {
      return res.json({
        success: true,
        source: 'cache',
        explanation: (progress.explanations as Record<string, any>)[safeKey],
      });
    }

    const atlas = await getAtlas(analysis);
    if (!atlas) {
      return res.status(404).json({ error: 'No dependency graph stored for this analysis.' });
    }

    const fileNode = atlas.files.find((f) => f.path === filePath);
    if (!fileNode) {
      return res.status(404).json({ error: `File "${filePath}" not found in repository analysis.` });
    }

    // 1. Generate factual deterministic explanation from AST & Graph
    let explanation = generateDeterministicFileExplanation(fileNode, atlas, analysis);

    // 2. If AI key is configured and repo is on GitHub, enrich with LLM
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey && repo.source === 'github') {
      const sourceCode = await loadFileSource(repo.owner, repo.name, commitSha, filePath);
      if (sourceCode) {
        explanation = await enrichExplanationWithAI(
          fileNode,
          sourceCode,
          explanation,
          groqKey,
          process.env.GROQ_MODEL
        );
      }
    }

    // Cache explanation in PathfinderProgress
    await PathfinderProgress.findOneAndUpdate(
      { userId: req.user!.id, repositoryId: repo._id },
      { $set: { [`explanations.${safeKey}`]: explanation, commitSha } },
      { upsert: true }
    );

    return res.json({
      success: true,
      source: groqKey ? 'ai_enriched' : 'ast_deterministic',
      explanation,
    });
  })
);

export default router;
