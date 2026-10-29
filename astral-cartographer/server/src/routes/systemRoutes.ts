import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDbMode } from '../config/db.js';
import { ANALYZER_VERSION, EXT_LANGUAGE, IGNORED_DIR_NAMES, LIMITS } from '../services/analysis/languages.js';
import { ATLAS_LIMITS } from '../services/atlas/analyzeAtlas.js';
import { ARCHIVE_LIMITS } from '../services/safeArchive.js';
import { DOWNLOAD_LIMITS, fetchRateLimit } from '../services/github.js';
import { EXCLUDE_LIMITS } from '../services/excludePatterns.js';
import { ZIP_UPLOAD_MAX_BYTES } from './repositoryRoutes.js';

/**
 * Facts about this server for the Settings page, so the website shows the real analysis rules instead of
 * copies that can drift:
 *   GET /api/system/info    limits, always-skipped folders, language support, analyzer version
 *   GET /api/system/github  GitHub's rate limit for the credentials the server actually uses
 */
const router = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** language name -> what is measured; one row per language (several extensions share one) */
function languageTable() {
  const rows = new Map<string, { name: string; extensions: string[]; functions: string; dependencies: string }>();
  for (const [ext, info] of Object.entries(EXT_LANGUAGE)) {
    if (!info.isCode) continue;
    const row = rows.get(info.name) ?? { name: info.name, extensions: [], functions: info.functions, dependencies: info.dependencies };
    row.extensions.push(ext);
    rows.set(info.name, row);
  }
  // the Dependency Atlas maps Java imports itself (services/atlas/javaDeps.ts)
  const java = rows.get('Java');
  if (java) java.dependencies = 'map only';
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

router.get('/info', requireAuth, (_req, res) => {
  res.json({
    analyzerVersion: ANALYZER_VERSION,
    database: getDbMode(),
    githubTokenConfigured: !!process.env.GITHUB_TOKEN,
    limits: {
      maxFiles: LIMITS.MAX_FILES,
      maxParseBytes: LIMITS.MAX_PARSE_BYTES,
      analysisTimeBudgetMs: LIMITS.ANALYSIS_TIME_BUDGET_MS,
      maxMapFileBytes: ATLAS_LIMITS.MAX_FILE_BYTES,
      maxGithubArchiveBytes: DOWNLOAD_LIMITS.MAX_ARCHIVE_BYTES,
      maxZipUploadBytes: ZIP_UPLOAD_MAX_BYTES,
      maxArchiveEntries: ARCHIVE_LIMITS.MAX_ENTRIES,
      maxExcludePatterns: EXCLUDE_LIMITS.MAX_PATTERNS,
    },
    alwaysSkippedFolders: [...IGNORED_DIR_NAMES].sort(),
    languages: languageTable(),
  });
});

router.get('/github', requireAuth, wrap(async (_req, res) => {
  try {
    res.json(await fetchRateLimit());
  } catch (err: any) {
    res.status(502).json({ error: `GitHub could not be reached (${err?.response?.status ?? err?.code ?? 'network error'}).` });
  }
}));

export default router;
