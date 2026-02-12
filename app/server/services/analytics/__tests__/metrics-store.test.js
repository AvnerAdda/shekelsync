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

  it('swallows reporter failures while still recording the metric', () => {
    metricsStore.setMetricReporter(() => {
      throw new Error('telemetry sink unavailable');
    });

    expect(() => {
      metricsStore.recordBreakdownMetric({ durationMs: 7, rowCounts: { current: 3 } });
    }).not.toThrow();

    const snapshot = metricsStore.getMetricsSnapshot();
    expect(snapshot.breakdown).toHaveLength(1);
    expect(snapshot.breakdown[0]).toMatchObject({
      durationMs: 7,
      rowCounts: { current: 3 },
    });
    expect(typeof snapshot.breakdown[0].recordedAt).toBe('string');
  });

  it('records all metric buckets and resetMetrics clears them', () => {
    metricsStore.recordBreakdownMetric({ durationMs: 1 });
    metricsStore.recordUnifiedCategoryMetric({ durationMs: 2, groupBy: 'category' });
    metricsStore.recordWaterfallMetric({ durationMs: 3, months: 6 });
    metricsStore.recordCategoryOpportunitiesMetric({ durationMs: 4, minTransactions: 8 });

    const beforeReset = metricsStore.getMetricsSnapshot();
    expect(beforeReset.breakdown).toHaveLength(1);
    expect(beforeReset.unifiedCategory).toHaveLength(1);
    expect(beforeReset.waterfall).toHaveLength(1);
    expect(beforeReset.categoryOpportunities).toHaveLength(1);

    metricsStore.resetMetrics();

    const afterReset = metricsStore.getMetricsSnapshot();
    expect(afterReset.breakdown).toHaveLength(0);
    expect(afterReset.dashboard).toHaveLength(0);
    expect(afterReset.unifiedCategory).toHaveLength(0);
    expect(afterReset.waterfall).toHaveLength(0);
    expect(afterReset.categoryOpportunities).toHaveLength(0);
  });

  it('returns empty sanitized payload for invalid or non-object samples', () => {
    expect(metricsStore.sanitizeMetricSample(null)).toEqual({});
    expect(metricsStore.sanitizeMetricSample('invalid')).toEqual({});

    const payload = metricsStore.sanitizeMetricSample({
      durationMs: 'not-a-number',
      months: null,
      dateRange: { start: 'invalid', end: '2025-03-01' },
      rowCounts: { history: 'x', current: undefined, valid: '4' },
    });

    expect(payload).toEqual({
      months: 0,
      rowCounts: {
        history: null,
        valid: 4,
      },
    });
  });
});
