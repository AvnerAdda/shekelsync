import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  type AuthSession,
  clearSession as clearStoredSession,
  getSession as loadStoredSession,
  setSession as persistSession,
  subscribeToSessionChanges,
} from '@/lib/session-store';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  sessionLoadError: Error | null;
  refreshSession: () => Promise<void>;
  setSession: (session: AuthSession | null) => Promise<void>;
  clearSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeSessionLoadError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Failed to load persisted session');
}

export const AuthProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoadError, setSessionLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const existing = await loadStoredSession();
        if (mounted) {
          setSessionState(existing ?? null);
          setSessionLoadError(null);
        }
      } catch (error) {
        console.error('[AuthProvider] Failed to load persisted session:', error);
        if (mounted) {
          setSessionLoadError(normalizeSessionLoadError(error));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return subscribeToSessionChanges(next => {
      setSessionState(next ?? null);
    });
  }, []);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const latest = await loadStoredSession();
      setSessionState(latest ?? null);
      setSessionLoadError(null);
    } catch (error) {
      console.error('[AuthProvider] Failed to refresh persisted session:', error);
      setSessionLoadError(normalizeSessionLoadError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const setSession = useCallback(async (nextSession: AuthSession | null) => {
    const persisted = await persistSession(nextSession);
    setSessionState(persisted ?? null);
    setSessionLoadError(null);
  }, []);

  const clearSession = useCallback(async () => {
    await clearStoredSession();
    setSessionState(null);
    setSessionLoadError(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      sessionLoadError,
      refreshSession,
      setSession,
      clearSession,
    }),
    [session, loading, sessionLoadError, refreshSession, setSession, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
