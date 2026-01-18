import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as metrics from '../metrics.js';

const queryMock = vi.fn();
const mockDb = { query: queryMock };

beforeEach(() => {
  queryMock.mockReset();
  metrics.__setDatabase?.(mockDb);
});

afterEach(() => {
  metrics.__resetDatabase?.();
});

describe('transactions metrics service', () => {
  it('lists available months in descending order', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ month_value: '2025-03' }, { month_value: null }, { month_value: '2024-12' }],
    });

    const months = await metrics.listAvailableMonths();

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(months).toEqual(['2025-03', '2024-12']);
  });

  it('fetches category expenses for a specific category and month', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          name: 'Groceries',
          price: '-50.25',
          date: '2025-02-10',
          identifier: 'txn-1',
          vendor: 'vendor-a',
          category_definition_id: 10,
          category_name: 'Food',
          category_type: 'expense',
          parent_category_definition_id: 1,
          parent_category_name: 'Household',
        },
      ],
    });

    const rows = await metrics.getCategoryExpenses({
      month: '2025-02',
      categoryId: 10,
      all: false,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Groceries',
      price: '-50.25',
      category_definition_id: 10,
      parent_category_name: 'Household',
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0][0];
    expect(String(sql)).toContain('WITH RECURSIVE category_tree');
  });

  it('throws when month is missing', async () => {
    await expect(metrics.getCategoryExpenses({ categoryId: 1 })).rejects.toThrow('Month parameter is required');
  });

  it('throws when category is missing and all flag is not true', async () => {
    await expect(metrics.getCategoryExpenses({ month: '2025-01' })).rejects.toThrow(
      'Either categoryId must be provided or all=true',
    );
  });

  it('fetches category expenses for all categories when all=true', async () => {
    const rows = [
      {
        name: 'Rent',
        price: '-1000.00',
        date: '2025-03-01',
        identifier: 'tx-1',
        vendor: 'landlord',
        category_definition_id: 2,
        category_name: 'Housing',
        category_type: 'expense',
        parent_category_definition_id: null,
        parent_category_name: null,
      },
    ];
    queryMock.mockResolvedValueOnce({ rows });

    const result = await metrics.getCategoryExpenses({ month: '2025-03', all: 'true' });

    expect(result).toEqual(rows);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(params).toEqual(['2025-03']);
    expect(String(sql)).toContain('tpe.transaction_identifier IS NULL');
    expect(String(sql)).toMatch(/is_pikadon_related/i);
  });

  it('fetches category expenses by category id without month filter', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ identifier: 'tx-2', category_definition_id: 7, name: 'Insurance' }],
    });

    const result = await metrics.getCategoryExpenses({ month: 'all', categoryId: '7' });

    expect(result).toEqual([{ identifier: 'tx-2', category_definition_id: 7, name: 'Insurance' }]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(params).toEqual([7]);
    expect(String(sql)).toContain('category_tree');
    expect(String(sql)).toMatch(/is_pikadon_related/i);
  });

  it('throws when categoryId is invalid', async () => {
    await expect(
      metrics.getCategoryExpenses({ month: '2025-01', categoryId: 'oops' as any, all: false }),
    ).rejects.toThrow('Invalid categoryId parameter');
  });

  it('aggregates box panel data with parsed counts', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // categories
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // nonMapped
      .mockResolvedValueOnce({ rows: [{ count: '12' }] }) // total
      .mockResolvedValueOnce({ rows: [{ formatted_date: '01-02-2025' }] }); // last month

    const result = await metrics.getBoxPanelData();

    expect(result).toEqual({
      categories: 5,
      nonMapped: 2,
      allTransactions: 12,
      lastMonth: '01-02-2025',
    });
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it('builds spending timeline by year for a category id', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ amount: '-100.5', year: '2024' }] });

    const rows = await metrics.getCategorySpendingTimeline({
      categoryId: '5',
      month: '3',
      groupByYear: true,
    });

    expect(rows).toEqual([{ amount: '-100.5', year: '2024' }]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(params).toEqual([5, 3]);
    expect(String(sql)).toContain('WITH RECURSIVE category_tree');
    expect(String(sql)).toContain('ORDER BY year ASC');
  });

  it('builds monthly spending timeline for a category name', async () => {
    const rows = [{ amount: '-20.1', year: '2023', month: '01', year_month: '01-2023' }];
    queryMock.mockResolvedValueOnce({ rows });

    const result = await metrics.getCategorySpendingTimeline({
      category: 'Groceries',
      month: '6',
      groupByYear: 'false',
    });

    expect(result).toEqual(rows);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(params).toEqual(['Groceries', 6]);
    expect(String(sql)).toContain('WHERE t.category = $1');
    expect(String(sql)).toContain('ORDER BY year ASC, month ASC');
  });

  it('throws when spending timeline parameters are incomplete', async () => {
    await expect(metrics.getCategorySpendingTimeline({ categoryId: 1 })).rejects.toThrow(
      'month and groupByYear are required',
    );
    await expect(metrics.getCategorySpendingTimeline({ month: '2', groupByYear: true })).rejects.toThrow(
      'categoryId or category is required',
    );
  });

  it('gets expenses by month grouped by year', async () => {
    const rows = [
      { amount: '-200.12', year: '2024' },
      { amount: null, year: '2023' },
    ];
    queryMock.mockResolvedValueOnce({ rows });

    const result = await metrics.getExpensesByMonth({ month: '6', groupByYear: 'true' });

    expect(result).toEqual([
      { amount: -200.12, year: '2024' },
      { amount: 0, year: '2023' },
    ]);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([6, expect.any(String)]);
  });

  it('gets expenses by month grouped by month within years', async () => {
    const rows = [{ amount: '-300', year: '2024', month: '03', year_month: '03-2024' }];
    queryMock.mockResolvedValueOnce({ rows });

    const result = await metrics.getExpensesByMonth({ month: '4', groupByYear: 'false' });

    expect(result).toEqual([{ amount: -300, year: '2024', month: '03', year_month: '03-2024' }]);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([4, expect.any(String)]);
  });

  it('throws when expenses by month params are missing', async () => {
    await expect(metrics.getExpensesByMonth({ month: undefined, groupByYear: true })).rejects.toThrow(
      'month and groupByYear are required',
    );
  });

  it('returns month-by-category aggregates with numeric values', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          category_definition_id: 1,
          name: 'Food',
          name_en: 'Food',
          icon: 'food',
          color: '#fff',
          category_type: 'expense',
          transaction_count: '3',
          auto_count: '2',
          value: '120.5',
          expenses_total: '200.1',
          income_total: '15.2',
        },
      ],
    });

    const result = await metrics.getMonthByCategories({ month: '2024-12' });

    expect(result).toEqual([
      {
        category_definition_id: 1,
        name: 'Food',
        name_en: 'Food',
        icon: 'food',
        color: '#fff',
        category_type: 'expense',
        transaction_count: 3,
        auto_count: 2,
        value: 120.5,
        expenses_total: 200.1,
        income_total: 15.2,
      },
    ]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(['2024-12']);
  });

  it('lists categories with parent metadata', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          name: 'Groceries',
          name_en: 'Groceries',
          category_type: 'expense',
          parent_id: 1,
          parent_name: 'Household',
          parent_name_en: 'Household',
          display_order: 2,
          parent_display_order: 1,
        },
      ],
    });

    const result = await metrics.listCategories();

    expect(result).toEqual([
      {
        id: 10,
        name: 'Groceries',
        nameEn: 'Groceries',
        categoryType: 'expense',
        parentId: 1,
        parentName: 'Household',
        parentNameEn: 'Household',
      },
    ]);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
