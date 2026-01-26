import { useState, useEffect, useCallback } from 'react';

interface LicenseStatus {
  registered: boolean;
  licenseType: 'trial' | 'pro' | 'expired' | 'none';
  trialDaysRemaining?: number;
  isReadOnly: boolean;
  canWrite: boolean;
  offlineMode: boolean;
  offlineGraceDaysRemaining?: number | null;
  syncedToCloud: boolean;
  lastValidated?: string;
  teudatZehut?: string;
  error?: string;
}

interface TeudatZehutValidation {
  valid: boolean;
  error?: string;
}

interface UseLicenseReturn {
  status: LicenseStatus | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  register: (teudatZehut: string) => Promise<{ success: boolean; error?: string }>;
  validateTeudatZehut: (id: string) => Promise<TeudatZehutValidation>;
  activatePro: (paymentRef?: string) => Promise<{ success: boolean; error?: string }>;
  validateOnline: () => Promise<{ success: boolean; error?: string }>;
  isRegistered: boolean;
  canWrite: boolean;
  isReadOnly: boolean;
  isTrialExpiringSoon: boolean;
  requiresRegistration: boolean;
}

// Check if we're running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI;

const DEFAULT_STATUS: LicenseStatus = {
  registered: false,
  licenseType: 'none',
  isReadOnly: true,
  canWrite: false,
  offlineMode: false,
  syncedToCloud: false,
};

/**
 * Hook for managing license state in the renderer process.
 * Communicates with the Electron main process via IPC.
 */
export function useLicense(): UseLicenseReturn {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!isElectron) {
      // Not running in Electron - allow all operations
      setStatus({
        registered: true,
        licenseType: 'pro',
        isReadOnly: false,
        canWrite: true,
        offlineMode: false,
        syncedToCloud: true,
      });
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const result = await window.electronAPI.license.getStatus();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get license status');
      }

      setStatus(result.data as LicenseStatus);
    } catch (err) {
      console.error('[useLicense] Error fetching status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      // Default to allowing writes on error (fail-open)
      setStatus({
        ...DEFAULT_STATUS,
        canWrite: true,
        isReadOnly: false,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (teudatZehut: string) => {
    if (!isElectron) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await window.electronAPI.license.register(teudatZehut);

      if (result.success) {
        await fetchStatus();
      }

      return result;
    } catch (err) {
      console.error('[useLicense] Registration error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Registration failed',
      };
    }
  }, [fetchStatus]);

  const validateTeudatZehut = useCallback(async (id: string): Promise<TeudatZehutValidation> => {
    if (!isElectron) {
      // Basic validation without Electron
      const cleanId = id.replace(/[\s-]/g, '');
      if (!/^\d{9}$/.test(cleanId)) {
        return { valid: false, error: 'ID must be exactly 9 digits' };
      }
      // Perform check digit validation
      let sum = 0;
      for (let i = 0; i < 9; i++) {
        let digit = parseInt(cleanId[i], 10);
        let product = digit * ((i % 2) + 1);
        if (product > 9) product -= 9;
        sum += product;
      }
      if (sum % 10 !== 0) {
        return { valid: false, error: 'Invalid ID check digit' };
      }
      return { valid: true };
    }

    try {
      const result = await window.electronAPI.license.validateTeudatZehut(id);

      if (!result.success) {
        return { valid: false, error: result.error };
      }

      return result.data as TeudatZehutValidation;
    } catch (err) {
      console.error('[useLicense] Validation error:', err);
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Validation failed',
      };
    }
  }, []);

  const activatePro = useCallback(async (paymentRef?: string) => {
    if (!isElectron) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await window.electronAPI.license.activatePro(paymentRef);

      if (result.success) {
        await fetchStatus();
      }

      return result;
    } catch (err) {
      console.error('[useLicense] Activation error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Activation failed',
      };
    }
  }, [fetchStatus]);

  const validateOnline = useCallback(async () => {
    if (!isElectron) {
      return { success: false, error: 'Not running in Electron' };
    }

    try {
      const result = await window.electronAPI.license.validateOnline();

      if (result.success) {
        await fetchStatus();
      }

      return result;
    } catch (err) {
      console.error('[useLicense] Online validation error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Online validation failed',
      };
    }
  }, [fetchStatus]);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Periodically validate online (every 30 minutes)
  useEffect(() => {
    if (!isElectron) return;

    const interval = setInterval(() => {
      validateOnline().catch(console.error);
    }, 30 * 60 * 1000);

    return () => clearInterval(interval);
  }, [validateOnline]);

  // Derived states
  const isRegistered = status?.registered ?? false;
  const canWrite = status?.canWrite ?? true;
  const isReadOnly = status?.isReadOnly ?? false;
  const isTrialExpiringSoon = (status?.trialDaysRemaining ?? Infinity) <= 7;
  const requiresRegistration = !status?.registered && status?.licenseType === 'none';

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
    register,
    validateTeudatZehut,
    activatePro,
    validateOnline,
    isRegistered,
    canWrite,
    isReadOnly,
    isTrialExpiringSoon,
    requiresRegistration,
  };
}

export type { LicenseStatus, TeudatZehutValidation, UseLicenseReturn };
export default useLicense;
