import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
let analyticsModule: any;
const metricsStore = require('../analytics/metrics-store.js');

describe('breakdown analytics trends', () => {
  const queueEmptyAggregateResponses = () => {
    queryMock
      // previous categories
      .mockResolvedValueOnce({ rows: [] })
      // previous vendors
      .mockResolvedValueOnce({ rows: [] })
      // category totals
      .mockResolvedValueOnce({ rows: [] })
      // category history
      .mockResolvedValueOnce({ rows: [] })
      // vendor totals
      .mockResolvedValueOnce({ rows: [] })
      // vendor history
      .mockResolvedValueOnce({ rows: [] })
      // month totals
      .mockResolvedValueOnce({ rows: [] })
      // summary
      .mockResolvedValueOnce({ rows: [{ count: '0', total: '0', min: '0', max: '0' }] });
  };

  beforeAll(async () => {
    analyticsModule = await import('../analytics/breakdown.js');
  });

  beforeEach(() => {
    queryMock.mockReset();
    analyticsModule.__setDatabase?.({ query: queryMock });
    metricsStore.resetMetrics?.();
  });

  afterEach(() => {
    analyticsModule.__resetDatabase?.();
  });

  it('includes previous totals and history for categories and vendors', async () => {
    const { getBreakdownAnalytics } = await import('../analytics/breakdown.js');

    queryMock
      // previous categories
      .mockResolvedValueOnce({
        rows: [
          {
            parent_id: 1,
            parent_name: 'Dining',
            transaction_count: '3',
            total_amount: '300',
          },
        ],
      })
      // previous vendors
      .mockResolvedValueOnce({
        rows: [
          {
            vendor: 'Vendor X',
            transaction_count: '2',
            total_amount: '250',
          },
        ],
      })
      // category totals (current period)
      .mockResolvedValueOnce({
        rows: [
          {
            parent_id: 1,
            parent_name: 'Dining',
            parent_name_en: null,
            parent_name_fr: null,
            parent_color: '#111',
            parent_icon: 'restaurant',
            parent_description: 'Food & dining',
            subcategory_id: 11,
            subcategory_name: 'Meals',
            subcategory_name_en: null,
            subcategory_name_fr: null,
            subcategory_color: '#000',
            subcategory_icon: 'fastfood',
            subcategory_description: null,
            subcategory_parent_id: 1,
            depth_level: 2,
            transaction_count: '1',
            total_amount: '100',
            pending_count: 0,
            processed_count: 1,
          },
        ],
      })
      // category history
      .mockResolvedValueOnce({
        rows: [
          {
            parent_id: 1,
            parent_name: 'Dining',
            month: '2025-01',
            total_amount: '100',
          },
        ],
      })
      // vendor totals
      .mockResolvedValueOnce({
        rows: [
          {
            vendor: 'Vendor X',
            transaction_count: '1',
            total_amount: '100',
            institution_id: 5,
            institution_name_en: 'Bank A',
            institution_name_he: 'בנק א',
            institution_logo: null,
            institution_type: 'bank',
          },
        ],
      })
      // vendor history
      .mockResolvedValueOnce({
        rows: [
          {
            vendor: 'Vendor X',
            month: '2025-01',
            total_amount: '100',
          },
        ],
      })
      // month totals
      .mockResolvedValueOnce({
        rows: [
          {
            month: '2025-01',
            total_amount: '100',
          },
        ],
      })
      // summary
      .mockResolvedValueOnce({
        rows: [
          {
            count: '1',
            total: '100',
            min: '100',
            max: '100',
          },
        ],
      });

    const result = await getBreakdownAnalytics({
      type: 'expense',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });

    expect(queryMock).toHaveBeenCalledTimes(8);
    const category = result.breakdowns.byCategory[0];
    expect(category.previousTotal).toBe(300);
    expect(category.previousCount).toBe(3);
    expect(category.history).toEqual([{ month: '2025-01', total: 100 }]);

    const vendor = result.breakdowns.byVendor[0];
    expect(vendor.previousTotal).toBe(250);
    expect(vendor.previousCount).toBe(2);
    expect(vendor.history).toEqual([{ month: '2025-01', total: 100 }]);
  });

  it('defaults previous totals to zero when there is no prior-period data', async () => {
    const { getBreakdownAnalytics: breakdown } = analyticsModule;
    queryMock
      // previous categories
      .mockResolvedValueOnce({ rows: [] })
      // previous vendors
      .mockResolvedValueOnce({ rows: [] })
      // category totals
      .mockResolvedValueOnce({
        rows: [
          {
            parent_id: 2,
            parent_name: 'Food',
            parent_name_en: null,
            parent_name_fr: null,
            parent_color: '#333',
            parent_icon: 'fastfood',
            parent_description: 'Food & dining',
            subcategory_id: 22,
            subcategory_name: 'Snacks',
            subcategory_name_en: null,
            subcategory_name_fr: null,
            subcategory_color: '#123',
            subcategory_icon: 'cookie',
            subcategory_description: null,
            subcategory_parent_id: 2,
            depth_level: 2,
            transaction_count: '1',
            total_amount: '50',
            pending_count: 0,
            processed_count: 1,
          },
        ],
      })
      // category history
      .mockResolvedValueOnce({
        rows: [
          {
            parent_id: 2,
            parent_name: 'Food',
            month: '2025-02',
            total_amount: '50',
          },
        ],
      })
      // vendor totals
      .mockResolvedValueOnce({
        rows: [
          {
            vendor: 'Vendor Y',
            transaction_count: '1',
            total_amount: '50',
            institution_id: null,
            institution_name_en: null,
            institution_name_he: null,
            institution_logo: null,
            institution_type: null,
          },
        ],
      })
      // vendor history
      .mockResolvedValueOnce({
        rows: [
          {
            vendor: 'Vendor Y',
            month: '2025-02',
            total_amount: '50',
          },
        ],
      })
      // month totals
      .mockResolvedValueOnce({
        rows: [
          {
            month: '2025-02',
            total_amount: '50',
          },
        ],
      })
      // summary
      .mockResolvedValueOnce({
        rows: [
          {
            count: '1',
            total: '50',
            min: '50',
            max: '50',
          },
        ],
      });

    const result = await breakdown({
      type: 'expense',
      startDate: '2025-02-01',
      endDate: '2025-02-28',
    });

    expect(result.breakdowns.byCategory[0].previousTotal).toBe(0);
    expect(result.breakdowns.byVendor[0].previousTotal).toBe(0);
    expect(result.breakdowns.byVendor[0].history).toEqual([{ month: '2025-02', total: 50 }]);
  });

  it('returns empty breakdown arrays when no transactions exist', async () => {
    const { getBreakdownAnalytics: breakdown } = analyticsModule;
    queueEmptyAggregateResponses();

    const result = await breakdown({
      type: 'expense',
      startDate: '2025-03-01',
      endDate: '2025-03-31',
    });

    expect(result.breakdowns.byCategory).toEqual([]);
    expect(result.breakdowns.byVendor).toEqual([]);
    expect(result.transactions).toBeUndefined();
  });

  it('rejects unsupported type values', async () => {
    const { getBreakdownAnalytics: breakdown } = analyticsModule;
    await expect(breakdown({ type: 'foo' })).rejects.toMatchObject({ status: 400 });
  });

  it('builds includeTransactions breakdowns with dedupe, pending counts, and localization', async () => {
    const { getBreakdownAnalytics: breakdown } = analyticsModule;

    queryMock
      // previous categories
      .mockResolvedValueOnce({
        rows: [{ parent_id: 10, parent_name: 'Salary', transaction_count: '1', total_amount: '800' }],
      })
      // previous vendors
      .mockResolvedValueOnce({
        rows: [{ vendor: 'Unknown', transaction_count: '4', total_amount: '123' }],
      })
      // current transactions
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'Payroll',
            date: '2025-01-15T00:00:00.000Z',
            price: '1000',
            processed_date: '2025-01-16T00:00:00.000Z',
            transaction_name: 'Salary January',
            account_number: '1111',
            subcategory_id: 10,
            subcategory_name: 'Salary',
            subcategory_name_en: 'Salary EN',
            subcategory_name_fr: null,
            subcategory_color: '#111',
            subcategory_icon: 'attach_money',
            subcategory_description: 'Income',
            parent_id: 10,
            depth_level: 1,
            parent_name: 'משכורת',
            parent_name_en: 'Salary',
            parent_name_fr: null,
            parent_color: '#222',
            parent_icon: 'work',
            parent_description: 'Income',
            institution_id: 9,
            institution_name_he: 'בנק א',
            institution_name_en: 'Bank A',
            institution_logo: 'logo.png',
            institution_type: 'bank',
          },
          {
            // duplicate identifier should be removed
            identifier: 'tx-1',
            vendor: 'Payroll',
            date: '2025-01-15T00:00:00.000Z',
            price: '1000',
            processed_date: '2025-01-16T00:00:00.000Z',
            transaction_name: 'Salary January',
            account_number: '1111',
            subcategory_id: 10,
            subcategory_name: 'Salary',
            subcategory_name_en: 'Salary EN',
            subcategory_name_fr: null,
            subcategory_color: '#111',
            subcategory_icon: 'attach_money',
            subcategory_description: 'Income',
            parent_id: 10,
            depth_level: 1,
            parent_name: 'משכורת',
            parent_name_en: 'Salary',
            parent_name_fr: null,
            parent_color: '#222',
            parent_icon: 'work',
            parent_description: 'Income',
            institution_id: 9,
            institution_name_he: 'בנק א',
            institution_name_en: 'Bank A',
            institution_logo: 'logo.png',
            institution_type: 'bank',
          },
          {
            identifier: 'tx-2',
            vendor: null,
            date: '2025-01-20T00:00:00.000Z',
            price: '200',
            processed_date: '2999-01-01T00:00:00.000Z',
            transaction_name: 'Bonus',
            account_number: '2222',
            subcategory_id: 11,
            subcategory_name: 'Bonus',
            subcategory_name_en: 'Bonus EN',
            subcategory_name_fr: null,
            subcategory_color: '#333',
            subcategory_icon: 'star',
            subcategory_description: 'Bonus',
            parent_id: 10,
            depth_level: 2,
            parent_name: 'משכורת',
            parent_name_en: 'Salary',
            parent_name_fr: null,
            parent_color: '#222',
            parent_icon: 'work',
            parent_description: 'Income',
            institution_id: null,
            institution_name_he: null,
            institution_name_en: null,
            institution_logo: null,
            institution_type: null,
          },
        ],
      });

    const result = await breakdown({
      type: 'income',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      includeTransactions: '1',
      locale: 'en',
    });

    expect(String(queryMock.mock.calls[0][0])).toContain('t.price > 0');
    expect(result.summary).toMatchObject({
      total: 1200,
      count: 2,
      average: 600,
      min: 200,
      max: 1000,
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].date).toBeInstanceOf(Date);
    expect(result.breakdowns.byMonth).toEqual([{ month: '2025-01', total: 1200, inflow: 1200, outflow: 0 }]);

    const category = result.breakdowns.byCategory[0];
    expect(category.category).toBe('Salary');
    expect(category.pendingCount).toBe(1);
    expect(category.processedCount).toBe(1);
    expect(category.previousTotal).toBe(800);
    expect(category.subcategories.map((sub: any) => sub.name)).toEqual(['Salary (Direct)', 'Bonus EN']);

    const unknownVendor = result.breakdowns.byVendor.find((row: any) => row.vendor === 'Unknown');
    expect(unknownVendor.previousTotal).toBe(123);
    const payrollVendor = result.breakdowns.byVendor.find((row: any) => row.vendor === 'Payroll');
    expect(payrollVendor.institution).toMatchObject({ id: 9, display_name_en: 'Bank A' });
  });

  it('omits price sign filter for investment type and localizes French category names', async () => {
    const { getBreakdownAnalytics: breakdown } = analyticsModule;
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // previous categories
      .mockResolvedValueOnce({ rows: [] }) // previous vendors
      .mockResolvedValueOnce({
        rows: [
          {
            parent_id: 50,
            parent_name: 'Investments',
            parent_name_en: 'Investments',
            parent_name_fr: 'Investissements',
            parent_color: '#aaa',
            parent_icon: 'account_balance',
            parent_description: null,
            subcategory_id: 51,
            subcategory_name: 'Stocks',
            subcategory_name_en: 'Stocks',
            subcategory_name_fr: 'Actions',
            subcategory_color: '#bbb',
            subcategory_icon: 'show_chart',
            subcategory_description: null,
            subcategory_parent_id: 50,
            depth_level: 2,
            transaction_count: '1',
            total_amount: '150',
            pending_count: 0,
            processed_count: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ parent_id: 50, parent_name: 'Investments', month: '2025-04', total_amount: '150' }],
      })
      .mockResolvedValueOnce({
        rows: [{ vendor: 'Broker', transaction_count: '1', total_amount: '150', institution_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [{ vendor: 'Broker', month: '2025-04', total_amount: '150' }],
      })
      .mockResolvedValueOnce({
        rows: [{ month: '2025-04', total_amount: '150' }],
      })
      .mockResolvedValueOnce({
        rows: [{ count: '1', total: '150', min: '150', max: '150' }],
      });

    const result = await breakdown({
      type: 'investment',
      startDate: '2025-04-01',
      endDate: '2025-04-30',
      locale: 'fr',
    });

    const previousCategorySql = String(queryMock.mock.calls[0][0]);
    expect(previousCategorySql).not.toContain('AND t.price < 0');
    expect(previousCategorySql).not.toContain('AND t.price > 0');
    expect(result.breakdowns.byCategory[0].category).toBe('Investissements');
    expect(result.breakdowns.byCategory[0].subcategories[0].name).toBe('Actions');
    expect(result.breakdowns.byMonth).toEqual([{ month: '2025-04', total: 150, inflow: 150, outflow: 0 }]);
  });

  it('uses ttl cache outside test env and supports explicit noCache overrides', async () => {
    const { getBreakdownAnalytics: breakdown } = analyticsModule;
    const originalNodeEnv = process.env.NODE_ENV;

    process.env.NODE_ENV = 'production';
    queueEmptyAggregateResponses();
    queueEmptyAggregateResponses();

    try {
      await breakdown({
        type: 'expense',
        startDate: '2025-05-01',
        endDate: '2025-05-31',
      });
      expect(queryMock).toHaveBeenCalledTimes(8);

      await breakdown({
        type: 'expense',
        startDate: '2025-05-01',
        endDate: '2025-05-31',
      });
      expect(queryMock).toHaveBeenCalledTimes(8);

      await breakdown({
        type: 'expense',
        startDate: '2025-05-01',
        endDate: '2025-05-31',
        noCache: '1',
      });
      expect(queryMock).toHaveBeenCalledTimes(16);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
