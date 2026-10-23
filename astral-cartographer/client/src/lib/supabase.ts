import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  rawUrl &&
  rawKey &&
  !rawUrl.includes('your-project-id') &&
  !rawKey.includes('your-supabase-publishable')
);

// Fallback placeholder credentials to prevent app crash if .env is missing
const supabaseUrl = isSupabaseConfigured ? rawUrl : 'https://placeholder.supabase.co';
const supabaseKey = isSupabaseConfigured ? rawKey : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function getMissingSupabaseConfigInstructions(): string {
  return (
    'Supabase configuration is missing or incomplete.\n\n' +
    '1. Create a project at https://supabase.com\n' +
    '2. In the Supabase Dashboard, navigate to Project Settings -> API\n' +
    '3. Copy Project URL into VITE_SUPABASE_URL in your .env file\n' +
    '4. Copy anon/public key into VITE_SUPABASE_PUBLISHABLE_KEY in your .env file\n' +
    '5. In Supabase Dashboard -> Authentication -> Providers, enable GitHub with your GitHub OAuth App Client ID and Secret.\n' +
    '6. Set GitHub Authorization callback URL to: ' +
    (isSupabaseConfigured ? `${rawUrl}/auth/v1/callback` : 'https://<your-project>.supabase.co/auth/v1/callback')
  );
}
