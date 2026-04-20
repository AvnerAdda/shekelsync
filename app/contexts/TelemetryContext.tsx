import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { syncRendererTelemetry } from '@/lib/renderer-telemetry';

interface TelemetryConfig {
  dsn: string | null;
  environment?: string;
  release?: string;
  debug?: boolean;
  enabled?: boolean;
}

interface TelemetryContextValue {
  telemetryEnabled: boolean;
  loading: boolean;
  supported: boolean;
  error: string | null;
  setTelemetryEnabled: (next: boolean) => Promise<void>;
}

const TelemetryContext = createContext<TelemetryContextValue | undefined>(undefined);

const hasElectronBridge = () =>
  typeof window !== 'undefined' && Boolean(window.electronAPI?.settings);

export const TelemetryProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const bridgeAvailable = hasElectronBridge();
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(bridgeAvailable);
  const [configLoading, setConfigLoading] = useState(bridgeAvailable);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<TelemetryConfig | null>(null);

  useEffect(() => {
    if (!bridgeAvailable) {
      setSettingsLoading(false);
      setConfigLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await window.electronAPI?.settings?.get?.();
        if (cancelled) {
          return;
        }
        const enabled = Boolean(response?.settings?.telemetry?.crashReportsEnabled);
        setTelemetryEnabled(enabled);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load telemetry settings');
        }
      } finally {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      }
    })();

    window.electronAPI?.telemetry?.getConfig?.()
      .then((cfg) => {
        if (cancelled || !cfg) {
          return;
        }

        setConfig({
          dsn: cfg.dsn ?? null,
          environment: cfg.environment,
          release: cfg.release,
          debug: cfg.debug,
          enabled: Boolean(cfg.enabled),
        });
      })
      .finally(() => {
        if (!cancelled) {
          setConfigLoading(false);
        }
      });

    const unsubscribe = window.electronAPI?.settings?.onChange?.((nextSettings) => {
      if (cancelled) {
        return;
      }
      setTelemetryEnabled(Boolean(nextSettings?.telemetry?.crashReportsEnabled));
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [bridgeAvailable]);

  useEffect(() => {
    if (!config?.enabled) {
      return;
    }
    syncRendererTelemetry(telemetryEnabled && Boolean(config.dsn), config).catch((syncError) => {
      console.error('[Telemetry] Failed to sync renderer telemetry', syncError);
    });
  }, [telemetryEnabled, config]);

  const handleTelemetryChange = useCallback(
    async (next: boolean) => {
      if (!bridgeAvailable || !config?.enabled) {
        setTelemetryEnabled(next);
        return;
      }

      setSettingsLoading(true);
      setError(null);
      try {
        const response = await window.electronAPI?.settings?.update?.({
          telemetry: { crashReportsEnabled: next },
        });
        if (!response?.success) {
          throw new Error(response?.error || 'Failed to update telemetry settings');
        }
        setTelemetryEnabled(Boolean(response.settings?.telemetry?.crashReportsEnabled));
      } catch (updateError) {
        const message = updateError instanceof Error ? updateError.message : 'Failed to update telemetry settings';
        setError(message);
        throw updateError;
      } finally {
        setSettingsLoading(false);
      }
    },
    [bridgeAvailable, config],
  );

  const loading = settingsLoading || configLoading;
  const supported = bridgeAvailable && Boolean(config?.enabled);

  const value = useMemo<TelemetryContextValue>(
    () => ({
      telemetryEnabled,
      loading,
      supported,
      error,
      setTelemetryEnabled: handleTelemetryChange,
    }),
    [telemetryEnabled, loading, supported, error, handleTelemetryChange],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
};

export function useTelemetry(): TelemetryContextValue {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
}
