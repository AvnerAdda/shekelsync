import React from 'react';
import { render, fireEvent, waitFor, screen, act, renderHook } from '@testing-library/react';
import { TelemetryProvider, useTelemetry } from '../TelemetryContext';
import { syncRendererTelemetry } from '@/lib/renderer-telemetry';

vi.mock('@/lib/renderer-telemetry', () => ({
  syncRendererTelemetry: vi.fn().mockResolvedValue(undefined),
}));

function createTestWindowApi() {
  const get = vi.fn().mockResolvedValue({
    settings: { telemetry: { crashReportsEnabled: true } },
  });
  const update = vi.fn().mockResolvedValue({
    success: true,
    settings: { telemetry: { crashReportsEnabled: false } },
  });
  const onChange = vi.fn().mockImplementation(() => vi.fn());
  const getConfig = vi.fn().mockResolvedValue({
    dsn: 'https://example.ingest.sentry.io/123456',
    environment: 'test',
    release: '1.0.0-test',
    debug: false,
  });

  return {
    settings: { get, update, onChange },
    telemetry: { getConfig },
  };
}

const TestConsumer: React.FC = () => {
  const { telemetryEnabled, setTelemetryEnabled, loading, supported, error } = useTelemetry();
  return (
    <div>
      <button
        data-testid="toggle"
        type="button"
        disabled={loading}
        onClick={() => setTelemetryEnabled(!telemetryEnabled)}
      >
        {telemetryEnabled ? 'enabled' : 'disabled'}
      </button>
      <span data-testid="supported">{supported ? 'yes' : 'no'}</span>
      <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
      <span data-testid="error">{error ?? ''}</span>
    </div>
  );
};

describe('TelemetryContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const api = createTestWindowApi();
    (window as unknown as { electronAPI: unknown }).electronAPI = api as typeof window.electronAPI;
  });

  afterEach(() => {
    // @ts-expect-error - cleanup test double
    delete window.electronAPI;
  });

  it('initialises state from persisted settings and syncs renderer telemetry', async () => {
    render(
      <TelemetryProvider>
        <TestConsumer />
      </TelemetryProvider>,
    );

    await waitFor(() => expect(window.electronAPI?.settings?.get).toHaveBeenCalled());
    await waitFor(() =>
      expect(syncRendererTelemetry).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ dsn: expect.any(String) }),
      ),
    );
  });

  it(
    'updates preference via electron settings bridge when toggled',
    async () => {
      const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <TelemetryProvider>{children}</TelemetryProvider>
      );

      const hook = renderHook(() => useTelemetry(), { wrapper });

      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      expect(hook.result.current.telemetryEnabled).toBe(true);

      await act(async () => {
        await hook.result.current.setTelemetryEnabled(false);
      });

      expect(window.electronAPI?.settings?.update).toHaveBeenCalledWith({
        telemetry: { crashReportsEnabled: false },
      });
      expect(hook.result.current.telemetryEnabled).toBe(false);
      expect(syncRendererTelemetry).toHaveBeenLastCalledWith(
        false,
        expect.objectContaining({ dsn: expect.any(String) }),
      );
    },
    10000,
  );

  it('surfaces load error when settings bridge throws', async () => {
    const api = createTestWindowApi();
    api.settings.get = vi.fn().mockRejectedValue(new Error('load-fail'));
    (window as any).electronAPI = api;

    render(
      <TelemetryProvider>
        <TestConsumer />
      </TelemetryProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('error').textContent).toContain('load-fail'));
  });

  it('throws when useTelemetry is called outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTelemetry())).toThrow(
      'useTelemetry must be used within a TelemetryProvider',
    );
    consoleError.mockRestore();
  });

  it('marks unsupported when electron bridge is missing and toggles locally', async () => {
    // Remove electron bridge
    // @ts-expect-error override for test
    window.electronAPI = undefined;

    render(
      <TelemetryProvider>
        <TestConsumer />
      </TelemetryProvider>,
    );

    expect(screen.getByTestId('supported').textContent).toBe('no');
    expect(screen.getByTestId('loading').textContent).toBe('no');
    expect(screen.getByRole('button')).toHaveTextContent('disabled');

    fireEvent.click(screen.getByTestId('toggle'));
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('enabled'));
  });

  it('surfaces update errors from the settings bridge', async () => {
    const api = createTestWindowApi();
    api.settings.update = vi.fn().mockResolvedValue({
      success: false,
      error: 'Failed to persist',
      settings: { telemetry: { crashReportsEnabled: true } },
    });
    (window as any).electronAPI = api;

    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <TelemetryProvider>{children}</TelemetryProvider>
    );

    const hook = renderHook(() => useTelemetry(), { wrapper });

    await act(async () => {
      await expect(hook.result.current.setTelemetryEnabled(false)).rejects.toThrow('Failed to persist');
    });

    expect(api.settings.update).toHaveBeenCalled();
    expect(hook.result.current.error).toBe('Failed to persist');
  });
});
