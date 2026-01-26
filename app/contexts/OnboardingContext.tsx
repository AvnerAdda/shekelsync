import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

interface OnboardingStatus {
  isComplete: boolean;
  completedSteps: {
    registration: boolean;
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
  suggestedAction: 'registration' | 'profile' | 'bankAccount' | 'creditCard' | 'scrape' | 'explore' | null;
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

const createDefaultStatus = (): OnboardingStatus => ({
  isComplete: false,
  completedSteps: {
    registration: false,
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
  suggestedAction: 'registration',
});

const normalizeStatus = (raw: any): OnboardingStatus => {
  if (raw && typeof raw === 'object' && raw.completedSteps) {
    return {
      isComplete: Boolean(raw.isComplete),
      completedSteps: {
        registration: Boolean(raw.completedSteps.registration),
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
      suggestedAction: raw.suggestedAction ?? 'registration',
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

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.get('/api/onboarding/status');
      if (!response.ok) {
        throw new Error('Failed to fetch onboarding status');
      }

      const data = response.data as any;
      setStatus(normalizeStatus(data));
    } catch (err) {
      console.error('Error fetching onboarding status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

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
      if (!updatedSteps.registration) {
        suggestedAction = 'registration';
      } else if (!updatedSteps.profile) {
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
    fetchStatus();
  }, [fetchStatus]);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
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

    // If no status yet, lock everything except settings/home
    if (!status) {
      return {
        isLocked: true,
        requiredStep: 'firstScrape',
        reason: 'Complete your first transaction scrape to unlock this page'
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
