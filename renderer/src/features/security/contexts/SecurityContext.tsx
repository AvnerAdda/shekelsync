import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiClient } from '@/lib/api-client';

interface SecurityStatus {
  encryption: {
    status: 'active' | 'inactive' | 'error';
    algorithm: string;
    keyStorage: string;
  };
  keychain: {
    status: 'connected' | 'fallback' | 'error';
    type: string;
    available: boolean;
    fallbackMode: boolean;
  };
  authentication: {
    isActive: boolean;
    method: string | null;
    lastAuthenticated: string | null;
    requiresReauth: boolean;
  };
  biometric: {
    available: boolean;
    type: string | null;
    reason: string | null;
  };
  platform: {
    os: string;
    osName: string;
  };
}

interface SecuritySummary {
  level: 'secure' | 'warning' | 'error' | 'unknown';
  checks: {
    encryption: boolean;
    keychain: boolean;
    authenticated: boolean;
  };
  warnings: string[];
}

interface SecurityContextValue {
  status: SecurityStatus | null;
  summary: SecuritySummary | null;
  loading: boolean;
  error: string | null;
  refreshStatus: () => Promise<void>;
  refreshSummary: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SecurityContext = createContext<SecurityContextValue | undefined>(undefined);

interface SecurityProviderProps {
  children: ReactNode;
  autoRefreshInterval?: number; // in milliseconds, default 60000 (1 minute)
}

export const SecurityProvider: React.FC<SecurityProviderProps> = ({
  children,
  autoRefreshInterval = 60000,
}) => {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSecurityStatus = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/security/status');

      if (response.ok && response.data) {
        const responseData = response.data as { success: boolean; data: SecurityStatus };
        setStatus(responseData.data);
        setError(null);
        return responseData.data;
      } else {
        throw new Error('Failed to fetch security status');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error fetching security status';
      console.error('[SecurityContext] Error fetching status:', err);
      setError(errorMessage);
      throw err;
    }
  }, []);

  const fetchSecuritySummary = useCallback(async () => {
    try {
      const response = await apiClient.get('/api/security/summary');

      if (response.ok && response.data) {
        const responseData = response.data as { success: boolean; data: SecuritySummary };
        setSummary(responseData.data);
        setError(null);
        return responseData.data;
      } else {
        throw new Error('Failed to fetch security summary');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error fetching security summary';
      console.error('[SecurityContext] Error fetching summary:', err);
      setError(errorMessage);
      throw err;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      await fetchSecurityStatus();
    } catch (err) {
      // Error already handled in fetchSecurityStatus
    } finally {
      setLoading(false);
    }
  }, [fetchSecurityStatus]);

  const refreshSummary = useCallback(async () => {
    setLoading(true);
    try {
      await fetchSecuritySummary();
    } catch (err) {
      // Error already handled in fetchSecuritySummary
    } finally {
      setLoading(false);
    }
  }, [fetchSecuritySummary]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchSecurityStatus(), fetchSecuritySummary()]);
    } catch (err) {
      // Errors already handled in individual fetch functions
    } finally {
      setLoading(false);
    }
  }, [fetchSecurityStatus, fetchSecuritySummary]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefreshInterval > 0) {
      const interval = setInterval(() => {
        refresh();
      }, autoRefreshInterval);

      return () => clearInterval(interval);
    }
  }, [autoRefreshInterval, refresh]);

  const value: SecurityContextValue = {
    status,
    summary,
    loading,
    error,
    refreshStatus,
    refreshSummary,
    refresh,
  };

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
};

export const useSecurity = (): SecurityContextValue => {
  const context = useContext(SecurityContext);
  if (!context) {
    throw new Error('useSecurity must be used within a SecurityProvider');
  }
  return context;
};
