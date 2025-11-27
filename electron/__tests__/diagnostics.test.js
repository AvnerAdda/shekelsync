import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMetricsSnapshotMock = vi.fn();
const sanitizeMetricSampleMock = vi.fn((sample) => ({
  durationMs: Number(sample.durationMs),
  months: Number(sample.months),
}));

describe('electron diagnostics', () => {
  let diagnostics;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    vi.doMock(
      'electron',
      () => ({
        shell: {
          openPath: vi.fn(async () => ''),
        },
      }),
      { virtual: true },
    );

    vi.doMock('../paths', () => ({
      resolveAppPath: (...segments) => segments.join('/'),
    }));

    diagnostics = await import('../diagnostics.js');
    diagnostics.__setLogger({
      getLogDirectory: vi.fn(() => '/tmp/logs'),
      getLogFilePath: vi.fn(() => '/tmp/logs/app.log'),
      readRecentLogs: vi.fn(async () => [{ name: 'main.log', tail: 'tail-content' }]),
    });
    diagnostics.__setAnalyticsMetricsStore({
      getMetricsSnapshot: getMetricsSnapshotMock,
      sanitizeMetricSample: sanitizeMetricSampleMock,
    });
  });

  it('sanitizes analytics metrics and telemetry details in diagnostics payload', async () => {
    getMetricsSnapshotMock.mockReturnValue({
      breakdown: [
        {
          durationMs: '12.5',
          months: '3',
          vendor: 'secret-bank',
          recordedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });

    const telemetry = {
      enabled: true,
      dsnHost: 'sentry.io',
      initialized: true,
      debug: false,
    };

    const payload = await diagnostics.buildDiagnosticsPayload({ appVersion: '1.2.3', telemetry });

    expect(payload.analyticsMetrics).toEqual({
      breakdown: [
        {
          durationMs: 12.5,
          months: 3,
          recordedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(payload.analyticsMetrics.breakdown[0].vendor).toBeUndefined();
    expect(payload.telemetrySummary).toEqual({
      status: 'opted-in',
      destination: 'sentry.io',
      initialized: true,
      debug: false,
    });
    expect(payload.logTail).toEqual([{ name: 'main.log', tail: 'tail-content' }]);
  });
});
