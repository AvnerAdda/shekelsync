import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const requireModule = createRequire(import.meta.url);
const dbQuery = vi.fn();
const dbRelease = vi.fn();
const recordUnifiedCategoryMetric = vi.fn();

describe('unified category analytics', () => {
  beforeEach(() => {
    vi.resetModules();
    dbQuery.mockReset();
    dbRelease.mockReset();
    process.env.BETTER_SQLITE3_STUB = 'true';
  });

  it('returns summaries and records metrics', async () => {
    const mockClient = { query: dbQuery, release: dbRelease };
    dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            count: '2',
            total: '100',
            average: '50',
            min_amount: '40',
            max_amount: '60',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { vendor: 'Acme', total: '60', count: '1' },
          { vendor: 'Globex', total: '40', count: '1' },
        ],
      });

    const metricsStore = requireModule('../analytics/metrics-store.js');
    metricsStore.resetMetrics();

    const module = requireModule('../analytics/unified-category.js');
    module.__setDatabase({
      getClient: vi.fn(async () => mockClient),
    });

    const result = await module.getUnifiedCategoryAnalytics({
      type: 'expense',
      groupBy: 'vendor',
      months: 3,
      includeTransactions: 'false',
    });

    expect(dbQuery).toHaveBeenCalledTimes(2);
    expect(result.data.summary.total).toBe(100);
    expect(result.data.summary.count).toBe(2);
    expect(result.data.breakdown.length).toBe(2);
    expect(metricsStore.getMetricsSnapshot().unifiedCategory.length).toBe(1);
    expect(dbRelease).toHaveBeenCalledTimes(1);

    module.__resetDatabase();
  });
});
