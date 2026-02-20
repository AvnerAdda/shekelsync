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
          {
            date: '2025-01-01',
            income: '100.50',
            expenses: '10.25',
            capital_returns: '0',
            salary_income: '80',
            card_repayments: '2.25',
            paired_card_expenses: '4.5',
            paired_card_repayments: '1.5',
          },
          {
            date: '2025-01-02',
            income: '50',
            expenses: '20.75',
            capital_returns: '7.5',
            salary_income: '20',
            card_repayments: '0',
            paired_card_expenses: '0',
            paired_card_repayments: '0',
          },
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
      {
        rows: [
          {
            pending_expenses: '30',
            pending_count: '2',
          },
        ],
      },
      {
        rows: [
          {
            account_id: 1,
            account_name: 'Checking',
            current_balance: '1500.25',
            as_of_date: '2025-01-31',
          },
        ],
      },
      { rows: [{ total_balance: '1000' }] },
      {
        rows: [
          { date: '2025-01-01', total_balance: '1200' },
          { date: '2025-01-02', total_balance: '1300.25' },
        ],
      },
      { rows: [{ net_pikadon: '200' }] },
      { rows: [{ pending_debt: '50' }] },
    ]);

    const result = await getDashboardAnalytics({
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      aggregation: 'weekly',
    });

    expect(queryMock).toHaveBeenCalledTimes(11);
    const historyArgs = queryMock.mock.calls[0][1];
    expect(historyArgs[0]).toBeInstanceOf(Date);
    expect(historyArgs[0].toISOString().startsWith('2025-01-01')).toBe(true);
    expect(historyArgs[1]).toBeInstanceOf(Date);
    expect(historyArgs[1].toISOString().startsWith('2025-01-31')).toBe(true);
    expect(historyArgs[2]).toBe(BANK_CATEGORY_NAME);
    const historySql = queryMock.mock.calls[0][0];
    expect(historySql).toContain('as salary_income');
    expect(historySql).toContain('as paired_card_expenses');
    expect(historySql).toContain('as paired_card_repayments');
    expect(historySql).toContain("LOWER(COALESCE(cd.name, '')) LIKE '%salary%'");
    expect(historySql).not.toContain("LOWER(COALESCE(t.name, '')) LIKE '%salary%'");
    const summaryArgs = queryMock.mock.calls[4][1];
    expect(summaryArgs[2]).toBe(BANK_CATEGORY_NAME);

    expect(result.summary).toEqual({
      totalIncome: 500,
      totalExpenses: 300,
      totalCapitalReturns: 0,
      netBalance: 200,
      investmentOutflow: 120,
      investmentInflow: 20,
      netInvestments: 100,
      totalAccounts: 4,
      currentBankBalance: 1500.25,
      monthStartBankBalance: 1000,
      bankBalanceChange: 500.25,
      pendingExpenses: 30,
      pendingCount: 2,
      pikkadonBalance: 200,
      checkingBalance: 1300.25,
      pendingCCDebt: 50,
      availableBalance: 1250.25,
    });

    expect(result.history).toEqual([
      {
        date: '2025-01-01',
        income: 100.5,
        expenses: 10.25,
        capitalReturns: 0,
        salaryIncome: 80,
        cardRepayments: 2.25,
        pairedCardExpenses: 4.5,
        pairedCardRepayments: 1.5,
        bankBalance: 1200,
      },
      {
        date: '2025-01-02',
        income: 50,
        expenses: 20.75,
        capitalReturns: 7.5,
        salaryIncome: 20,
        cardRepayments: 0,
        pairedCardExpenses: 0,
        pairedCardRepayments: 0,
        bankBalance: 1300.25,
      },
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
      { vendor: 'Supermarket', count: 5, total: 800, institution: null },
      { vendor: 'Restaurant', count: 2, total: 200, institution: null },
    ]);

    expect(result.breakdowns.byMonth).toEqual([
      { month: '2025-01', income: 200, expenses: 150 },
      { month: '2025-02', income: 250, expenses: 160 },
    ]);
    expect(result.breakdowns.byBankAccount).toEqual([
      {
        accountId: 1,
        accountName: 'Checking',
        currentBalance: 1500.25,
        asOfDate: '2025-01-31',
        institution: null,
      },
    ]);
  });

  it('handles empty datasets by returning zeros', async () => {
    mockQuerySequence(Array.from({ length: 11 }, () => ({ rows: [] })));

    const result = await getDashboardAnalytics({
      startDate: '2024-12-01',
      endDate: '2024-12-31',
    });

    expect(queryMock).toHaveBeenCalledTimes(11);
    expect(result.summary).toEqual({
      totalIncome: 0,
      totalExpenses: 0,
      totalCapitalReturns: 0,
      netBalance: 0,
      investmentOutflow: 0,
      investmentInflow: 0,
      netInvestments: 0,
      totalAccounts: 0,
      currentBankBalance: 0,
      monthStartBankBalance: 0,
      bankBalanceChange: 0,
      pendingExpenses: 0,
      pendingCount: 0,
      pikkadonBalance: 0,
      checkingBalance: 0,
      pendingCCDebt: 0,
      availableBalance: 0,
    });
    expect(result.history).toEqual([]);
    expect(result.breakdowns.byCategory).toEqual([]);
    expect(result.breakdowns.byVendor).toEqual([]);
    expect(result.breakdowns.byMonth).toEqual([]);
    expect(result.breakdowns.byBankAccount).toEqual([]);
  });

  it('summarizes investment-only datasets correctly', async () => {
    mockQuerySequence([
      {
        rows: [
          {
            date: '2025-02-01',
            income: '0',
            expenses: '0',
            capital_returns: '0',
            salary_income: '0',
            card_repayments: '0',
            paired_card_expenses: '0',
            paired_card_repayments: '0',
          },
          {
            date: '2025-02-02',
            income: '0',
            expenses: '0',
            capital_returns: '0',
            salary_income: '0',
            card_repayments: '0',
            paired_card_expenses: '0',
            paired_card_repayments: '0',
          },
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
      { rows: [{ pending_expenses: '0', pending_count: '0' }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    const result = await getDashboardAnalytics({
      startDate: '2025-02-01',
      endDate: '2025-02-28',
    });

    expect(queryMock).toHaveBeenCalledTimes(11);
    expect(result.summary).toEqual({
      totalIncome: 0,
      totalExpenses: 0,
      totalCapitalReturns: 0,
      netBalance: 0,
      investmentOutflow: 750,
      investmentInflow: 130,
      netInvestments: 620,
      totalAccounts: 2,
      currentBankBalance: 0,
      monthStartBankBalance: 0,
      bankBalanceChange: 0,
      pendingExpenses: 0,
      pendingCount: 0,
      pikkadonBalance: 0,
      checkingBalance: 0,
      pendingCCDebt: 0,
      availableBalance: 0,
    });
    expect(result.history).toEqual([
      {
        date: '2025-02-01',
        income: 0,
        expenses: 0,
        capitalReturns: 0,
        salaryIncome: 0,
        cardRepayments: 0,
        pairedCardExpenses: 0,
        pairedCardRepayments: 0,
        bankBalance: 0,
      },
      {
        date: '2025-02-02',
        income: 0,
        expenses: 0,
        capitalReturns: 0,
        salaryIncome: 0,
        cardRepayments: 0,
        pairedCardExpenses: 0,
        pairedCardRepayments: 0,
        bankBalance: 0,
      },
    ]);
    expect(result.breakdowns.byCategory).toEqual([]);
    expect(result.breakdowns.byVendor).toEqual([]);
    expect(result.breakdowns.byMonth).toEqual([{ month: '2025-02', income: 0, expenses: 0 }]);
    expect(result.breakdowns.byBankAccount).toEqual([]);
  });

  it('keeps capital returns out of income while reporting them separately', async () => {
    mockQuerySequence([
      { rows: [] }, // history
      { rows: [] }, // category breakdown
      { rows: [] }, // vendor breakdown
      { rows: [] }, // month breakdown
      {
        rows: [
          {
            total_income: '1000',
            total_capital_returns: '300',
            total_expenses: '500',
            investment_outflow: '0',
            investment_inflow: '0',
            total_accounts: '1',
          },
        ],
      },
      { rows: [{ pending_expenses: '0', pending_count: '0' }] },
      { rows: [] }, // current bank balances
      { rows: [{ total_balance: '0' }] }, // month start balance
      { rows: [] }, // balance history
      { rows: [{ net_pikadon: '0' }] }, // pikadon balance
      { rows: [{ pending_debt: '0' }] }, // pending CC debt
    ]);

    const result = await getDashboardAnalytics({
      startDate: '2025-03-01',
      endDate: '2025-03-31',
      aggregation: 'monthly',
    });

    expect(result.summary).toMatchObject({
      totalIncome: 1000,
      totalExpenses: 500,
      totalCapitalReturns: 300,
      netBalance: 500, // income - expenses (capital returns excluded)
      pikkadonBalance: 0,
    });
  });
});
