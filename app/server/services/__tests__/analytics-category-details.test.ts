import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();
const getClientMock = vi.fn();

let categoryDetailsModule: any;

describe('category details analytics', () => {
  beforeAll(async () => {
    categoryDetailsModule = await import('../analytics/category-details.js');
  });

  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    getClientMock.mockReset();
    getClientMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });
    categoryDetailsModule.__setDatabase?.({
      getClient: getClientMock,
    });
  });

  afterEach(() => {
    categoryDetailsModule.__resetDatabase?.();
  });

  it('returns full pending and processed counts in the summary payload', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            count: '72',
            total: '4961.7',
            average: '68.91',
            pending_count: '43',
            processed_count: '29',
            min_amount: '10',
            max_amount: '292.74',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'txn-1',
            date: '2026-03-26T13:34:55.000Z',
            name: 'מינימרקט האחים',
            price: '-36',
            processed_date: '2026-03-26T13:34:55.000Z',
            vendor: 'max',
            account_number: '4886',
            category_definition_id: 10,
            category_name: 'סופרמרקט',
            category_name_en: 'Groceries',
            category_name_fr: null,
            parent_name: 'אוכל',
            parent_name_en: 'Food',
            parent_name_fr: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await categoryDetailsModule.getCategoryDetails({
      category: 'Groceries',
      startDate: '2026-02-24T14:43:03.237Z',
      endDate: '2026-03-26T14:43:03.237Z',
      type: 'expense',
      noCache: true,
    });

    expect(result.summary).toMatchObject({
      count: 72,
      total: 4961.7,
      average: 68.91,
      pendingCount: 43,
      processedCount: 29,
      minAmount: 10,
      maxAmount: 292.74,
    });
    expect(result.transactions).toHaveLength(1);
    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
