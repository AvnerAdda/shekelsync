// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
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
            operating_expenses: '8',
            non_operating_expenses: '2.25',
            capital_returns: '0',
            salary_income: '80',
            operating_income: '80',
            non_operating_income: '20.5',
            card_repayments: '2.25',
            paired_card_expenses: '4.5',
            paired_card_repayments: '1.5',
          },
          {
            date: '2025-01-02',
            income: '50',
            expenses: '20.75',
            operating_expenses: '20.75',
            non_operating_expenses: '0',
            capital_returns: '7.5',
            salary_income: '20',
            operating_income: '20',
            non_operating_income: '30',
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
            total_operating_income: '350',
            total_non_operating_income: '150',
            total_expenses: '300',
            total_operating_expenses: '250',
            total_non_operating_expenses: '50',
            investment_outflow: '120',
            investment_inflow: '20',
            total_accounts: '4',
          },
        ],
      },
      {
        rows: [
          {
            processed_date: '2025-02-05',
            pending_expenses: '10',
            pending_count: '1',
          },
          {
            processed_date: '2025-02-15',
            pending_expenses: '20',
            pending_count: '1',
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
    expect(historySql).toContain('as operating_income');
    expect(historySql).toContain('as non_operating_income');
    expect(historySql).toContain('as paired_card_expenses');
    expect(historySql).toContain('as paired_card_repayments');
    expect(historySql).toContain('FROM transaction_pairing_exclusions tpe_cov');
    expect(historySql).toContain('cc_t.vendor = ap_cov.credit_card_vendor');
    expect(historySql).toContain("LOWER(COALESCE(cd.name, '')) LIKE '%salary%'");
    expect(historySql).not.toContain("LOWER(COALESCE(t.name, '')) LIKE '%salary%'");
    const summaryArgs = queryMock.mock.calls[4][1];
    expect(summaryArgs[2]).toBe(BANK_CATEGORY_NAME);
    const pendingExpensesSql = String(queryMock.mock.calls[5][0]);
    expect(pendingExpensesSql).toContain("DATE(COALESCE(t.processed_datetime, t.processed_date), 'localtime') as processed_date");
    expect(pendingExpensesSql).toContain("DATE(COALESCE(t.processed_datetime, t.processed_date), 'localtime') > DATE('now', 'localtime')");
    expect(pendingExpensesSql).toContain("GROUP BY DATE(COALESCE(t.processed_datetime, t.processed_date), 'localtime')");
    expect(pendingExpensesSql).toContain('ORDER BY processed_date ASC');
    const monthStartBalanceSql = String(queryMock.mock.calls[7][0]);
    expect(monthStartBalanceSql).toContain('ih2.as_of_date <= $1');
    const pendingCcDebtSql = String(queryMock.mock.calls[10][0]);
    expect(pendingCcDebtSql).toContain('(lr.last_date IS NULL OR t.date > lr.last_date)');
    expect(pendingCcDebtSql).not.toContain("cd.name = 'פרעון כרטיס אשראי'");

    expect(result.summary).toEqual({
      totalIncome: 500,
      totalOperatingIncome: 350,
      totalNonOperatingIncome: 150,
      totalExpenses: 300,
      totalOperatingExpenses: 250,
      totalNonOperatingExpenses: 50,
      totalCapitalReturns: 0,
      netBalance: 200,
      operatingNetBalance: 100,
      investmentOutflow: 120,
      investmentInflow: 20,
      netInvestments: 100,
      totalAccounts: 4,
      currentBankBalance: 1500.25,
      monthStartBankBalance: 1000,
      bankBalanceChange: 500.25,
      pendingExpenses: 30,
      pendingCount: 2,
      pendingByProcessedDate: [
        { date: '2025-02-05', amount: 10, count: 1 },
        { date: '2025-02-15', amount: 20, count: 1 },
      ],
      pikkadonBalance: 200,
      checkingBalance: 1300.25,
      pendingCCDebt: 50,
      availableBalance: 1250.25,
    });

    expect(result.history).toMatchObject([
      {
        date: '2025-01-01',
        income: 100.5,
        expenses: 10.25,
        investments: 0,
        operatingExpenses: 8,
        nonOperatingExpenses: 2.25,
        capitalReturns: 0,
        salaryIncome: 80,
        operatingIncome: 80,
        nonOperatingIncome: 20.5,
        cardRepayments: 2.25,
        pairedCardExpenses: 4.5,
        pairedCardRepayments: 1.5,
        bankBalance: 1200,
      },
      {
        date: '2025-01-02',
        income: 50,
        expenses: 20.75,
        investments: 0,
        operatingExpenses: 20.75,
        nonOperatingExpenses: 0,
        capitalReturns: 7.5,
        salaryIncome: 20,
        operatingIncome: 20,
        nonOperatingIncome: 30,
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
      totalOperatingIncome: 0,
      totalNonOperatingIncome: 0,
      totalExpenses: 0,
      totalOperatingExpenses: 0,
      totalNonOperatingExpenses: 0,
      totalCapitalReturns: 0,
      netBalance: 0,
      operatingNetBalance: 0,
      investmentOutflow: 0,
      investmentInflow: 0,
      netInvestments: 0,
      totalAccounts: 0,
      currentBankBalance: 0,
      monthStartBankBalance: 0,
      bankBalanceChange: 0,
      pendingExpenses: 0,
      pendingCount: 0,
      pendingByProcessedDate: [],
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
            investments: '750',
            operating_expenses: '0',
            non_operating_expenses: '0',
            capital_returns: '0',
            salary_income: '0',
            operating_income: '0',
            non_operating_income: '0',
            card_repayments: '0',
            paired_card_expenses: '0',
            paired_card_repayments: '0',
          },
          {
            date: '2025-02-02',
            income: '0',
            expenses: '0',
            investments: '-130',
            operating_expenses: '0',
            non_operating_expenses: '0',
            capital_returns: '0',
            salary_income: '0',
            operating_income: '0',
            non_operating_income: '0',
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
            total_operating_income: '0',
            total_non_operating_income: '0',
            total_expenses: '0',
            total_operating_expenses: '0',
            total_non_operating_expenses: '0',
            investment_outflow: '750',
            investment_inflow: '130',
            total_accounts: '2',
          },
        ],
      },
      { rows: [] },
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
      totalOperatingIncome: 0,
      totalNonOperatingIncome: 0,
      totalExpenses: 0,
      totalOperatingExpenses: 0,
      totalNonOperatingExpenses: 0,
      totalCapitalReturns: 0,
      netBalance: 0,
      operatingNetBalance: 0,
      investmentOutflow: 750,
      investmentInflow: 130,
      netInvestments: 620,
      totalAccounts: 2,
      currentBankBalance: 0,
      monthStartBankBalance: 0,
      bankBalanceChange: 0,
      pendingExpenses: 0,
      pendingCount: 0,
      pendingByProcessedDate: [],
      pikkadonBalance: 0,
      checkingBalance: 0,
      pendingCCDebt: 0,
      availableBalance: 0,
    });
    expect(result.history).toMatchObject([
      {
        date: '2025-02-01',
        income: 0,
        expenses: 0,
        investments: 750,
        operatingExpenses: 0,
        nonOperatingExpenses: 0,
        capitalReturns: 0,
        salaryIncome: 0,
        operatingIncome: 0,
        nonOperatingIncome: 0,
        cardRepayments: 0,
        pairedCardExpenses: 0,
        pairedCardRepayments: 0,
        bankBalance: 0,
      },
      {
        date: '2025-02-02',
        income: 0,
        expenses: 0,
        investments: -130,
        operatingExpenses: 0,
        nonOperatingExpenses: 0,
        capitalReturns: 0,
        salaryIncome: 0,
        operatingIncome: 0,
        nonOperatingIncome: 0,
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
            total_operating_income: '1000',
            total_non_operating_income: '0',
            total_capital_returns: '300',
            total_expenses: '500',
            total_operating_expenses: '500',
            total_non_operating_expenses: '0',
            investment_outflow: '0',
            investment_inflow: '0',
            total_accounts: '1',
          },
        ],
      },
      { rows: [] },
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
      totalOperatingIncome: 1000,
      totalNonOperatingIncome: 0,
      totalExpenses: 500,
      totalOperatingExpenses: 500,
      totalNonOperatingExpenses: 0,
      totalCapitalReturns: 300,
      netBalance: 500, // income - expenses (capital returns excluded)
      operatingNetBalance: 500,
      pikkadonBalance: 0,
    });
  });

  it.each([
    ['daily', [
      { date: '2025-02-03', investments: 700 },
      { date: '2025-02-04', investments: -80 },
      { date: '2025-02-05', investments: 0 },
    ]],
    ['weekly', [{ date: '2025-02-03', investments: 620 }]],
    ['monthly', [{ date: '2025-02-01', investments: 620 }]],
  ])('aggregates investment outflows and inflows into %s history', async (aggregation, expected) => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE category_definitions (
          id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, name_fr TEXT,
          category_type TEXT, parent_id INTEGER, is_counted_as_income INTEGER
        );
        CREATE TABLE transactions (
          identifier TEXT, vendor TEXT, date TEXT, price REAL,
          category_definition_id INTEGER, account_number TEXT, is_pikadon_related INTEGER
        );
        CREATE TABLE transaction_pairing_exclusions (
          transaction_identifier TEXT, transaction_vendor TEXT, pairing_id INTEGER
        );
        CREATE TABLE account_pairings (
          id INTEGER PRIMARY KEY, is_active INTEGER, credit_card_vendor TEXT,
          credit_card_account_number TEXT
        );
        INSERT INTO category_definitions VALUES
          (1, 'Investments', 'Investments', NULL, 'investment', NULL, 1),
          (2, 'Salary', 'Salary', NULL, 'income', NULL, 1),
          (3, 'Food', 'Food', NULL, 'expense', NULL, 1),
          (4, 'Capital returns', 'Capital returns', NULL, 'income', NULL, 0);
        INSERT INTO transactions VALUES
          ('buy', 'bank', '2025-02-03', -750, 1, NULL, 0),
          ('sell-same-day', 'bank', '2025-02-03', 50, 1, NULL, 0),
          ('sell', 'bank', '2025-02-04', 80, 1, NULL, 0),
          ('salary', 'bank', '2025-02-03', 2000, 2, NULL, 0),
          ('food', 'card', '2025-02-05', -100, 3, NULL, 0),
          ('return', 'bank', '2025-02-03', 300, 4, NULL, 0),
          ('excluded', 'bank', '2025-02-03', -9000, 1, NULL, 0),
          ('pikadon', 'bank', '2025-02-03', -8000, 1, NULL, 1),
          ('outside-period', 'bank', '2025-01-31', -7000, 1, NULL, 0);
        INSERT INTO transaction_pairing_exclusions VALUES ('excluded', 'bank', NULL);
      `);
      queryMock.mockImplementation(async (sql: string, values: unknown[]) => {
        const parameters: Array<string | number | null> = [];
        const preparedSql = sql.replace(/\$(\d+)/g, (_match, index) => {
          const value = values[Number(index) - 1];
          parameters.push(value instanceof Date ? value.toISOString().slice(0, 10) : value as string);
          return '?';
        });
        return { rows: db.prepare(preparedSql).all(...parameters) };
      });

      const result = await getDashboardAnalytics({
        startDate: '2025-02-01',
        endDate: '2025-02-28',
        aggregation,
        includeBreakdowns: false,
        includeSummary: false,
      });

      expect(result.history.map(({ date, investments }: { date: string; investments: number }) => ({
        date,
        investments,
      }))).toEqual(expected);
      expect(result.history.reduce((total: number, row: { income: number }) => total + row.income, 0)).toBe(2000);
      expect(result.history.reduce((total: number, row: { expenses: number }) => total + row.expenses, 0)).toBe(100);
      expect(result.history.reduce((total: number, row: { capitalReturns: number }) => total + row.capitalReturns, 0)).toBe(300);
      for (const row of result.history) {
        expect(row.chartBreakdown.length).toBeGreaterThan(0);
        for (const field of [
          'income', 'expenses', 'investments', 'capitalReturns', 'cardRepayments',
          'pairedCardExpenses', 'pairedCardRepayments',
        ]) {
          expect(row.chartBreakdown.reduce((sum: number, segment: any) => sum + segment[field], 0)).toBe(row[field]);
        }
      }
    } finally {
      db.close();
    }
  });

  it.each(['daily', 'weekly', 'monthly'])('provides reconcilable leaf-category/vendor segments for lean %s history', async (aggregation) => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE category_definitions (
          id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, name_fr TEXT,
          category_type TEXT, parent_id INTEGER, is_counted_as_income INTEGER
        );
        CREATE TABLE transactions (
          identifier TEXT, vendor TEXT, date TEXT, price REAL,
          category_definition_id INTEGER, account_number TEXT, is_pikadon_related INTEGER
        );
        CREATE TABLE transaction_pairing_exclusions (
          transaction_identifier TEXT, transaction_vendor TEXT, pairing_id INTEGER
        );
        CREATE TABLE account_pairings (
          id INTEGER PRIMARY KEY, is_active INTEGER, credit_card_vendor TEXT,
          credit_card_account_number TEXT
        );
        INSERT INTO category_definitions VALUES
          (1, 'Investments', 'Investments', NULL, 'investment', NULL, 1),
          (2, 'Income', 'Income', NULL, 'income', NULL, 1),
          (3, 'Expenses', 'Expenses', NULL, 'expense', NULL, 1),
          (4, 'Capital returns', 'Capital returns', NULL, 'income', 2, 0),
          (5, 'Salary', 'Salary', NULL, 'income', 2, 1),
          (6, 'Food', 'Food', NULL, 'expense', 3, 1),
          (7, 'Groceries', 'Groceries', NULL, 'expense', 6, 1),
          (8, 'פרעון כרטיס אשראי', 'Credit Card Repayment', NULL, 'expense', 3, 1),
          (9, 'Securities', 'Securities', NULL, 'investment', 1, 1),
          (10, 'Property', 'Property', NULL, 'investment', 1, 1);
        INSERT INTO account_pairings VALUES (1, 1, 'card', '1234'), (2, 1, 'missing-card', NULL);
        INSERT INTO transactions VALUES
          ('buy', 'bank', '2025-02-03', -750, 9, NULL, 0),
          ('sell', 'bank', '2025-02-03', 50, 9, NULL, 0),
          ('withdrawal', 'bank', '2025-02-03', 80, 10, NULL, 0),
          ('salary', 'bank', '2025-02-03', 2000, 5, NULL, 0),
          ('food-paired', 'card', '2025-02-03', -100, 7, '1234', 0),
          ('food-unpaired-account', 'card', '2025-02-03', -30, 7, '9999', 0),
          ('food-unpaired-vendor', 'other-card', '2025-02-03', -50, 7, NULL, 0),
          ('return', 'bank', '2025-02-03', 300, 4, NULL, 0),
          ('unknown-expense', NULL, '2025-02-03', -20, NULL, NULL, 0),
          ('unknown-income', NULL, '2025-02-03', 40, NULL, NULL, 0),
          ('repayment-paired', 'bank', '2025-02-03', -100, 8, NULL, 0),
          ('repayment-unpaired', 'bank', '2025-02-03', -15, 8, NULL, 0),
          ('repayment-no-coverage', 'bank', '2025-02-03', -25, 8, NULL, 0),
          ('excluded', 'bank', '2025-02-03', -9000, 9, NULL, 0),
          ('pikadon', 'bank', '2025-02-03', -8000, 9, NULL, 1),
          ('outside-period', 'bank', '2025-01-31', -7000, 9, NULL, 0);
        INSERT INTO transaction_pairing_exclusions VALUES
          ('excluded', 'bank', NULL),
          ('repayment-paired', 'bank', 1),
          ('repayment-paired', 'bank', 1),
          ('repayment-no-coverage', 'bank', 2);
      `);
      queryMock.mockImplementation(async (sql: string, values: unknown[]) => {
        const parameters: Array<string | number | null> = [];
        const preparedSql = sql.replace(/\$(\d+)/g, (_match, index) => {
          const value = values[Number(index) - 1];
          parameters.push(value instanceof Date ? value.toISOString().slice(0, 10) : value as string);
          return '?';
        });
        return { rows: db.prepare(preparedSql).all(...parameters) };
      });

      const result = await getDashboardAnalytics({
        startDate: '2025-02-01',
        endDate: '2025-02-28',
        aggregation,
        includeBreakdowns: false,
        includeSummary: false,
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(result.history).toHaveLength(1);
      expect(result.history[0]).toMatchObject({
        date: aggregation === 'monthly' ? '2025-02-01' : '2025-02-03',
        income: 2040,
        expenses: 215,
        investments: 620,
        capitalReturns: 300,
        cardRepayments: 15,
        pairedCardExpenses: 100,
        pairedCardRepayments: 100,
      });
      const zeroMetrics = {
        income: 0, expenses: 0, investments: 0, capitalReturns: 0,
        cardRepayments: 0, pairedCardExpenses: 0, pairedCardRepayments: 0,
      };
      const segments = result.history[0].chartBreakdown;
      expect(segments).toHaveLength(8);
      expect(segments).toEqual(expect.arrayContaining([
        { ...zeroMetrics, categoryId: 9, categoryName: 'Securities', vendor: 'bank', investments: 700 },
        { ...zeroMetrics, categoryId: 10, categoryName: 'Property', vendor: 'bank', investments: -80 },
        { ...zeroMetrics, categoryId: 5, categoryName: 'Salary', vendor: 'bank', income: 2000 },
        { ...zeroMetrics, categoryId: 7, categoryName: 'Groceries', vendor: 'card', expenses: 130, pairedCardExpenses: 100 },
        { ...zeroMetrics, categoryId: 7, categoryName: 'Groceries', vendor: 'other-card', expenses: 50 },
        { ...zeroMetrics, categoryId: 4, categoryName: 'Capital returns', vendor: 'bank', capitalReturns: 300 },
        { ...zeroMetrics, categoryId: null, categoryName: null, vendor: null, income: 40, expenses: 20 },
        { ...zeroMetrics, categoryId: 8, categoryName: 'פרעון כרטיס אשראי', vendor: 'bank', expenses: 15, cardRepayments: 15, pairedCardRepayments: 100 },
      ]));
      for (const field of Object.keys(zeroMetrics)) {
        expect(segments.reduce((sum: number, segment: any) => sum + segment[field], 0)).toBe(result.history[0][field]);
      }
      expect(result.breakdowns.byCategory).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('respects false query flags passed as strings', async () => {
    mockQuerySequence([
      {
        rows: [
          {
            date: '2025-03-01',
            income: '10',
            expenses: '3',
            operating_expenses: '3',
            non_operating_expenses: '0',
            capital_returns: '0',
            salary_income: '0',
            operating_income: '0',
            non_operating_income: '10',
            card_repayments: '0',
            paired_card_expenses: '0',
            paired_card_repayments: '0',
          },
        ],
      },
    ]);

    const result = await getDashboardAnalytics({
      startDate: '2025-03-01',
      endDate: '2025-03-31',
      includeBreakdowns: 'false',
      includeSummary: 'false',
      noCache: '1',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result.history).toMatchObject([
      {
        date: '2025-03-01',
        income: 10,
        expenses: 3,
        investments: 0,
        operatingExpenses: 3,
        nonOperatingExpenses: 0,
        capitalReturns: 0,
        salaryIncome: 0,
        operatingIncome: 0,
        nonOperatingIncome: 10,
        cardRepayments: 0,
        pairedCardExpenses: 0,
        pairedCardRepayments: 0,
      },
    ]);
    expect(result.summary).toMatchObject({
      totalIncome: 0,
      totalOperatingIncome: 0,
      totalNonOperatingIncome: 0,
      totalExpenses: 0,
      totalOperatingExpenses: 0,
      totalNonOperatingExpenses: 0,
      pendingCCDebt: 0,
    });
    expect(result.breakdowns.byCategory).toEqual([]);
    expect(result.breakdowns.byVendor).toEqual([]);
    expect(result.breakdowns.byMonth).toEqual([]);
    expect(result.breakdowns.byBankAccount).toEqual([]);
  });
});
