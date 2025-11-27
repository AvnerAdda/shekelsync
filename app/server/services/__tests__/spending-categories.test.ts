import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();

let serviceModule: any;
let getSpendingCategoryBreakdown: any;

beforeAll(async () => {
  serviceModule = await import('../analytics/spending-categories.js');
  getSpendingCategoryBreakdown =
    serviceModule.getSpendingCategoryBreakdown ??
    serviceModule.default?.getSpendingCategoryBreakdown;
});

beforeEach(() => {
  queryMock.mockReset();
  releaseMock.mockReset();
  const mockClient = {
    query: queryMock,
    release: releaseMock,
  };
  serviceModule.__setDatabase?.({
    getClient: async () => mockClient,
  });
});

afterEach(() => {
  serviceModule.__resetDatabase?.();
});

describe('spending categories service', () => {
  it('marks missing spending_category entries as unallocated', async () => {
    queryMock
      // total income
      .mockResolvedValueOnce({
        rows: [{ total_income: '100' }],
      })
      // spending breakdown
      .mockResolvedValueOnce({
        rows: [
          {
            spending_category: null,
            transaction_count: '2',
            total_amount: '50',
            avg_transaction: '25',
            first_transaction_date: '2025-01-01',
            last_transaction_date: '2025-01-31',
          },
        ],
      })
      // targets
      .mockResolvedValueOnce({ rows: [] })
      // categories by allocation
      .mockResolvedValueOnce({
        rows: [
          {
            category_definition_id: 10,
            category_name: 'Misc',
            category_name_en: 'Misc',
            spending_category: null,
            total_amount: '50',
            transaction_count: '2',
          },
        ],
      });

    const result = await getSpendingCategoryBreakdown({
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });

    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(releaseMock).toHaveBeenCalledTimes(1);

    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].spending_category).toBe('unallocated');
    expect(result.breakdown[0].actual_percentage).toBeCloseTo(50);

    expect(result.categories_by_allocation.unallocated).toHaveLength(1);
    expect(result.categories_by_allocation.unallocated[0].category_definition_id).toBe(10);
  });
});

