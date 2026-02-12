import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const requireModule = createRequire(import.meta.url);
const dbQuery = vi.fn();
const dbRelease = vi.fn();

describe('unified category analytics', () => {
  beforeEach(() => {
    vi.resetModules();
    dbQuery.mockReset();
    dbRelease.mockReset();
    process.env.BETTER_SQLITE3_STUB = 'true';
  });

  function setupService() {
    const module = requireModule('../analytics/unified-category.js');
    module.__setDatabase({
      getClient: vi.fn(async () => ({ query: dbQuery, release: dbRelease })),
    });
    return module;
  }

  it('returns summaries and records metrics', async () => {
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

    const module = setupService();

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

  it('rejects invalid type and groupBy values before opening a database client', async () => {
    const module = setupService();

    await expect(
      module.getUnifiedCategoryAnalytics({ type: 'bad-type' }),
    ).rejects.toMatchObject({ error: { code: 'INVALID_TYPE' } });

    await expect(
      module.getUnifiedCategoryAnalytics({ type: 'expense', groupBy: 'bad-group' }),
    ).rejects.toMatchObject({ error: { code: 'INVALID_GROUP_BY' } });

    expect(dbQuery).not.toHaveBeenCalled();
    expect(dbRelease).not.toHaveBeenCalled();
  });

  it('validates numeric category filters and releases client on validation errors', async () => {
    const module = setupService();

    await expect(
      module.getUnifiedCategoryAnalytics({
        type: 'expense',
        groupBy: 'vendor',
        subcategoryId: 'abc',
      }),
    ).rejects.toMatchObject({ error: { code: 'INVALID_CATEGORY' } });

    await expect(
      module.getUnifiedCategoryAnalytics({
        type: 'expense',
        groupBy: 'vendor',
        parentId: 'xyz',
      }),
    ).rejects.toMatchObject({ error: { code: 'INVALID_CATEGORY' } });

    expect(dbQuery).not.toHaveBeenCalled();
    expect(dbRelease).toHaveBeenCalledTimes(2);
  });

  it('uses explicit category hierarchy ids when category name resolves to ids', async () => {
    const module = setupService();

    dbQuery
      .mockResolvedValueOnce({ rows: [{ id: '11' }, { id: 12 }, { id: 'bad' }] })
      .mockResolvedValueOnce({
        rows: [{ count: '1', total: '70', average: '70', min_amount: '70', max_amount: '70' }],
      })
      .mockResolvedValueOnce({
        rows: [{ category: 'Investments', subcategory: 'Stocks', total: '70', count: '1' }],
      });

    const result = await module.getUnifiedCategoryAnalytics({
      type: 'investment',
      groupBy: 'category',
      category: 'Investments',
    });

    expect(dbQuery).toHaveBeenCalledTimes(3);
    expect(String(dbQuery.mock.calls[0][0])).toContain('WITH matched AS');
    expect(String(dbQuery.mock.calls[1][0])).toContain('id = ANY($1::int[])');
    expect(result.data.breakdown[0]).toMatchObject({
      category: 'Investments',
      count: 1,
      total: 70,
    });
    expect(dbRelease).toHaveBeenCalledTimes(1);
  });

  it('falls back to recursive category-name matching when explicit ids are not found', async () => {
    const module = setupService();

    dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ count: '1', total: '30', average: '30', min_amount: '30', max_amount: '30' }],
      })
      .mockResolvedValueOnce({
        rows: [{ category: 'Other', subcategory: null, total: '30', count: '1' }],
      });

    await module.getUnifiedCategoryAnalytics({
      type: 'expense',
      groupBy: 'category',
      category: 'No Match',
    });

    expect(String(dbQuery.mock.calls[1][0])).toContain('LOWER(name) = LOWER($1) OR LOWER(name_en) = LOWER($1)');
    expect(dbRelease).toHaveBeenCalledTimes(1);
  });

  it('supports parent/subcategory filters and month grouping', async () => {
    const module = setupService();

    dbQuery
      .mockResolvedValueOnce({
        rows: [{ count: '2', total: '200', average: '100', min_amount: '80', max_amount: '120' }],
      })
      .mockResolvedValueOnce({
        rows: [{ month: '2026-01', month_name: '2026-01', total: '200', count: '2' }],
      });

    const monthResult = await module.getUnifiedCategoryAnalytics({
      type: 'income',
      groupBy: 'month',
      subcategoryId: '42',
    });

    const subcategorySummaryCall = dbQuery.mock.calls.find(([sql]) =>
      String(sql).includes('COUNT(*) as count'),
    );
    const subcategoryBreakdownCall = dbQuery.mock.calls.find(([sql]) =>
      String(sql).includes('GROUP BY'),
    );
    expect(String(subcategoryBreakdownCall?.[0])).toContain("TO_CHAR(t.date, 'YYYY-MM')");
    expect(subcategorySummaryCall?.[1]?.[0]).toBe(42);
    expect(monthResult.data.breakdown[0].month).toBe('2026-01');

    dbQuery.mockReset();
    dbRelease.mockReset();

    dbQuery
      .mockResolvedValueOnce({
        rows: [{ count: '1', total: '50', average: '50', min_amount: '50', max_amount: '50' }],
      })
      .mockResolvedValueOnce({
        rows: [{ vendor: 'Acme', total: '50', count: '1' }],
      });

    await module.getUnifiedCategoryAnalytics({
      type: 'expense',
      groupBy: 'vendor',
      parentId: '7',
    });

    expect(dbQuery.mock.calls[0][1][0]).toBe(7);
    expect(String(dbQuery.mock.calls[0][0])).toContain('parent_id = $1');
  });

  it('includes sampled transactions and institution mapping for card grouping', async () => {
    const module = setupService();

    dbQuery
      .mockResolvedValueOnce({
        rows: [{ count: '1', total: '120', average: '120', min_amount: '120', max_amount: '120' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            account_number: '1234',
            vendor: 'leumi',
            institution_id: 9,
            institution_name_he: 'לאומי',
            institution_name_en: 'Leumi',
            institution_logo: 'leumi.png',
            institution_type: 'bank',
            total: '120',
            count: '1',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            date: '2026-01-12',
            name: 'Charge',
            price: '-120',
            vendor: 'leumi',
            account_number: '1234',
            category_definition_id: 6,
            category_name: 'Banking',
            parent_name: 'Finance',
            institution_id: 9,
            institution_name_he: 'לאומי',
            institution_name_en: 'Leumi',
            institution_logo: 'leumi.png',
            institution_type: 'bank',
          },
        ],
      });

    const result = await module.getUnifiedCategoryAnalytics({
      type: 'expense',
      groupBy: 'card',
      includeTransactions: 'true',
    });

    expect(dbQuery).toHaveBeenCalledTimes(3);
    expect(result.data.breakdown[0].institution).toMatchObject({
      id: 9,
      display_name_en: 'Leumi',
    });
    expect(result.data.breakdown[0]).not.toHaveProperty('institution_id');
    expect(result.data.transactions[0].institution).toMatchObject({
      id: 9,
      display_name_en: 'Leumi',
    });
  });

  it('rethrows standardized errors and wraps raw database errors', async () => {
    const module = setupService();
    const standardizedError = { success: false, error: { code: 'SAMPLE' } };

    dbQuery.mockRejectedValueOnce(standardizedError);
    await expect(
      module.getUnifiedCategoryAnalytics({ type: 'expense', groupBy: 'vendor' }),
    ).rejects.toBe(standardizedError);
    expect(dbRelease).toHaveBeenCalledTimes(1);

    dbQuery.mockReset();
    dbRelease.mockReset();
    dbQuery.mockRejectedValueOnce(new Error('db exploded'));

    await expect(
      module.getUnifiedCategoryAnalytics({ type: 'expense', groupBy: 'vendor' }),
    ).rejects.toMatchObject({
      error: {
        code: 'DATABASE_ERROR',
        details: { message: 'db exploded' },
      },
    });
    expect(dbRelease).toHaveBeenCalledTimes(1);
  });
});
