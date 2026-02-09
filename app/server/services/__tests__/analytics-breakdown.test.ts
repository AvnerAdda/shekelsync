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

    const result = await breakdown({
      type: 'expense',
      startDate: '2025-03-01',
      endDate: '2025-03-31',
    });

    expect(result.breakdowns.byCategory).toEqual([]);
    expect(result.breakdowns.byVendor).toEqual([]);
    expect(result.transactions).toBeUndefined();
  });
});
