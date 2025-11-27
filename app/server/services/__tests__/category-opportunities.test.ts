import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('../database.js', () => ({
  query: queryMock,
}));

describe('category opportunities metrics', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('records metrics with durations and row counts', async () => {
    const sampleTransactions = [
      {
        category_definition_id: 1,
        category_name: 'Dining',
        parent_id: 10,
        parent_name: 'Food',
        date: '2025-01-01',
        amount: 120,
        merchant_name: 'Cafe XYZ',
        description: 'Lunch',
      },
      {
        category_definition_id: 1,
        category_name: 'Dining',
        parent_id: 10,
        parent_name: 'Food',
        date: '2025-01-05',
        amount: 80,
        merchant_name: 'Cafe XYZ',
        description: 'Dinner',
      },
      {
        category_definition_id: 2,
        category_name: 'Fuel',
        parent_id: 12,
        parent_name: 'Transport',
        date: '2025-01-03',
        amount: 200,
        merchant_name: 'QuickFuel',
        description: 'Fill up',
      },
    ];

    queryMock
      .mockResolvedValueOnce({ rows: sampleTransactions })
      .mockResolvedValueOnce({
        rows: [
          { category_definition_id: 1, actionability_level: 'high' },
          { category_definition_id: 2, actionability_level: 'medium' },
        ],
      });

    const metricsStoreModule = await import('../analytics/metrics-store.js');
    const resolvedMetricsStore =
      metricsStoreModule.default || metricsStoreModule;
    resolvedMetricsStore.resetMetrics();

    const serviceModule = await import('../analytics/category-opportunities.js');
    serviceModule.__setDatabase?.({ query: queryMock });
    serviceModule.__setMetricsStore?.(resolvedMetricsStore);

    const result = await serviceModule.getCategoryOpportunities({ months: 3, minTransactions: 2 });

    expect(result.opportunities.length).toBeGreaterThan(0);

    const metrics = resolvedMetricsStore.getMetricsSnapshot();
    expect(metrics.categoryOpportunities.length).toBe(1);
    expect(metrics.categoryOpportunities[0]).toMatchObject({
      months: 3,
      rowCounts: {
        transactions: sampleTransactions.length,
        opportunities: expect.any(Number),
      },
    });
  });
});
