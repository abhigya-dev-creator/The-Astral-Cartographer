import { supabase } from '../../lib/supabase';
import { parseAtlasData, type AtlasData } from './model';

export type AtlasLoadError = 'NO_ATLAS' | 'NO_ANALYSIS' | 'TOO_LARGE' | 'NOT_FOUND' | 'AUTH' | 'NETWORK' | 'INVALID' | 'SERVER';

export type AtlasLoad = { ok: true; data: AtlasData } | { ok: false; code: AtlasLoadError; message: string };

/**
 * GET /api/repositories/:id/atlas. The browser decompresses the gzip response transparently.
 * Every failure becomes a typed result so the page can show the right state (never an empty map).
 */
export async function fetchAtlas(repositoryId: string, signal?: AbortSignal): Promise<AtlasLoad> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, code: 'AUTH', message: 'Please sign in again to load the dependency map.' };

  let res: Response;
  try {
    res = await fetch(`/api/repositories/${encodeURIComponent(repositoryId)}/atlas`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal,
    });
  } catch {
    if (signal?.aborted) return { ok: false, code: 'NETWORK', message: 'Loading was cancelled.' };
    return { ok: false, code: 'NETWORK', message: 'Could not reach the analysis server. Check that it is running and try again.' };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    const message = body.error || `The server returned ${res.status}.`;
    if (res.status === 404 && body.code === 'NO_ATLAS') return { ok: false, code: 'NO_ATLAS', message };
    if (res.status === 404 && body.code === 'NO_ANALYSIS') return { ok: false, code: 'NO_ANALYSIS', message };
    // A 404 without a code comes from the server's catch-all: it does not know the Atlas route at all,
    // which means it is running code from before the Atlas was added.
    if (res.status === 404 && !body.code && /^not found\.?$/i.test(body.error ?? '')) {
      return { ok: false, code: 'SERVER', message: 'The analysis server does not have the dependency-map feature yet: it is probably still running an older version. Restart it (Ctrl+C, then "npm run dev" in the server folder) and try again.' };
    }
    if (res.status === 404) return { ok: false, code: 'NOT_FOUND', message };
    if (res.status === 413) return { ok: false, code: 'TOO_LARGE', message };
    if (res.status === 401 || res.status === 403) return { ok: false, code: 'AUTH', message: 'Your session has expired. Please sign in again.' };
    return { ok: false, code: 'SERVER', message };
  }

  try {
    return { ok: true, data: parseAtlasData(await res.json()) };
  } catch (err) {
    return { ok: false, code: 'INVALID', message: err instanceof Error ? err.message : 'The dependency map could not be read.' };
  }
}
