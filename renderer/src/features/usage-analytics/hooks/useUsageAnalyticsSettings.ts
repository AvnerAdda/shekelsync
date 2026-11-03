import { useCallback, useEffect, useState } from 'react';

type UsageAnalyticsState = {
  enabled: boolean;
  decidedAt: string | null;
};

type ElectronBridge = {
  settings?: {
    get?: () => Promise<{ success: boolean; settings?: { usageAnalytics?: Partial<UsageAnalyticsState> } }>;
    update?: (patch: Record<string, unknown>) => Promise<{
      success: boolean;
      settings?: { usageAnalytics?: Partial<UsageAnalyticsState> };
      error?: string;
    }>;
    onChange?: (callback: (settings: { usageAnalytics?: Partial<UsageAnalyticsState> }) => void) => (() => void) | void;
  };
  analytics?: {
    getStatus?: () => Promise<{ success: boolean; status?: { available: boolean; enabled: boolean } }>;
  };
};

const getBridge = (): ElectronBridge | undefined =>
  (typeof window === 'undefined' ? undefined : (window.electronAPI as unknown as ElectronBridge | undefined));

const normalize = (raw?: Partial<UsageAnalyticsState>): UsageAnalyticsState => ({
  enabled: raw?.enabled === true,
  decidedAt: typeof raw?.decidedAt === 'string' && raw.decidedAt ? raw.decidedAt : null,
});

export interface UseUsageAnalyticsSettingsResult {
  loading: boolean;
  /** False when this build has no Aptabase key or runs in development. */
  available: boolean;
  enabled: boolean;
  decided: boolean;
  saving: boolean;
  error: string | null;
  setEnabled: (enabled: boolean) => Promise<boolean>;
}

export function useUsageAnalyticsSettings(): UseUsageAnalyticsSettingsResult {
  const [state, setState] = useState<UsageAnalyticsState>({ enabled: false, decidedAt: null });
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    let active = true;

    const load = async () => {
      try {
        const [settingsResult, statusResult] = await Promise.all([
          bridge?.settings?.get?.(),
          bridge?.analytics?.getStatus?.(),
        ]);
        if (!active) return;
        if (settingsResult?.success) {
          setState(normalize(settingsResult.settings?.usageAnalytics));
        }
        setAvailable(Boolean(statusResult?.success && statusResult.status?.available));
      } catch {
        if (active) setAvailable(false);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const unsubscribe = bridge?.settings?.onChange?.((nextSettings) => {
      setState(normalize(nextSettings?.usageAnalytics));
    });

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const bridge = getBridge();
    if (!bridge?.settings?.update) return false;
    setSaving(true);
    setError(null);
    try {
      const result = await bridge.settings.update({
        usageAnalytics: { enabled, decidedAt: new Date().toISOString() },
      });
      if (!result?.success) {
        setError(result?.error || 'update_failed');
        return false;
      }
      setState(normalize(result.settings?.usageAnalytics));
      return true;
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'update_failed');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    loading,
    available,
    enabled: state.enabled,
    decided: state.decidedAt !== null,
    saving,
    error,
    setEnabled,
  };
}

export function trackScreenView(screen: string) {
  try {
    window.electronAPI?.analytics?.track?.('screen_viewed', { screen });
  } catch {
    // Analytics must never break navigation.
  }
}

const KNOWN_AREAS = new Set(['home', 'review', 'activity', 'plan', 'wealth', 'analysis', 'budgets', 'investments', 'settings']);

function currentRendererArea(): string {
  if (typeof window === 'undefined') return 'renderer';
  const segment = window.location.hash.replace(/^#\/?/, '').split(/[/?#]/)[0] || 'home';
  return KNOWN_AREAS.has(segment) ? segment : 'renderer';
}

/** Report only the error's type (e.g. TypeError) and the screen it happened on. */
export function trackRendererError(error: unknown) {
  try {
    const name = error instanceof Error ? error.name : 'NonError';
    const errorType = /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error';
    window.electronAPI?.analytics?.track?.('app_error', { area: currentRendererArea(), errorType });
  } catch {
    // Never throw from error reporting.
  }
}

let globalErrorReportingInstalled = false;

export function installRendererErrorReporting() {
  if (globalErrorReportingInstalled || typeof window === 'undefined') return;
  globalErrorReportingInstalled = true;
  window.addEventListener('error', (event) => trackRendererError(event.error));
  window.addEventListener('unhandledrejection', (event) => trackRendererError(event.reason));
}
