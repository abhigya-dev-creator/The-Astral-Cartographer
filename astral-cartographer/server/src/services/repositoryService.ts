import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import mongoose from 'mongoose';
import { Repository, IRepository } from '../models/Repository.js';
import { Analysis, IAnalysis } from '../models/Analysis.js';
import { CodeAnalyzer, ANALYZER_VERSION } from './analyzer.js';
import { buildAndStoreAtlas, deleteAtlasForAnalyses } from './atlas/atlasService.js';
import type { AtlasMeta } from './atlas/store.js';
import type { AnalysisResult } from './analysis/types.js';
import { downloadArchive, fetchRepoMeta, parseGitHubUrl, resolveCommitSha } from './github.js';
import { isZipBuffer, safeExtract, UserFacingError, type ExtractStats } from './safeArchive.js';

export { parseGitHubUrl } from './github.js';
export { UserFacingError } from './safeArchive.js';

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  description: string;
  defaultBranch: string;
}

const MAX_CONCURRENT_ANALYSES = Math.max(1, Number(process.env.MAX_CONCURRENT_ANALYSES) || 2);
const KEEP_ANALYSES_PER_REPO = 5;
/** MongoDB's hard limit is 16 MB per document; stay well under it. */
const MAX_ANALYSIS_BSON_BYTES = 14 * 1024 * 1024;

const inFlight = new Set<string>();
let activeAnalyses = 0;

type Stage = 'downloading' | 'extracting' | 'analyzing' | 'saving';
const STAGE_MESSAGES: Record<Stage, string> = {
  downloading: 'Downloading repository archive from GitHub...',
  extracting: 'Safely extracting and inspecting files...',
  analyzing: 'Parsing source files, resolving imports and checking architecture...',
  saving: 'Saving analysis results...',
};

interface SourceInfo {
  root: string;
  commitSha: string;
  branch?: string;
  archive: ExtractStats;
}

export interface AnalyzeOptions {
  /** re-run even if this exact commit was already analysed with the current analyzer version */
  force?: boolean;
}

export interface AnalyzeOutcome {
  repository: any;
  analysis: any;
  reused: boolean;
}

const caseInsensitive = { locale: 'en', strength: 2 } as const;

async function setStage(repoId: mongoose.Types.ObjectId, stage: Stage): Promise<void> {
  await Repository.updateOne({ _id: repoId }, { analysisStage: stage, statusMessage: STAGE_MESSAGES[stage] }).catch(() => undefined);
}

/** Keep the stored document under MongoDB's limit, reducing the least valuable detail first and saying so. */
export function fitToDocumentLimit(payload: any, warnings: string[], limit = MAX_ANALYSIS_BSON_BYTES): boolean {
  const size = () => (mongoose.mongo as any).BSON.calculateObjectSize(payload) as number;
  if (size() <= limit) return false;

  for (const f of payload.files) f.dependencies = [];
  warnings.push('Stored detail was reduced to fit the database limit: raw import specifier lists were omitted.');
  if (size() > limit) {
    for (const f of payload.files) { f.warnings = []; f.unresolvedLocalDeps = f.unresolvedLocalDeps.slice(0, 5); }
  }
  if (size() > limit) {
    const before = payload.files.length;
    payload.files = payload.files.filter((f: any) => f.parseStatus !== 'not_code');
    warnings.push(`Non-code files (${before - payload.files.length}) were omitted from the stored file list; metrics still include them.`);
  }
  if (size() > limit) {
    throw new UserFacingError('This repository produced more analysis data than can be stored. Try analysing a smaller subtree.', 413);
  }
  return true;
}

