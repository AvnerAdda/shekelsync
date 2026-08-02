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
    vi.unstubAllEnvs();
    categoryDetailsModule.__resetDatabase?.();
  });

  it('requires a category identifier before querying the database', async () => {
    await expect(
      categoryDetailsModule.getCategoryDetails({ noCache: true }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Category identifier is required',
    });

    expect(getClientMock).not.toHaveBeenCalled();
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

  it('maps parent-category income details and localized result groups', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          count: '2',
          total: '350',
          average: '175',
          pending_count: '0',
          processed_count: '2',
          min_amount: '100',
          max_amount: '250',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ vendor: 'bank', count: '2', total: '350' }] })
      .mockResolvedValueOnce({
        rows: [{ account_number: '123', vendor: 'bank', count: '2', total: '350' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 8,
          name: 'שכר',
          name_en: 'Salary',
          name_fr: 'Salaire',
          count: '2',
          total: '350',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          identifier: 'income-1',
          date: '2026-03-01',
          name: 'Employer',
          price: '350',
          processed_date: '2026-03-01',
          vendor: 'bank',
          account_number: '123',
          category_definition_id: 8,
          category_name: 'שכר',
          category_name_en: 'Salary',
          category_name_fr: 'Salaire',
          parent_name: 'הכנסה',
          parent_name_en: 'Income',
          parent_name_fr: 'Revenu',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ month: '2026-03', total: '350', count: '2' }] });

    const result = await categoryDetailsModule.getCategoryDetails({
      parentId: 7,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      type: 'income',
      locale: 'fr',
      noCache: true,
    });

    expect(result.subcategories).toEqual([{ id: 8, name: 'Salaire', count: 2, total: 350 }]);
    expect(result.byVendor).toEqual([{ vendor: 'bank', count: 2, total: 350 }]);
    expect(result.byCard).toEqual([
      { accountNumber: '123', vendor: 'bank', count: 2, total: 350 },
    ]);
    expect(result.transactions[0]).toMatchObject({
      categoryName: 'Salaire',
      parentName: 'Revenu',
      price: 350,
    });
    expect(result.trend).toEqual([{ month: '2026-03', total: 350, count: 2 }]);
    expect(queryMock.mock.calls[0][0]).toContain('t.price > 0');
    expect(queryMock.mock.calls[3][0]).toContain('WHERE cd.parent_id = $1');
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it('caches investment details outside the test environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    queryMock
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const params = {
      subcategoryId: 909,
      startDate: '2040-01-01',
      endDate: '2040-01-31',
      type: 'investment',
    };
    const first = await categoryDetailsModule.getCategoryDetails(params);
    const second = await categoryDetailsModule.getCategoryDetails(params);

    expect(second).toBe(first);
    expect(first).toMatchObject({ subcategoryId: 909, summary: { count: 0, total: 0 } });
    expect(getClientMock).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(queryMock.mock.calls[0][0]).toContain('ABS(t.price)');
    expect(queryMock.mock.calls[0][0]).toContain('t.category_definition_id = $1');
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});
