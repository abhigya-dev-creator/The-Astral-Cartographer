import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, getMissingSupabaseConfigInstructions } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  isConfigured: boolean;
  signInWithGithub: () => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithEmail: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null; data: any }>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  resendVerification: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // 1. Get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession }, error: sessionError }) => {
      if (sessionError) {
        console.error('Error fetching Supabase session:', sessionError.message);
        setError(sessionError.message);
      } else {
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
      }
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to initialize session:', err);
      setLoading(false);
    });

    // 2. Subscribe to auth changes (OAuth redirect callbacks, token refresh, logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const clearError = () => setError(null);

  const signInWithGithub = async () => {
    clearError();
    if (!isSupabaseConfigured) {
      const instructions = getMissingSupabaseConfigInstructions();
      const err = new Error(instructions);
      setError(instructions);
      return { error: err };
    }

    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo,
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        return { error: oauthError };
      }
      return { error: null };
    } catch (err: any) {
      const msg = err?.message || 'Failed to initiate GitHub login.';
      setError(msg);
      return { error: new Error(msg) };
    }
  };

  const signInWithGoogle = async () => {
    clearError();
    if (!isSupabaseConfigured) {
      const instructions = getMissingSupabaseConfigInstructions();
      const err = new Error(instructions);
      setError(instructions);
      return { error: err };
    }

    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        return { error: oauthError };
      }
      return { error: null };
    } catch (err: any) {
      const msg = err?.message || 'Failed to initiate Google login.';
      setError(msg);
      return { error: new Error(msg) };
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    clearError();
    if (!isSupabaseConfigured) {
      const instructions = getMissingSupabaseConfigInstructions();
      const err = new Error(instructions);
      setError(instructions);
      return { error: err };
    }

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return { error: signInError };
      }

      setSession(data.session);
      setUser(data.user);
      return { error: null };
    } catch (err: any) {
      const msg = err?.message || 'Failed to sign in.';
      setError(msg);
      return { error: new Error(msg) };
    }
  };

  const signUpWithEmail = async (email: string, password: string, fullName?: string) => {
    clearError();
    if (!isSupabaseConfigured) {
      const instructions = getMissingSupabaseConfigInstructions();
      const err = new Error(instructions);
      setError(instructions);
      return { error: err, data: null };
    }

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return { error: signUpError, data: null };
      }

      if (data.session) {
        setSession(data.session);
        setUser(data.user);
      }
      return { error: null, data };
    } catch (err: any) {
      const msg = err?.message || 'Failed to create account.';
      setError(msg);
      return { error: new Error(msg), data: null };
    }
  };

  const resetPassword = async (email: string) => {
    clearError();
    if (!isSupabaseConfigured) {
      const instructions = getMissingSupabaseConfigInstructions();
      const err = new Error(instructions);
      setError(instructions);
      return { error: err };
    }

    try {
      const redirectTo = `${window.location.origin}/auth/callback?type=recovery`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetError) {
        setError(resetError.message);
        return { error: resetError };
      }
      return { error: null };
    } catch (err: any) {
      const msg = err?.message || 'Failed to send password reset email.';
      setError(msg);
      return { error: new Error(msg) };
    }
  };

  const resendVerification = async (email: string) => {
    clearError();
    if (!isSupabaseConfigured) {
      const instructions = getMissingSupabaseConfigInstructions();
      const err = new Error(instructions);
      setError(instructions);
      return { error: err };
    }

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });

      if (resendError) {
        setError(resendError.message);
        return { error: resendError };
      }
      return { error: null };
    } catch (err: any) {
      const msg = err?.message || 'Failed to resend confirmation email.';
      setError(msg);
      return { error: new Error(msg) };
    }
  };

  const updatePassword = async (password: string) => {
    clearError();
    if (!isSupabaseConfigured) {
      const instructions = getMissingSupabaseConfigInstructions();
      const err = new Error(instructions);
      setError(instructions);
      return { error: err };
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
        return { error: updateError };
      }
      return { error: null };
    } catch (err: any) {
      const msg = err?.message || 'Failed to update password.';
      setError(msg);
      return { error: new Error(msg) };
    }
  };

  const signOut = async () => {
    clearError();
    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error('Sign out error:', err);
      }
    }
    setSession(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        error,
        isConfigured: isSupabaseConfigured,
        signInWithGithub,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        resetPassword,
        resendVerification,
        updatePassword,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
