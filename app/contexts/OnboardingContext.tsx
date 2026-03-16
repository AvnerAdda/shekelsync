import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/lib/api-client';

interface OnboardingStatus {
  isComplete: boolean;
  completedSteps: {
    profile: boolean;
    bankAccount: boolean;
    creditCard: boolean;
    firstScrape: boolean;
    explored: boolean;
  };
  stats: {
    accountCount: number;
    bankAccountCount: number;
    creditCardCount: number;
    transactionCount: number;
    lastScrapeDate: string | null;
    hasProfile: boolean;
  };
  suggestedAction: 'profile' | 'bankAccount' | 'creditCard' | 'scrape' | 'explore' | null;
}

interface PageAccessStatus {
  isLocked: boolean;
  requiredStep: string;
  reason: string;
}

interface OnboardingContextType {
  status: OnboardingStatus | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  dismissOnboarding: () => Promise<void>;
  markStepComplete: (step: keyof OnboardingStatus['completedSteps']) => void;
  getPageAccessStatus: (page: string) => PageAccessStatus;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);
const INITIAL_RETRY_DELAYS_MS = [500, 1000, 2000];

const createDefaultStatus = (): OnboardingStatus => ({
  isComplete: false,
  completedSteps: {
    profile: false,
    bankAccount: false,
    creditCard: false,
    firstScrape: false,
    explored: false,
  },
  stats: {
    accountCount: 0,
    bankAccountCount: 0,
    creditCardCount: 0,
    transactionCount: 0,
    lastScrapeDate: null,
    hasProfile: false,
  },
  suggestedAction: 'profile',
});

