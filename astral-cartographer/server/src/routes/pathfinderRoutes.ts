import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { Repository } from '../models/Repository.js';
import { PathfinderProgress } from '../models/PathfinderProgress.js';

/**
 * Onboarding Pathfinder persistence, mounted under /api/repositories:
 *   GET /:id/pathfinder  -> { completed, current, saved }
 *   PUT /:id/pathfinder  { completed?, current?, saved? } -> the stored state
 * Only the signed-in user's own repositories are accessible.
 */
const router = Router();

const wrap =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req as AuthenticatedRequest, res).catch(next);

const validId = (id: string) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;

export const PATHFINDER_LIMITS = { MAX_ITEMS: 500, MAX_LENGTH: 1024 };

/** A list of distinct non-empty strings within the limits, or null if the value is not acceptable. */
function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > PATHFINDER_LIMITS.MAX_ITEMS) return null;
  if (!v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= PATHFINDER_LIMITS.MAX_LENGTH)) return null;
  return [...new Set(v as string[])];
}

const view = (doc: { completed?: string[]; current?: string | null; saved?: string[] } | null) => ({
  completed: doc?.completed ?? [],
  current: doc?.current ?? null,
  saved: doc?.saved ?? [],
});

async function ownRepository(req: AuthenticatedRequest, res: Response) {
  if (!validId(req.params.id)) { res.status(400).json({ error: 'Invalid repository id.' }); return null; }
  const repo = await Repository.findOne({ _id: req.params.id, userId: req.user!.id }, '_id').lean();
  if (!repo) { res.status(404).json({ error: 'Repository not found or access denied.' }); return null; }
  return repo;
}

router.get('/:id/pathfinder', requireAuth, wrap(async (req, res) => {
  const repo = await ownRepository(req, res);
  if (!repo) return;
  const doc = await PathfinderProgress.findOne({ userId: req.user!.id, repositoryId: repo._id }).lean();
  return res.json(view(doc));
}));

router.put('/:id/pathfinder', requireAuth, wrap(async (req, res) => {
  const repo = await ownRepository(req, res);
  if (!repo) return;
  const body = req.body ?? {};
  const update: Record<string, unknown> = {};
  for (const key of ['completed', 'saved'] as const) {
    if (body[key] === undefined) continue;
    const list = stringList(body[key]);
    if (!list) return res.status(400).json({ error: `"${key}" must be a list of at most ${PATHFINDER_LIMITS.MAX_ITEMS} non-empty strings.` });
    update[key] = list;
  }
  if (body.current !== undefined) {
    const c = body.current;
    if (c !== null && !(typeof c === 'string' && c.length > 0 && c.length <= PATHFINDER_LIMITS.MAX_LENGTH)) {
      return res.status(400).json({ error: '"current" must be a file path or null.' });
    }
    update.current = c;
  }
  const doc = await PathfinderProgress.findOneAndUpdate(
    { userId: req.user!.id, repositoryId: repo._id },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return res.json(view(doc));
}));

export default router;
