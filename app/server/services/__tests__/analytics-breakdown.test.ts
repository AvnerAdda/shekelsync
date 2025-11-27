import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
let analyticsModule: any;
let getBreakdownAnalytics: any;
const metricsStore = require('../analytics/metrics-store.js');

describe('breakdown analytics trends', () => {
  beforeAll(async () => {
    analyticsModule = await import('../analytics/breakdown.js');
    getBreakdownAnalytics =
      analyticsModule.getBreakdownAnalytics ??
      analyticsModule.default?.getBreakdownAnalytics;
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

    const transactionRow = {
      identifier: 'txn-1',
      vendor: 'Vendor X',
      date: '2025-01-05',
      price: '-100',
      processed_date: null,
      name: 'Dining Out',
      account_number: '111',
      subcategory_id: 11,
      subcategory_name: 'Meals',
      subcategory_color: '#000',
      subcategory_icon: 'fastfood',
      subcategory_description: null,
      parent_id: 1,
      parent_name: 'Dining',
      parent_color: '#111',
      parent_icon: 'restaurant',
      parent_description: 'Food & dining',
      depth_level: 2,
      institution_id: 5,
      institution_name_en: 'Bank A',
      institution_name_he: 'בנק א',
      institution_logo: null,
      institution_type: 'bank',
    };

    queryMock
      // current period transactions
      .mockResolvedValueOnce({ rows: [transactionRow] })
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
      });

    const result = await getBreakdownAnalytics({
      type: 'expense',
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });

    expect(queryMock).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'txn-1',
            vendor: 'Vendor Y',
            date: '2025-02-05',
            price: '-50',
            processed_date: null,
            name: 'Snacks',
            account_number: '111',
            subcategory_id: 22,
            subcategory_name: 'Snacks',
            subcategory_color: '#123',
            subcategory_icon: 'cookie',
            subcategory_description: null,
            parent_id: 2,
            parent_name: 'Food',
            parent_color: '#333',
            parent_icon: 'fastfood',
            parent_description: 'Food & dining',
            depth_level: 2,
            institution_id: null,
            institution_name_en: null,
            institution_name_he: null,
            institution_logo: null,
            institution_type: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

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
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await breakdown({
      type: 'expense',
      startDate: '2025-03-01',
      endDate: '2025-03-31',
    });

    expect(result.breakdowns.byCategory).toEqual([]);
    expect(result.breakdowns.byVendor).toEqual([]);
    expect(result.transactions).toEqual([]);
  });
});
