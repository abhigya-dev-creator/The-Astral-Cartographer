import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    user_metadata?: Record<string, any>;
  };
}

// The client is created lazily so environment variables are read after dotenv has run
// (ES-module imports are evaluated before any code in the importing file).
let client: SupabaseClient | null = null;
export function getSupabaseServer(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  // getUser() only needs the public (anon/publishable) key; the service-role key is accepted as a fallback only.
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Authentication is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY in server/.env.');
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function assertAuthConfigured(): void {
  getSupabaseServer();
}

/** Short-lived cache of tokens already verified by Supabase (keyed by hash, never stores the token). */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
const verified = new Map<string, { user: NonNullable<AuthenticatedRequest['user']>; expires: number }>();

function cacheGet(token: string) {
  const k = crypto.createHash('sha256').update(token).digest('hex');
  const hit = verified.get(k);
  if (hit && hit.expires > Date.now()) return hit.user;
  if (hit) verified.delete(k);
  return null;
}
function cacheSet(token: string, user: NonNullable<AuthenticatedRequest['user']>) {
  if (verified.size >= CACHE_MAX) verified.delete(verified.keys().next().value as string);
  verified.set(crypto.createHash('sha256').update(token).digest('hex'), { user, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Every token is verified server-side by Supabase Auth (signature, expiry, revocation).
 * There is deliberately NO fallback that trusts an unverified JWT payload.
 */
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const match = header && /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header);
  if (!match) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header. Expected Bearer token.' });
  }
  const token = match[1];

  const cached = cacheGet(token);
  if (cached) { req.user = cached; return next(); }

  try {
    const { data, error } = await getSupabaseServer().auth.getUser(token);
    if (error || !data?.user) {
      // Distinguish "token rejected" from "could not reach the auth service": the latter must not look like a bad login.
      const status = (error as any)?.status;
      if (!error || (typeof status === 'number' && status >= 400 && status < 500)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token.' });
      }
      console.error('[Auth] Supabase unreachable:', error?.message);
      return res.status(503).json({ error: 'Authentication service temporarily unavailable. Please retry.' });
    }
    const user = { id: data.user.id, email: data.user.email, user_metadata: data.user.user_metadata };
    cacheSet(token, user);
    req.user = user;
    return next();
  } catch (err: any) {
    console.error('[Auth] Token verification failed:', err.message);
    return res.status(503).json({ error: 'Authentication service temporarily unavailable. Please retry.' });
  }
}