const normalizeStatus = (raw: any): OnboardingStatus => {
  if (raw && typeof raw === 'object' && raw.completedSteps) {
    return {
      isComplete: Boolean(raw.isComplete),
      completedSteps: {
        profile: Boolean(raw.completedSteps.profile),
        bankAccount: Boolean(raw.completedSteps.bankAccount),
        creditCard: Boolean(raw.completedSteps.creditCard),
        firstScrape: Boolean(raw.completedSteps.firstScrape),
        explored: Boolean(raw.completedSteps.explored),
      },
      stats: {
        accountCount: Number(raw.stats?.accountCount ?? 0),
        bankAccountCount: Number(raw.stats?.bankAccountCount ?? 0),
        creditCardCount: Number(raw.stats?.creditCardCount ?? 0),
        transactionCount: Number(raw.stats?.transactionCount ?? 0),
        lastScrapeDate: raw.stats?.lastScrapeDate ?? null,
        hasProfile: Boolean(raw.stats?.hasProfile),
      },
      suggestedAction: raw.suggestedAction ?? 'profile',
    };
  }

  if (raw && typeof raw === 'object' && raw.data) {
    return normalizeStatus(raw.data);
  }

  return createDefaultStatus();
};

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const activeRequestRef = useRef(0);
  const retryTimeoutsRef = useRef<Set<number>>(new Set());

  const clearRetryTimeouts = useCallback(() => {
    retryTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    retryTimeoutsRef.current.clear();
  }, []);

  const fetchStatus = useCallback(async (retryDelays: number[] = [], attempt = 0, requestId?: number) => {
    const nextRequestId = requestId ?? activeRequestRef.current + 1;

    if (attempt === 0) {
      activeRequestRef.current = nextRequestId;
      clearRetryTimeouts();
      setLoading(true);
      setError(null);
    }

    try {
      const response = await apiClient.get('/api/onboarding/status');
      if (!isMountedRef.current || activeRequestRef.current !== nextRequestId) {
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch onboarding status');
      }

      const data = response.data as any;
      setStatus(normalizeStatus(data));
      setError(null);
    } catch (err) {
      if (!isMountedRef.current || activeRequestRef.current !== nextRequestId) {
        return;
      }

      console.error('Error fetching onboarding status:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);

      const nextDelay = retryDelays[attempt];
      if (typeof nextDelay === 'number') {
        const timeoutId = window.setTimeout(() => {
          retryTimeoutsRef.current.delete(timeoutId);
          void fetchStatus(retryDelays, attempt + 1, nextRequestId);
        }, nextDelay);
        retryTimeoutsRef.current.add(timeoutId);
        return;
      }
    } finally {
      if (isMountedRef.current && activeRequestRef.current === nextRequestId) {
        const hasPendingRetry = retryTimeoutsRef.current.size > 0;
        if (!hasPendingRetry) {
          setLoading(false);
        }
      }
    }
  }, [clearRetryTimeouts]);

  const dismissOnboarding = useCallback(async () => {
    try {
      const response = await apiClient.post('/api/onboarding/dismiss', {
        payload: {},
      });

      if (!response.ok) {
        throw new Error('Failed to dismiss onboarding');
      }

      // Refetch status after dismissing
      await fetchStatus();
    } catch (err) {
      console.error('Error dismissing onboarding:', err);
      throw err;
    }
  }, [fetchStatus]);

  const markStepComplete = useCallback((step: keyof OnboardingStatus['completedSteps']) => {
    // Optimistically update the local state
    setStatus(prev => {
      if (!prev) return prev;

      const updatedSteps = { ...prev.completedSteps, [step]: true };
      const isComplete = Object.values(updatedSteps).every(s => s === true);

      // Determine next suggested action
      let suggestedAction: OnboardingStatus['suggestedAction'] = null;
      if (!updatedSteps.profile) {
        suggestedAction = 'profile';
      } else if (!updatedSteps.bankAccount) {
        suggestedAction = 'bankAccount';
      } else if (!updatedSteps.creditCard) {
        suggestedAction = 'creditCard';
      } else if (!updatedSteps.firstScrape) {
        suggestedAction = 'scrape';
      } else if (!updatedSteps.explored) {
        suggestedAction = 'explore';
      }

      return {
        ...prev,
        isComplete,
        completedSteps: updatedSteps,
        suggestedAction
      };
    });

    // Refetch from server to get accurate data
    void fetchStatus();
  }, [fetchStatus]);

  // Fetch status on mount
  useEffect(() => {
    isMountedRef.current = true;
    void fetchStatus(INITIAL_RETRY_DELAYS_MS);

    return () => {
      isMountedRef.current = false;
      activeRequestRef.current += 1;
      clearRetryTimeouts();
    };
  }, [clearRetryTimeouts, fetchStatus]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchStatus();
      }
    };

    const handleDataRefresh = () => {
      void fetchStatus();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('dataRefresh', handleDataRefresh);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('dataRefresh', handleDataRefresh);
    };
  }, [fetchStatus]);

  const getPageAccessStatus = useCallback((page: string): PageAccessStatus => {
    // Settings is always accessible
    if (page === 'settings') {
      return {
        isLocked: false,
        requiredStep: '',
        reason: ''
      };
    }

    // Home is always accessible
    if (page === 'home') {
      return {
        isLocked: false,
        requiredStep: '',
        reason: ''
      };
    }

    // Unknown onboarding status is treated as unresolved, not locked.
    if (!status) {
      return {
        isLocked: false,
        requiredStep: '',
        reason: ''
      };
    }

    // Analysis, Investments, and Budgets require first scrape
    if (['analysis', 'investments', 'budgets'].includes(page)) {
      if (!status.completedSteps.firstScrape) {
        return {
          isLocked: true,
          requiredStep: 'firstScrape',
          reason: 'Complete your first transaction scrape to unlock this page'
        };
      }
    }

    // Page is unlocked
    return {
      isLocked: false,
      requiredStep: '',
      reason: ''
    };
  }, [status]);

  const value: OnboardingContextType = {
    status,
    loading,
    error,
    refetch: fetchStatus,
    dismissOnboarding,
    markStepComplete,
    getPageAccessStatus
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = (): OnboardingContextType => {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
};

export type { PageAccessStatus };
export default OnboardingContext;
