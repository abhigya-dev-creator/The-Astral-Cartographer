import mongoose from 'mongoose';
import { Analysis } from '../../models/Analysis.js';
import { analyzeAtlas } from './analyzeAtlas.js';
import { atlasStore } from './gridfsStore.js';
import { loadFolder } from './loadFolder.js';
import { mapFindings } from './mapFindings.js';
import type { AtlasMeta } from './store.js';
import type { AtlasRepo } from './types.js';
import type { ExcludeMatcher } from '../excludePatterns.js';

export interface BuildAtlasParams {
  /** extracted repository folder (still on disk during the analysis) */
  root: string;
  analysisId: string;
  repo: Omit<AtlasRepo, 'analyzedAt'>;
  /** texts kept by CodeAnalyzer (keepSources); null = read everything from disk */
  kept: ReadonlyMap<string, string> | null;
  /** CodeAnalyzer hit its memory cap, so some texts are read from disk again */
  capped: boolean;
  /** the same user exclusions the analyzer applied */
  exclude?: ExcludeMatcher | null;
}

/** Build the AtlasData for one analysis and store it in GridFS under the analysis id. */
export async function buildAndStoreAtlas(p: BuildAtlasParams): Promise<AtlasMeta & { findings: any[] }> {
  const t0 = performance.now();
  const { files, skipped, diskReads } = loadFolder(p.root, { texts: p.kept, exclude: p.exclude });
  const data = analyzeAtlas({ repo: p.repo, files, skipped });
  const meta = await atlasStore.save(p.analysisId, data);
  return {
    findings: mapFindings(data),
    ...meta,
    sourcesFrom: !p.kept ? 'disk' : p.capped ? 'memory+disk' : 'memory',
    diskReads,
    buildMs: Math.round(performance.now() - t0),
  };
}

/** Delete the Atlas files of these analyses (best effort; failures are logged, never thrown). */
export async function deleteAtlasForAnalyses(ids: Array<string | mongoose.Types.ObjectId>): Promise<void> {
  for (const id of ids) {
    await atlasStore.remove(String(id)).catch((err: any) => console.warn(`[Atlas] could not delete map ${String(id)}: ${err?.message}`));
  }
}

/** For a future "delete repository" action: removes every Atlas file of the repository's analyses. */
export async function deleteAtlasForRepository(repositoryId: string | mongoose.Types.ObjectId): Promise<void> {
  const ids = (await Analysis.find({ repositoryId }).select('_id').lean()).map((a) => a._id);
  await deleteAtlasForAnalyses(ids);
}

/** Remove Atlas files whose analysis no longer exists (or no longer points at them). Returns how many were removed. */
export async function cleanupOrphanAtlasFiles(): Promise<number> {
  const keys = await atlasStore.keys();
  if (!keys.length) return 0;
  const valid = keys.filter((k) => mongoose.Types.ObjectId.isValid(k) && String(new mongoose.Types.ObjectId(k)) === k);
  const live = new Set(
    (await Analysis.find({ _id: { $in: valid }, 'atlas.key': { $exists: true } }).select('_id atlas.key').lean())
      .filter((a: any) => a.atlas?.key === String(a._id))
      .map((a) => String(a._id))
  );
  let removed = 0;
  for (const k of keys) {
    if (live.has(k)) continue;
    await atlasStore.remove(k).catch(() => undefined);
    removed++;
  }
  return removed;
}
