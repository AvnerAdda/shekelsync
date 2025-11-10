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
  const [loading, setLoading] = useState(bridgeAvailable);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<TelemetryConfig | null>(null);

  useEffect(() => {
    if (!bridgeAvailable) {
      setLoading(false);
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
          setLoading(false);
        }
      }
    })();

    window.electronAPI?.telemetry?.getConfig?.().then((cfg) => {
      if (!cancelled && cfg) {
        setConfig(cfg);
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
    if (!config) {
      return;
    }
    syncRendererTelemetry(telemetryEnabled && Boolean(config.dsn), config).catch((syncError) => {
      console.error('[Telemetry] Failed to sync renderer telemetry', syncError);
    });
  }, [telemetryEnabled, config]);

  const handleTelemetryChange = useCallback(
    async (next: boolean) => {
      if (!bridgeAvailable) {
        setTelemetryEnabled(next);
        return;
      }

      setLoading(true);
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
        setLoading(false);
      }
    },
    [bridgeAvailable],
  );

  const value = useMemo<TelemetryContextValue>(
    () => ({
      telemetryEnabled,
      loading,
      supported: bridgeAvailable,
      error,
      setTelemetryEnabled: handleTelemetryChange,
    }),
    [telemetryEnabled, loading, error, handleTelemetryChange, bridgeAvailable],
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
