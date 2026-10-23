/**
 * Load one file's source from GitHub, pinned to a commit. Shared by the Dependency Atlas and (later) Code Explorer.
 * Only raw.githubusercontent.com is ever contacted; inputs are validated and every path segment is encoded.
 */
export interface SourceRepo {
  owner: string;
  name: string;
  source?: 'github' | 'zip';
}

export type FetchSourceError = 'zip' | 'invalid' | 'not-found' | 'forbidden' | 'rate-limited' | 'too-large' | 'binary' | 'timeout' | 'network' | 'aborted';

export type FetchSourceResult = { ok: true; text: string } | { ok: false; code: FetchSourceError; message: string };

export const SOURCE_LIMITS = { MAX_BYTES: 1024 * 1024, TIMEOUT_MS: 15000, CACHE_ENTRIES: 60 };
const HOST = 'raw.githubusercontent.com';

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/i;

/** Returns the URL or an error message. Exported for tests. */
export function buildRawUrl(repo: SourceRepo, path: string, commitSha: string): { url: string } | { error: string } {
  if (!OWNER_RE.test(repo.owner)) return { error: 'The repository owner name is not valid.' };
  if (!REPO_RE.test(repo.name) || repo.name === '.' || repo.name === '..') return { error: 'The repository name is not valid.' };
  if (!SHA_RE.test(commitSha)) return { error: 'No commit is recorded for this analysis, so the exact file version cannot be loaded.' };
  if (!path || path.length > 1024 || path.startsWith('/') || /[\\\u0000-\u001f]/.test(path)) return { error: 'The file path is not valid.' };
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return { error: 'The file path is not valid.' };
  const url = `https://${HOST}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${commitSha.toLowerCase()}/${segments.map(encodeURIComponent).join('/')}`;
  try {
    if (new URL(url).hostname !== HOST) return { error: 'Refusing to contact an unexpected host.' };
  } catch {
    return { error: 'The file path is not valid.' };
  }
  return { url };
}

const cache = new Map<string, FetchSourceResult>();

function remember(key: string, r: FetchSourceResult): FetchSourceResult {
  // cache successes and permanent failures only (not timeouts, network errors or rate limits)
  if (r.ok || r.code === 'not-found' || r.code === 'too-large' || r.code === 'binary') {
    cache.set(key, r);
    if (cache.size > SOURCE_LIMITS.CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  }
  return r;
}

export async function fetchFileSource(
  repo: SourceRepo,
  path: string,
  commitSha: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}
): Promise<FetchSourceResult> {
  if (repo.source === 'zip') {
    return { ok: false, code: 'zip', message: 'Code preview is not available for ZIP uploads: there is no GitHub address to load the file from.' };
  }
  const built = buildRawUrl(repo, path, commitSha);
  if ('error' in built) return { ok: false, code: 'invalid', message: built.error };
  const key = built.url;
  const hit = cache.get(key);
  if (hit) return hit;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), SOURCE_LIMITS.TIMEOUT_MS);
  const onOuterAbort = () => ctrl.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const short = commitSha.slice(0, 7);
  try {
    const res = await (opts.fetchImpl ?? fetch)(built.url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (res.status === 404) {
      return remember(key, { ok: false, code: 'not-found', message: `GitHub has no public file at this path for commit ${short}. The repository may be private, or the file was added after this commit.` });
    }
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
      return { ok: false, code: 'rate-limited', message: 'GitHub is rate limiting requests right now. Please wait a few minutes and try again.' };
    }
    if (res.status === 403) return { ok: false, code: 'forbidden', message: 'GitHub refused access to this file. The repository may be private.' };
    if (!res.ok) return { ok: false, code: 'network', message: `GitHub returned an unexpected response (${res.status}). Please try again.` };

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > SOURCE_LIMITS.MAX_BYTES) return remember(key, { ok: false, code: 'too-large', message: 'This file is larger than 1 MB, so it is not shown here.' });

    // read with a hard cap, even if the server did not send a length
    const reader = res.body?.getReader();
    let bytes: Uint8Array;
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > SOURCE_LIMITS.MAX_BYTES) {
          await reader.cancel();
          return remember(key, { ok: false, code: 'too-large', message: 'This file is larger than 1 MB, so it is not shown here.' });
        }
        chunks.push(value);
      }
      bytes = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) { bytes.set(c, o); o += c.length; }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > SOURCE_LIMITS.MAX_BYTES) return remember(key, { ok: false, code: 'too-large', message: 'This file is larger than 1 MB, so it is not shown here.' });
    }
    if (bytes.subarray(0, 8000).includes(0)) return remember(key, { ok: false, code: 'binary', message: 'This is a binary file, so there is no text to show.' });
    return remember(key, { ok: true, text: new TextDecoder('utf-8').decode(bytes) });
  } catch (err) {
    if (ctrl.signal.aborted) {
      if (opts.signal?.aborted) return { ok: false, code: 'aborted', message: 'Loading was cancelled.' };
      return { ok: false, code: 'timeout', message: 'GitHub did not respond in time. Please try again.' };
    }
    return { ok: false, code: 'network', message: 'Could not reach GitHub. Check your internet connection and try again.' };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
}
