import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as metricsStore from '../metrics-store.js';

describe('analytics metrics store', () => {
  beforeEach(() => {
    metricsStore.resetMetrics();
    metricsStore.setMetricReporter(null);
  });

  it('sanitizes samples before reporting to telemetry', () => {
    const reporter = vi.fn();
    metricsStore.setMetricReporter(reporter);

    metricsStore.recordDashboardMetric({
      durationMs: 12.5,
      months: 3,
      aggregation: 'monthly',
      groupBy: 'category',
      includeTransactions: true,
      minTransactions: '5',
      dateRange: {
        start: '2025-01-01',
        end: '2025-02-01',
        previousStart: '2024-11-01',
        previousEnd: '2024-12-01',
      },
      rowCounts: {
        history: '10',
        vendors: undefined,
        invalid: 'not-a-number',
      },
    });

    expect(reporter).toHaveBeenCalledTimes(1);
    const [bucket, payload] = reporter.mock.calls[0];
    expect(bucket).toBe('dashboard');
    expect(payload).toMatchObject({
      durationMs: 12.5,
      months: 3,
      aggregation: 'monthly',
      groupBy: 'category',
      includeTransactions: true,
      minTransactions: 5,
      dateRangeDays: 31,
      previousRangeDays: 30,
      rowCounts: {
        history: 10,
        invalid: null,
      },
    });
    expect(payload.rowCounts.vendors).toBeUndefined();
    expect(payload).not.toHaveProperty('dateRange');
  });

  it('does not invoke reporter when unset', () => {
    const reporter = vi.fn();
    metricsStore.recordBreakdownMetric({ durationMs: 5, rowCounts: { current: 1 } });
    expect(reporter).not.toHaveBeenCalled();
  });

  it('trims buckets to the maximum sample size', () => {
    metricsStore.setMetricReporter(null);
    for (let i = 0; i < 60; i += 1) {
      metricsStore.recordDashboardMetric({ durationMs: i });
    }
    const snapshot = metricsStore.getMetricsSnapshot();
    expect(snapshot.dashboard.length).toBeLessThanOrEqual(50);
    expect(snapshot.dashboard[snapshot.dashboard.length - 1]).toMatchObject({ durationMs: 59 });
  });
});
