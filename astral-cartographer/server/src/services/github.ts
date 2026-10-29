import fs from 'fs';
import axios from 'axios';
import { UserFacingError } from './safeArchive.js';

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const ALLOWED_DOWNLOAD_HOSTS = new Set(['codeload.github.com', 'github.com']);

export const DOWNLOAD_LIMITS = {
  MAX_ARCHIVE_BYTES: 100 * 1024 * 1024,
  CONNECT_TIMEOUT_MS: 15_000,
  TOTAL_TIMEOUT_MS: 120_000,
};

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  /** branch/tag from a `/tree/<ref>` URL (single path segment only) */
  ref?: string;
}

/**
 * Accepts: https://github.com/o/r, http://, www., with .git, trailing slash, /tree/<branch>, /blob/…, /issues…,
 * `github.com/o/r`, `git@github.com:o/r.git`, `ssh://git@github.com/o/r.git`. Host is matched strictly.
 */
export function parseGitHubUrl(rawUrl: string): ParsedGitHubUrl | null {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 300) return null;
  const s = rawUrl.trim();
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)((?:\/[^\s?#]*)?)(?:[?#].*)?$/i.exec(s) ||
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)()$/i.exec(s);
  if (!m) return null;

  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null;

  let ref: string | undefined;
  const rest = (m[3] || '').split('/').filter(Boolean);
  if (rest[0] === 'tree' && rest[1] && /^[A-Za-z0-9._-]+$/.test(rest[1])) ref = rest[1];
  return { owner, repo, ref };
}

function apiHeaders(accept = 'application/vnd.github+json'): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': 'The-Astral-Cartographer/2.0', Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  // Optional server-side token to raise rate limits. Only ever sent to api.github.com, never logged or returned.
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** GitHub's current API rate limit for the credentials this server uses (its GITHUB_TOKEN, or anonymous). */
export async function fetchRateLimit(): Promise<{ authenticated: boolean; limit: number; remaining: number; resetAt: string }> {
  const { data } = await axios.get('https://api.github.com/rate_limit', { headers: apiHeaders(), timeout: 10_000 });
  const core = data?.resources?.core ?? data?.rate;
  if (!core || typeof core.limit !== 'number') throw new Error('GitHub returned an unexpected rate limit response.');
  return { authenticated: !!process.env.GITHUB_TOKEN, limit: core.limit, remaining: core.remaining, resetAt: new Date(core.reset * 1000).toISOString() };
}

function rateLimited(err: any): boolean {
  const s = err?.response?.status;
  return s === 429 || (s === 403 && String(err.response.headers?.['x-ratelimit-remaining']) === '0');
}

export interface RepoMeta {
  fullName: string;
  owner: string;
  repo: string;
  description: string;
  defaultBranch: string;
  /** false when the GitHub API was unavailable (rate-limited) and values are defaults */
  verified: boolean;
}

export async function fetchRepoMeta(owner: string, repo: string): Promise<RepoMeta> {
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers: apiHeaders(), timeout: 10_000 });
    if (data.private) throw new UserFacingError(`"${data.full_name}" is a private repository. Only public repositories can be imported.`, 403);
    return {
      fullName: data.full_name || `${owner}/${repo}`,
      owner: data.owner?.login || owner,
      repo: data.name || repo,
      description: data.description || '',
      defaultBranch: data.default_branch || 'main',
      verified: true,
    };
  } catch (err: any) {
    if (err instanceof UserFacingError) throw err;
    if (err.response?.status === 404) throw new UserFacingError(`GitHub repository "${owner}/${repo}" was not found or is private.`, 404);
    if (rateLimited(err)) {
      console.warn(`[GitHub API] rate limited while reading metadata for ${owner}/${repo}; continuing with defaults.`);
      return { fullName: `${owner}/${repo}`, owner, repo, description: '', defaultBranch: 'HEAD', verified: false };
    }
    throw new UserFacingError('Could not reach GitHub. Please try again shortly.', 502);
  }
}

/** Resolve a branch/tag/HEAD to an immutable commit SHA, so the analysis is pinned to one commit. */
export async function resolveCommitSha(owner: string, repo: string, ref: string): Promise<string | null> {
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, {
      headers: apiHeaders('application/vnd.github.sha'),
      timeout: 10_000,
      responseType: 'text',
      transformResponse: (d) => d,
    });
    const sha = String(data).trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
  } catch (err: any) {
    if (err.response?.status === 404 || err.response?.status === 422) {
      throw new UserFacingError(`Branch or ref "${ref}" was not found in ${owner}/${repo}.`, 404);
    }
    if (rateLimited(err)) return null; // fall back to the commit id embedded in the archive
    return null;
  }
}

/** Stream a codeload archive to disk with a hard byte cap and a total deadline. */
export async function downloadArchive(owner: string, repo: string, ref: string, destFile: string): Promise<void> {
  const url = `https://codeload.github.com/${owner}/${repo}/zip/${ref === 'HEAD' ? 'HEAD' : encodeURIComponent(ref)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_LIMITS.TOTAL_TIMEOUT_MS);

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: DOWNLOAD_LIMITS.CONNECT_TIMEOUT_MS,
      signal: controller.signal,
      maxRedirects: 3,
      headers: { 'User-Agent': 'The-Astral-Cartographer/2.0' },
      beforeRedirect: (opts: any) => {
        if (!ALLOWED_DOWNLOAD_HOSTS.has(opts.hostname)) throw new Error(`Redirect to disallowed host ${opts.hostname}`);
      },
    });

    const declared = Number(response.headers['content-length'] || 0);
    if (declared > DOWNLOAD_LIMITS.MAX_ARCHIVE_BYTES) {
      response.data.destroy();
      throw new UserFacingError(`Repository archive is too large (${Math.round(declared / 1024 / 1024)} MB; maximum ${DOWNLOAD_LIMITS.MAX_ARCHIVE_BYTES / 1024 / 1024} MB).`, 413);
    }

    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(destFile, { mode: 0o600 });
      let received = 0;
      response.data.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > DOWNLOAD_LIMITS.MAX_ARCHIVE_BYTES) {
          response.data.destroy();
          out.destroy();
          reject(new UserFacingError(`Repository archive exceeds the ${DOWNLOAD_LIMITS.MAX_ARCHIVE_BYTES / 1024 / 1024} MB download limit.`, 413));
        }
      });
      response.data.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      response.data.pipe(out);
    });
  } catch (err: any) {
    if (err instanceof UserFacingError) throw err;
    if (err.code === 'ERR_CANCELED' || controller.signal.aborted) throw new UserFacingError('Downloading the repository timed out.', 504);
    if (err.response?.status === 404) throw new UserFacingError(`Could not download ${owner}/${repo}@${ref}: archive not found (is the repository empty?).`, 404);
    throw new UserFacingError('Failed to download the repository archive from GitHub.', 502);
  } finally {
    clearTimeout(timer);
  }
}
