import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react';
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
  const { telemetryEnabled, setTelemetryEnabled, loading } = useTelemetry();
  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => setTelemetryEnabled(!telemetryEnabled)}
    >
      {telemetryEnabled ? 'enabled' : 'disabled'}
    </button>
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

  it('updates preference via electron settings bridge when toggled', async () => {
    render(
      <TelemetryProvider>
        <TestConsumer />
      </TelemetryProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('enabled'));

    const button = screen.getByRole('button');
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(window.electronAPI?.settings?.update).toHaveBeenCalledWith({
        telemetry: { crashReportsEnabled: false },
      });
    });

    expect(syncRendererTelemetry).toHaveBeenLastCalledWith(false, expect.objectContaining({ dsn: expect.any(String) }));
  });
});
