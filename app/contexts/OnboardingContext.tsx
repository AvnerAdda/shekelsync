import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface OnboardingStatus {
  isComplete: boolean;
  completedSteps: {
    profile: boolean;
    accounts: boolean;
    firstScrape: boolean;
    explored: boolean;
  };
  stats: {
    accountCount: number;
    transactionCount: number;
    lastScrapeDate: string | null;
    hasProfile: boolean;
  };
  suggestedAction: 'profile' | 'accounts' | 'scrape' | 'explore' | null;
}

interface OnboardingContextType {
  status: OnboardingStatus | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  dismissOnboarding: () => Promise<void>;
  markStepComplete: (step: keyof OnboardingStatus['completedSteps']) => void;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/onboarding/status');
      if (!response.ok) {
        throw new Error('Failed to fetch onboarding status');
      }

      const data = await response.json();
      setStatus(data);
    } catch (err) {
      console.error('Error fetching onboarding status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const dismissOnboarding = useCallback(async () => {
    try {
      const response = await fetch('/api/onboarding/dismiss', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
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
      } else if (!updatedSteps.accounts) {
        suggestedAction = 'accounts';
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

  const value: OnboardingContextType = {
    status,
    loading,
    error,
    refetch: fetchStatus,
    dismissOnboarding,
    markStepComplete
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

export default OnboardingContext;
