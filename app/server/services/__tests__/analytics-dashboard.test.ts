import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BANK_CATEGORY_NAME } from '../../../lib/category-constants.js';

const queryMock = vi.fn();

let analyticsModule: any;
let getDashboardAnalytics: any;

beforeAll(async () => {
  analyticsModule = await import('../analytics/dashboard.js');
  getDashboardAnalytics =
    analyticsModule.getDashboardAnalytics ?? analyticsModule.default.getDashboardAnalytics;
});

beforeEach(() => {
  queryMock.mockReset();
  analyticsModule.__setDatabase?.({ query: queryMock });
});

function mockQuerySequence(responses: Array<{ rows: any[] }>) {
  responses.forEach((response) => {
    queryMock.mockResolvedValueOnce(response);
  });
}

afterEach(() => {
  analyticsModule.__resetDatabase?.();
});

describe('analytics dashboard service', () => {
  it('aggregates dashboard analytics with custom data', async () => {
    mockQuerySequence([
      {
        rows: [
          { date: '2025-01-01', income: '100.50', expenses: '10.25' },
          { date: '2025-01-02', income: '50', expenses: '20.75' },
        ],
      },
      {
        rows: [
          {
            parent_id: 1,
            parent_name: 'Housing',
            subcategory_id: 11,
            subcategory_name: 'Rent',
            count: '2',
            total: '3000',
          },
          {
            parent_id: 1,
            parent_name: 'Housing',
            subcategory_id: 12,
            subcategory_name: 'Utilities',
            count: '3',
            total: '450',
          },
          {
            parent_id: 2,
            parent_name: 'Food',
            subcategory_id: 21,
            subcategory_name: 'Groceries',
            count: '5',
            total: '900',
          },
        ],
      },
      {
        rows: [
          { vendor: 'Supermarket', count: '5', total: '800' },
          { vendor: 'Restaurant', count: '2', total: '200' },
        ],
      },
      {
        rows: [
          { month: '2025-01', income: '200', expenses: '150' },
          { month: '2025-02', income: '250', expenses: '160' },
        ],
      },
      {
        rows: [
          {
            total_income: '500',
            total_expenses: '300',
            investment_outflow: '120',
            investment_inflow: '20',
            total_accounts: '4',
          },
        ],
      },
    ]);

    const result = await getDashboardAnalytics({
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      aggregation: 'weekly',
    });

    expect(queryMock).toHaveBeenCalledTimes(5);
    const historyArgs = queryMock.mock.calls[0][1];
    expect(historyArgs[0]).toBeInstanceOf(Date);
    expect(historyArgs[0].toISOString().startsWith('2025-01-01')).toBe(true);
    expect(historyArgs[1]).toBeInstanceOf(Date);
    expect(historyArgs[1].toISOString().startsWith('2025-01-31')).toBe(true);
    expect(historyArgs[2]).toBe(BANK_CATEGORY_NAME);
    const summaryArgs = queryMock.mock.calls[4][1];
    expect(summaryArgs[2]).toBe(BANK_CATEGORY_NAME);

    expect(result.summary).toEqual({
      totalIncome: 500,
      totalExpenses: 300,
      netBalance: 200,
      investmentOutflow: 120,
      investmentInflow: 20,
      netInvestments: 100,
      totalAccounts: 4,
    });

    expect(result.history).toEqual([
      { date: '2025-01-01', income: 100.5, expenses: 10.25 },
      { date: '2025-01-02', income: 50, expenses: 20.75 },
    ]);

    expect(result.breakdowns.byCategory).toEqual([
      {
        parentId: 1,
        category: 'Housing',
        count: 5,
        total: 3450,
        subcategories: [
          { id: 11, name: 'Rent', count: 2, total: 3000 },
          { id: 12, name: 'Utilities', count: 3, total: 450 },
        ],
      },
      {
        parentId: 2,
        category: 'Food',
        count: 5,
        total: 900,
        subcategories: [{ id: 21, name: 'Groceries', count: 5, total: 900 }],
      },
    ]);

    expect(result.breakdowns.byVendor).toEqual([
      { vendor: 'Supermarket', count: 5, total: 800 },
      { vendor: 'Restaurant', count: 2, total: 200 },
    ]);

    expect(result.breakdowns.byMonth).toEqual([
      { month: '2025-01', income: 200, expenses: 150 },
      { month: '2025-02', income: 250, expenses: 160 },
    ]);
  });

  it('handles empty datasets by returning zeros', async () => {
    mockQuerySequence(Array.from({ length: 5 }, () => ({ rows: [] })));

    const result = await getDashboardAnalytics({
      startDate: '2024-12-01',
      endDate: '2024-12-31',
    });

    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(result.summary).toEqual({
      totalIncome: 0,
      totalExpenses: 0,
      netBalance: 0,
      investmentOutflow: 0,
      investmentInflow: 0,
      netInvestments: 0,
      totalAccounts: 0,
    });
    expect(result.history).toEqual([]);
    expect(result.breakdowns.byCategory).toEqual([]);
    expect(result.breakdowns.byVendor).toEqual([]);
    expect(result.breakdowns.byMonth).toEqual([]);
  });

  it('summarizes investment-only datasets correctly', async () => {
    mockQuerySequence([
      {
        rows: [
          { date: '2025-02-01', income: '0', expenses: '0' },
          { date: '2025-02-02', income: '0', expenses: '0' },
        ],
      },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          { month: '2025-02', income: '0', expenses: '0' },
        ],
      },
      {
        rows: [
          {
            total_income: '0',
            total_expenses: '0',
            investment_outflow: '750',
            investment_inflow: '130',
            total_accounts: '2',
          },
        ],
      },
    ]);

    const result = await getDashboardAnalytics({
      startDate: '2025-02-01',
      endDate: '2025-02-28',
    });

    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(result.summary).toEqual({
      totalIncome: 0,
      totalExpenses: 0,
      netBalance: 0,
      investmentOutflow: 750,
      investmentInflow: 130,
      netInvestments: 620,
      totalAccounts: 2,
    });
    expect(result.history).toEqual([
      { date: '2025-02-01', income: 0, expenses: 0 },
      { date: '2025-02-02', income: 0, expenses: 0 },
    ]);
    expect(result.breakdowns.byCategory).toEqual([]);
    expect(result.breakdowns.byVendor).toEqual([]);
    expect(result.breakdowns.byMonth).toEqual([{ month: '2025-02', income: 0, expenses: 0 }]);
  });
});
