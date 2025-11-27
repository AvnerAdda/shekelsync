import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

process.env.BETTER_SQLITE3_STUB = 'true';

const metricsStore = require('../analytics/metrics-store.js');
const queryMock = vi.fn();

vi.mock(new URL('../../../lib/create-db-pool.js', import.meta.url).pathname, () => ({
  __esModule: true,
  default: () => ({ query: queryMock }),
}));

vi.mock(new URL('../../../lib/sqlite-pool.js', import.meta.url).pathname, () => ({
  __esModule: true,
  default: () => ({ query: queryMock }),
}));

vi.mock('../../../lib/server/query-utils.js', () => ({
  resolveDateRange: () => ({
    start: new Date('2025-01-01T00:00:00.000Z'),
    end: new Date('2025-03-31T23:59:59.999Z'),
  }),
}));

describe('waterfall analytics metrics', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('records waterfall metrics with row counts', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          { vendor: 'Acme Payroll', category_name: 'Salary', category_name_en: 'Salary', total: 9000, count: 3 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { parent_category: 'Housing', parent_category_en: 'Housing', total: 4500, count: 5 },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { category_name: 'Investments', category_name_en: 'Investments', outflow: 1000, inflow: 100, count: 2 },
        ],
      });

    metricsStore.resetMetrics();

    const serviceModule = await import('../analytics/waterfall.js');
    serviceModule.__setDatabase?.({ query: queryMock });

    const result = await serviceModule.getWaterfallAnalytics({ months: 3 });

    expect(result.summary.totalIncome).toBe(9000);
    expect(result.summary.totalExpenses).toBe(4500);
    expect(result.summary.netInvestments).toBeCloseTo(900);

    const metrics = metricsStore.getMetricsSnapshot();
    expect(metrics.waterfall.length).toBe(1);
    expect(metrics.waterfall[0]).toMatchObject({
      months: 3,
      rowCounts: {
        income: 1,
        expenses: 1,
        investments: 1,
        waterfallPoints: expect.any(Number),
      },
    });
  });
});
