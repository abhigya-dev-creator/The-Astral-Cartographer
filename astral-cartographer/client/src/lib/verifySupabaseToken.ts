/**
 * Express Middleware for Server-Side Supabase Token Verification.
 * 
 * In accordance with security requirements:
 * - Verifies the Supabase access token (JWT) server-side via `supabase.auth.getUser(jwt)`
 * - Never trusts a user ID supplied by the client alone in the request body/params
 * - Extracts authenticated user ID (`req.user.id`) directly from the verified Supabase token
 * 
 * Usage in an Express application:
 * ```ts
 * import express from 'express';
 * import { requireSupabaseAuth } from './verifySupabaseToken';
 * 
 * const app = express();
 * app.get('/api/protected-data', requireSupabaseAuth, (req, res) => {
 *   const userId = (req as any).user.id;
 *   res.json({ message: 'Secure endpoint', userId });
 * });
 * ```
 */

import { createClient } from '@supabase/supabase-js';

declare const process: any;

// Server-side initialization using service role or standard API key from environment
const serverSupabaseUrl = (typeof process !== 'undefined' && process.env ? process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL : '') || '';
const serverSupabaseKey = (typeof process !== 'undefined' && process.env ? process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY : '') || '';

export const serverSupabase = createClient(serverSupabaseUrl, serverSupabaseKey);

export async function requireSupabaseAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or invalid Authorization Bearer token header.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await serverSupabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'Unauthorized: Invalid or expired Supabase access token.',
      });
    }

    // Attach verified user to request object
    req.user = user;
    return next();
  } catch (err: any) {
    return res.status(500).json({
      error: 'Internal authentication verification error.',
    });
  }
}