function sanitizeProjectName(name: string): string {
  const cleaned = String(name || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return cleaned || 'Uploaded Project';
}

export class RepositoryService {
  // ---------------------------------------------------------------------------------------
  // Public entry points
  // ---------------------------------------------------------------------------------------
  public static async analyzeGitHubRepo(userId: string, rawUrl: string, options: AnalyzeOptions = {}): Promise<AnalyzeOutcome> {
    const parsed = parseGitHubUrl(rawUrl);
    if (!parsed) {
      throw new UserFacingError('Invalid GitHub URL. Use a link like https://github.com/owner/repository');
    }

    const meta = await fetchRepoMeta(parsed.owner, parsed.repo);
    const ref = parsed.ref || meta.defaultBranch;
    const sha = await resolveCommitSha(meta.owner, meta.repo, ref);

    return this.run({
      userId,
      key: meta.fullName.toLowerCase(),
      force: !!options.force,
      repoFields: {
        name: meta.repo,
        owner: meta.owner,
        fullName: meta.fullName,
        source: 'github',
        githubUrl: `https://github.com/${meta.fullName}`,
        description: meta.description,
        defaultBranch: parsed.ref || meta.defaultBranch,
      },
      knownCommit: sha,
      branch: ref,
      acquire: async (workDir, stage) => {
        await stage('downloading');
        const archivePath = path.join(workDir, 'repo.zip');
        await downloadArchive(meta.owner, meta.repo, sha || ref, archivePath);
        await stage('extracting');
        const zip = new AdmZip(archivePath);
        const { root, stats, commitComment } = safeExtract(zip, path.join(workDir, 'src'));
        fs.rmSync(archivePath, { force: true });
        // GitHub stores the exact commit id in the zip comment; used when the API could not be queried.
        const commit = sha || (/^[0-9a-f]{40}$/i.test(commitComment) ? commitComment.toLowerCase() : `unknown-${Date.now()}`);
        return { root, commitSha: commit, branch: ref, archive: stats };
      },
    });
  }

  public static async analyzeZipUpload(userId: string, projectName: string, buffer: Buffer, options: AnalyzeOptions = {}): Promise<AnalyzeOutcome> {
    if (!isZipBuffer(buffer)) throw new UserFacingError('The uploaded file is not a valid ZIP archive.');
    const name = sanitizeProjectName(projectName);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 40);

    return this.run({
      userId,
      key: `zip:${name.toLowerCase()}`,
      force: !!options.force,
      repoFields: {
        name,
        owner: 'Local Upload',
        fullName: `Local Upload / ${name}`,
        source: 'zip',
        description: 'Locally uploaded ZIP archive',
        defaultBranch: 'upload',
      },
      knownCommit: hash,
      branch: 'upload',
      acquire: async (workDir, stage) => {
        await stage('extracting');
        let zip: AdmZip;
        try { zip = new AdmZip(buffer); } catch { throw new UserFacingError('The uploaded file is not a valid ZIP archive.'); }
        const { root, stats } = safeExtract(zip, path.join(workDir, 'src'));
        return { root, commitSha: hash, branch: 'upload', archive: stats };
      },
    });
  }

  /** Called once at startup: a restart kills any in-progress run, so mark those as failed instead of "analyzing" forever. */
  public static async recoverInterrupted(): Promise<number> {
    const msg = 'Analysis was interrupted by a server restart. Please run it again.';
    const r = await Repository.updateMany({ analysisStatus: { $in: ['pending', 'analyzing'] } }, { analysisStatus: 'failed', statusMessage: msg, analysisStage: '' });
    await Analysis.updateMany({ status: { $in: ['pending', 'analyzing'] } }, { status: 'failed', errorMessage: msg });
    return r.modifiedCount;
  }

  // ---------------------------------------------------------------------------------------
  // Shared pipeline
  // ---------------------------------------------------------------------------------------
  private static async run(params: {
    userId: string;
    key: string;
    force: boolean;
    repoFields: Partial<IRepository>;
    knownCommit: string | null;
    branch: string;
    acquire: (workDir: string, stage: (s: Stage) => Promise<void>) => Promise<SourceInfo>;
  }): Promise<AnalyzeOutcome> {
    const lockKey = `${params.userId}:${params.key}`;
    if (inFlight.has(lockKey)) throw new UserFacingError('This repository is already being analysed. Please wait for it to finish.', 409);
    if (activeAnalyses >= MAX_CONCURRENT_ANALYSES) throw new UserFacingError('The server is busy analysing other repositories. Please try again in a minute.', 503);

    inFlight.add(lockKey);
    activeAnalyses++;
    let workDir: string | null = null;
    let repo: IRepository | null = null;
    let analysisDoc: IAnalysis | null = null;

    try {
      repo = await this.upsertRepository(params.userId, params.repoFields);

      // Reuse: same commit + same analyzer version => identical result, skip the work.
      if (params.knownCommit && !params.force) {
        const existing = await Analysis.findOne({
          repositoryId: repo._id,
          status: 'completed',
          commitSha: params.knownCommit,
          analyzerVersion: ANALYZER_VERSION,
        }).sort({ createdAt: -1 });
        if (existing) {
          const updated = await Repository.findByIdAndUpdate(
            repo._id,
            { analysisStatus: 'completed', statusMessage: 'Showing existing analysis for this commit (no changes since last run).', analysisStage: '', latestAnalysisId: existing._id, commitSha: existing.commitSha, lastAnalyzedAt: new Date() },
            { new: true }
          );
          return { repository: updated!.toObject(), analysis: existing.toObject(), reused: true };
        }
      }

      await Repository.updateOne({ _id: repo._id }, { analysisStatus: 'analyzing', analysisStage: 'downloading', statusMessage: 'Starting analysis...' });
      analysisDoc = await Analysis.create({ repositoryId: repo._id, userId: params.userId, status: 'analyzing', commitSha: params.knownCommit || undefined, branch: params.branch, analyzerVersion: ANALYZER_VERSION, version: '1.0' });

      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astral-'));
      const source = await params.acquire(workDir, (s) => setStage(repo!._id, s));

      // The API may have been unavailable (rate limit), so the commit is only known now (from the archive itself).
      // Re-check for an identical, already-completed analysis before spending CPU on a new one.
      if (!params.knownCommit && !params.force) {
        const existing = await Analysis.findOne({ repositoryId: repo._id, status: 'completed', commitSha: source.commitSha, analyzerVersion: ANALYZER_VERSION }).sort({ createdAt: -1 });
        if (existing) {
          await Analysis.deleteOne({ _id: analysisDoc._id });
          const updated = await Repository.findByIdAndUpdate(
            repo._id,
            { analysisStatus: 'completed', statusMessage: 'Showing existing analysis for this commit (no changes since last run).', analysisStage: '', latestAnalysisId: existing._id, commitSha: existing.commitSha, lastAnalyzedAt: new Date() },
            { new: true }
          );
          return { repository: updated!.toObject(), analysis: existing.toObject(), reused: true };
        }
      }

      await setStage(repo._id, 'analyzing');
      const analyzer = new CodeAnalyzer(source.root, { keepSources: true });
      const result: AnalysisResult = await analyzer.analyze();
      result.metrics.coverage.archive = source.archive;

      await setStage(repo._id, 'saving');
      const warnings = [...result.metrics.coverage.warnings];
      // Dependency Atlas from the same files. Must never break the analysis: any failure becomes a warning.
      let atlas: AtlasMeta | null = null;
      try {
        atlas = await buildAndStoreAtlas({
          root: source.root,
          analysisId: String(analysisDoc._id),
          repo: { owner: repo.owner, name: repo.name, branch: source.branch ?? '', commitSha: source.commitSha ?? '', source: repo.source },
          kept: analyzer.keptSources,
          capped: analyzer.keptSourcesCapped,
        });
      } catch (err: any) {
        console.warn(`[Atlas] map generation failed for analysis ${String(analysisDoc._id)}: ${err?.message || err}`);
        warnings.push('The dependency map could not be generated for this analysis. Re-analyze to try again.');
      } finally {
        analyzer.keptSources = null; // free the kept texts before saving
      }
      const payload = {
        status: 'completed' as const,
        version: '1.0',
        commitSha: source.commitSha,
        branch: source.branch,
        analyzerVersion: result.analyzerVersion,
        metrics: result.metrics,
        languages: result.languages,
        files: result.files,
        issues: result.issues,
        dependencyGraph: result.dependencyGraph,
        warnings,
        truncated: false,
        atlas,
      };
      payload.truncated = fitToDocumentLimit(payload, warnings);
      if (payload.truncated) payload.metrics.coverage.warnings = warnings;

      const saved = await Analysis.findByIdAndUpdate(analysisDoc._id, { $set: payload, $unset: { errorMessage: 1 } }, { new: true });
      if (!saved) throw new Error('Analysis record disappeared while saving.');

      const partial = result.metrics.coverage.completeness === 'partial';
      const updatedRepo = await Repository.findByIdAndUpdate(
        repo._id,
        {
          primaryLanguage: result.primaryLanguage,
          fileCount: result.metrics.totalFiles,
          analysisStatus: 'completed',
          analysisStage: '',
          statusMessage: partial ? `Analysis complete (partial coverage): ${result.metrics.supportStatus.reason || warnings[0] || 'see warnings'}` : 'Analysis complete.',
          commitSha: source.commitSha,
          latestAnalysisId: saved._id,
          lastAnalyzedAt: new Date(),
        },
        { new: true }
      );

      await this.pruneOldAnalyses(repo._id, saved._id);
      return { repository: updatedRepo!.toObject(), analysis: saved.toObject(), reused: false };
    } catch (err: any) {
      const userMessage = err instanceof UserFacingError ? err.message : 'Analysis failed due to an internal error. Please try again.';
      if (!(err instanceof UserFacingError)) console.error('[Analysis] Unexpected failure:', err);
      // Record the failure; the previous completed analysis (if any) stays available via latestAnalysisId.
      if (repo) await Repository.updateOne({ _id: repo._id }, { analysisStatus: 'failed', analysisStage: '', statusMessage: userMessage }).catch(() => undefined);
      if (analysisDoc) await Analysis.updateOne({ _id: analysisDoc._id }, { status: 'failed', errorMessage: userMessage }).catch(() => undefined);
      if (analysisDoc) await deleteAtlasForAnalyses([analysisDoc._id]); // never leave a map for a failed run
      throw err;
    } finally {
      if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
      inFlight.delete(lockKey);
      activeAnalyses--;
    }
  }

  private static async upsertRepository(userId: string, fields: Partial<IRepository>): Promise<IRepository> {
    const find = () => Repository.findOne({ userId, fullName: fields.fullName }).collation(caseInsensitive);
    const existing = await find();
    if (existing) {
      Object.assign(existing, { description: fields.description, defaultBranch: fields.defaultBranch, githubUrl: fields.githubUrl ?? existing.githubUrl, fullName: fields.fullName, name: fields.name, owner: fields.owner });
      return existing.save();
    }
    try {
      return await Repository.create({ userId, ...fields, analysisStatus: 'pending', statusMessage: 'Queued...' });
    } catch (err: any) {
      if (err?.code === 11000) { const again = await find(); if (again) return again; }
      throw err;
    }
  }

  private static async pruneOldAnalyses(repositoryId: mongoose.Types.ObjectId, keepId: mongoose.Types.ObjectId): Promise<void> {
    try {
      const old = await Analysis.find({ repositoryId, _id: { $ne: keepId } }).sort({ createdAt: -1 }).skip(KEEP_ANALYSES_PER_REPO - 1).select('_id').lean();
      if (old.length) {
        await Analysis.deleteMany({ _id: { $in: old.map((o) => o._id) } });
        await deleteAtlasForAnalyses(old.map((o) => o._id));
      }
    } catch (err) {
      console.warn('[Analysis] pruning old analyses failed:', (err as Error).message);
    }
  }
}
