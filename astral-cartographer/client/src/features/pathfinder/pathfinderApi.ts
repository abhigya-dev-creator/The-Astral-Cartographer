import { supabase } from '../../lib/supabase';
import { ApiError } from '../../lib/api';

/** Learning progress and saved opportunities, stored per user and repository by the analysis server. */
export interface PathfinderState {
  completed: string[];
  current: string | null;
  saved: string[];
}

async function call<T>(repositoryId: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ApiError('You must be signed in to save progress.', 401);
  let res: Response;
  try {
    res = await fetch(`/api/repositories/${encodeURIComponent(repositoryId)}/pathfinder`, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new ApiError('Could not reach the analysis server.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 404 without a code comes from the server's catch-all: it runs code from before this feature existed.
    if (res.status === 404 && /^not found\.?$/i.test(body?.error ?? '')) throw new ApiError('The analysis server is running an older version without progress saving. Restart it to enable saving.', 404);
    throw new ApiError(typeof body?.error === 'string' ? body.error : `The server returned ${res.status}.`, res.status);
  }
  return body as T;
}

export const pathfinderApi = {
  load: (repositoryId: string) => call<PathfinderState>(repositoryId),
  save: (repositoryId: string, patch: Partial<PathfinderState>) => call<PathfinderState>(repositoryId, { method: 'PUT', body: JSON.stringify(patch) }),
};
