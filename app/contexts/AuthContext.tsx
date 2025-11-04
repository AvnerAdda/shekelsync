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
  refreshSession: () => Promise<void>;
  setSession: (session: AuthSession | null) => Promise<void>;
  clearSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const existing = await loadStoredSession();
        if (mounted) {
          setSessionState(existing ?? null);
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
    const latest = await loadStoredSession();
    setSessionState(latest ?? null);
  }, []);

  const setSession = useCallback(async (nextSession: AuthSession | null) => {
    await persistSession(nextSession);
    setSessionState(nextSession ?? null);
  }, []);

  const clearSession = useCallback(async () => {
    await clearStoredSession();
    setSessionState(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      refreshSession,
      setSession,
      clearSession,
    }),
    [session, loading, refreshSession, setSession, clearSession],
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

