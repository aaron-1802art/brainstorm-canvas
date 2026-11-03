'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type { Profile } from '@/lib/types';

export interface AuthResponse {
  error: string | null;
  message?: string;
}

export interface AuthState {
  /** True while the initial session check is pending. */
  loading: boolean;
  /** The current Supabase user, or null. */
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** True if Supabase URL and anon key are configured in environment. */
  configured: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<AuthResponse>;
  signIn: (email: string, password: string) => Promise<AuthResponse>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/* ------------------------------------------------------------------ */
/*  Provider                                                          */
/* ------------------------------------------------------------------ */

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState<boolean>(configured);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  /* Fetch profile from the profiles table */
  const fetchProfile = useCallback(async (userId: string) => {
    const sb = getSupabase();
    if (!sb) return;
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('id, email, display_name, avatar_url, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (data && !error) {
        setProfile(data as Profile);
      }
    } catch {
      // Ignore network errors during background profile fetch
    }
  }, []);

  /* Listen for auth state changes */
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }

    // Get initial session
    sb.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          fetchProfile(s.user.id);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile(s.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  /* Sign up */
  const signUp = useCallback(
    async (email: string, password: string, displayName: string): Promise<AuthResponse> => {
      const sb = getSupabase();
      if (!sb) return { error: 'Supabase is not configured' };
      try {
        const { data, error } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() },
          },
        });
        if (error) return { error: error.message };
        if (data.user && !data.session) {
          return {
            error: null,
            message: 'Confirmation email sent! Please check your inbox.',
          };
        }
        return { error: null };
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : 'Sign up failed' };
      }
    },
    [],
  );

  /* Sign in */
  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResponse> => {
      const sb = getSupabase();
      if (!sb) return { error: 'Supabase is not configured' };
      try {
        const { error } = await sb.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) return { error: error.message };
        return { error: null };
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : 'Sign in failed' };
      }
    },
    [],
  );

  /* Sign out */
  const signOut = useCallback(async () => {
    const sb = getSupabase();
    if (sb) {
      try {
        await sb.auth.signOut();
      } catch {
        // Ignore errors on sign out
      }
    }
    setSession(null);
    setUser(null);
    setProfile(null);
  }, []);

  /* Refresh profile */
  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  }, [user, fetchProfile]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      user,
      session,
      profile,
      configured,
      signUp,
      signIn,
      signOut,
      refreshProfile,
    }),
    [loading, user, session, profile, configured, signUp, signIn, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
