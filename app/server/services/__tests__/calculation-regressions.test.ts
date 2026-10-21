// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dashboard = require('../analytics/dashboard.js');
const budgets = require('../budgets.js');
const performance = require('../investments/performance.js');

let db: DatabaseSync;
let query: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE category_definitions (
      id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, name_fr TEXT,
      category_type TEXT, parent_id INTEGER, is_counted_as_income INTEGER DEFAULT 1
    );
    CREATE TABLE transactions (
      identifier TEXT, vendor TEXT DEFAULT 'card', date TEXT, price REAL,
      category_definition_id INTEGER, account_number TEXT, is_pikadon_related INTEGER DEFAULT 0,
      processed_date TEXT, processed_datetime TEXT, transaction_datetime TEXT,
      status TEXT DEFAULT 'completed', name TEXT, memo TEXT, category_type TEXT,
      original_currency TEXT DEFAULT 'ILS', charged_currency TEXT DEFAULT 'ILS'
    );
    CREATE TABLE transaction_pairing_exclusions (
      transaction_identifier TEXT, transaction_vendor TEXT, pairing_id INTEGER
    );
    CREATE TABLE account_pairings (
      id INTEGER PRIMARY KEY, is_active INTEGER, credit_card_vendor TEXT,
      credit_card_account_number TEXT
    );
    CREATE TABLE vendor_credentials (vendor TEXT, institution_id INTEGER);
    CREATE TABLE institution_nodes (
      id INTEGER, node_type TEXT, display_name_he TEXT, display_name_en TEXT,
      logo_url TEXT, institution_type TEXT, vendor_code TEXT
    );
    CREATE TABLE category_budgets (
      id INTEGER PRIMARY KEY, category_definition_id INTEGER, period_type TEXT,
      budget_limit REAL, is_active INTEGER DEFAULT 1
    );
    CREATE TABLE investment_accounts (
      id INTEGER PRIMARY KEY, account_name TEXT, account_type TEXT,
      is_active INTEGER DEFAULT 1, institution_id INTEGER, currency TEXT DEFAULT 'ILS'
    );
    CREATE TABLE investment_holdings (
      account_id INTEGER, as_of_date TEXT, current_value REAL, cost_basis REAL,
      holding_type TEXT, return_transaction_id TEXT, return_transaction_vendor TEXT
    );
    CREATE TABLE transaction_account_links (
      account_id INTEGER, transaction_identifier TEXT, transaction_vendor TEXT
    );
    CREATE TABLE investment_positions (id INTEGER PRIMARY KEY, account_id INTEGER, currency TEXT);
    CREATE TABLE investment_position_events (
      id INTEGER PRIMARY KEY, position_id INTEGER, effective_date TEXT, event_type TEXT,
      amount REAL, principal_amount REAL, income_amount REAL, fee_amount REAL, tax_amount REAL,
      realized_gain_loss REAL, reinvested INTEGER,
      linked_transaction_identifier TEXT, linked_transaction_vendor TEXT
    );
    INSERT INTO category_definitions (id, name, name_en, category_type, parent_id) VALUES
      (1, 'Expenses', 'Expenses', 'expense', NULL),
      (2, 'Shopping', 'Shopping', 'expense', 1),
      (3, 'Clothing', 'Clothing', 'expense', 2),
      (4, 'Salary', 'Salary', 'income', NULL),
      (5, 'Investments', 'Investments', 'investment', NULL),
      (6, 'Fees', 'Bank settlement', 'expense', 1);
    INSERT INTO account_pairings VALUES (1, 1, 'card', NULL);
    INSERT INTO category_budgets VALUES (1, 2, 'monthly', 200, 1);
    INSERT INTO investment_accounts (id, account_name, account_type) VALUES (7, 'Broker', 'brokerage');
    INSERT INTO investment_positions VALUES (1, 7, 'ILS');
  `);
  // Use the production adapter's parameter ordering and ISO Date serialization.
  query = vi.fn(async (sql: string, values: any[] = []) => {
    const parameters: any[] = [];
    const preparedSql = sql.replace(/\$(\d+)/g, (_match, index) => {
      const value = values[Number(index) - 1];
      parameters.push(value instanceof Date ? value.toISOString() : value);
      return '?';
    });
    const rows = db.prepare(preparedSql).all(...parameters);
    return { rows, rowCount: rows.length };
  });
  const database = { query, getClient: async () => ({ query, release() {} }) };
  dashboard.__setDatabase(database);
  budgets.__setDatabase(database);
  performance.__setDatabase(database);
});

afterEach(() => {
  dashboard.__resetDatabase();
  budgets.__resetDatabase();
  performance.__resetDatabase();
  db.close();
  vi.useRealTimers();
});

function transaction(id: string, price: number, category = 3, date = '2026-09-10T12:00:00.000Z') {
  db.prepare(`INSERT INTO transactions (identifier, price, category_definition_id, date)
    VALUES (?, ?, ?, ?)`).run(id, price, category, date);
}

async function getDashboard(aggregation = 'daily') {
  return dashboard.getDashboardAnalytics({
    startDate: '2026-09-01', endDate: '2026-09-30T23:59:59.999Z',
    aggregation, noCache: true,
  });
}

describe('signed refund calculations', () => {
  it('counts each vendor transaction once with multiple saved connections', async () => {
    transaction('purchase', -100);
    transaction('refund', 40);
    db.exec(`
      INSERT INTO institution_nodes (id, node_type, display_name_en) VALUES (1, 'institution', 'Card bank');
      INSERT INTO vendor_credentials VALUES ('card', 1), ('card', 1);
    `);
    const result = await getDashboard();
    expect(result.summary.totalExpenses).toBe(60);
    expect(result.breakdowns.byVendor).toMatchObject([{
      vendor: 'card', count: 2, total: 60, institution: { id: 1 },
    }]);
    expect(result.breakdowns.byVendor).toHaveLength(1);
  });

  it('keeps one vendor total without guessing between conflicting institutions', async () => {
    transaction('purchase', -100);
    db.exec(`
      INSERT INTO institution_nodes (id, node_type) VALUES (1, 'institution'), (2, 'institution');
      INSERT INTO vendor_credentials VALUES ('card', 1), ('card', 2);
    `);
    const result = await getDashboard();
    expect(result.breakdowns.byVendor).toEqual([{ vendor: 'card', count: 1, total: 100, institution: null }]);
    expect(result.summary.totalExpenses).toBe(100);
  });

  it.each([40, 100, 150])('nets a refund of %s across dashboard totals and descendant-category budgets', async (refund) => {
    transaction('purchase', -100);
    transaction('refund', refund);
    transaction('salary', 1000, 4);
    transaction('investment', -500, 5);
    transaction('excluded-purchase', -9000);
    transaction('excluded-refund', 8000);
    transaction('outside-period', 7000, 3, '2026-10-01T12:00:00Z');
    db.exec(`INSERT INTO transaction_pairing_exclusions VALUES
      ('excluded-purchase', 'card', NULL), ('excluded-refund', 'card', NULL)`);
    const net = 100 - refund;

    for (const aggregation of ['daily', 'weekly', 'monthly']) {
      const result = await getDashboard(aggregation);
      expect(result.summary).toMatchObject({
        totalIncome: 1000, totalExpenses: net, totalOperatingExpenses: net,
        totalNonOperatingExpenses: 0, netBalance: 1000 - net,
      });
      expect(result.history.reduce((sum: number, row: any) => sum + row.expenses, 0)).toBe(net);
      expect(result.history.reduce((sum: number, row: any) => sum + row.pairedCardExpenses, 0)).toBe(net);
      for (const row of result.history) {
        expect(row.chartBreakdown.reduce((sum: number, segment: any) => sum + segment.expenses, 0)).toBe(row.expenses);
      }
      expect(result.breakdowns.byCategory.reduce((sum: number, row: any) => sum + row.total, 0)).toBe(net);
      expect(result.breakdowns.byVendor.reduce((sum: number, row: any) => sum + row.total, 0)).toBe(net);
      expect(result.breakdowns.byMonth).toEqual([{ month: '2026-09', income: 1000, expenses: net }]);
    }
    expect(await budgets.listBudgetUsage()).toMatchObject([{
      spent: net, remaining: 200 - net, percentage: Math.max(0, net / 2), status: 'good',
    }]);
  });

  it('records a refund in the period received, without changing income or gross pending payments', async () => {
    transaction('prior-purchase', -100, 3, '2026-08-31T12:00:00Z');
    transaction('refund', 100);
    transaction('fee', -30, 6);
    transaction('fee-refund', 10, 6);
    transaction('pending-purchase', -25);
    transaction('pending-refund', 5);
    db.exec("UPDATE transactions SET processed_date = '2099-10-01' WHERE identifier LIKE 'pending-%'");
    const result = await getDashboard();
    expect(result.summary).toMatchObject({
      totalIncome: 0, totalExpenses: -60, totalOperatingExpenses: -80,
      totalNonOperatingExpenses: 20, pendingExpenses: 25, pendingCount: 1,
      // The existing gross debt calculation also includes the prior purchase.
      pendingCCDebt: 155,
    });
    expect(await budgets.listBudgetUsage()).toMatchObject([{
      spent: -80, remaining: 280, percentage: 0, status: 'good',
    }]);
  });

  it('nets refunds in the category-name fallback and preserves warning/exceeded thresholds', async () => {
    transaction('purchase', -300);
    transaction('refund', 130);
    // Legacy callers can supply a category name without an ID in the usage row.
    const queryWithNameFallback = async (sql: string, values: any[]) => {
      const result = await query(sql, values);
      if (sql.includes('FROM category_budgets cb')) {
        result.rows = result.rows.map((row: any) => ({ ...row, category_definition_id: null }));
      }
      return result;
    };
    budgets.__setDatabase({ getClient: async () => ({ query: queryWithNameFallback, release() {} }) });
    expect(await budgets.listBudgetUsage()).toMatchObject([{
      spent: 170, remaining: 30, percentage: 85, status: 'warning',
    }]);
    db.exec("UPDATE transactions SET price = 50 WHERE identifier = 'refund'");
    expect(await budgets.listBudgetUsage()).toMatchObject([{
      spent: 250, remaining: -50, percentage: 100, status: 'exceeded',
    }]);
  });
});

function portfolio(history: any[], accounts = [{ accountId: 7, history }]) {
  performance.__setHistoryService({ getInvestmentHistory: async () => ({
    startDate: history[0].date, history, accounts,
    fx: { baseCurrency: 'ILS', complete: true },
  }) });
}

function linkedTransaction(id: string, price: number, date: string) {
  transaction(id, price, 5, date);
  db.prepare('INSERT INTO transaction_account_links VALUES (7, ?, ?)').run(id, 'card');
}

describe('investment opening valuation boundary', () => {
  it.each([true, false])('does not count an opening deposit twice (observed valuations: %s)', async (observed) => {
    const history = [
      { date: '2026-08-31', currentValue: 1000, ...(observed ? { isActualValuation: true } : {}) },
      { date: '2026-09-30', currentValue: 1000, ...(observed ? { isActualValuation: true } : {}) },
    ];
    // Account-level evidence still proves the opening flow is already included
    // when aggregate history lacks the provenance needed for daily-linked TWR.
    portfolio(history, [{ accountId: 7, history: history.map((point) => ({ ...point, isActualValuation: true })) }]);
    linkedTransaction('opening-deposit', -1000, '2026-08-31T23:59:59Z');
    const result = await performance.getInvestmentPerformance({ assetScope: 'all' });
    expect(result).toMatchObject({
      startValue: 1000, endValue: 1000, marketMove: 0, twr: 0,
      netFlows: { contributions: 0, withdrawals: 0 },
      method: observed ? 'daily_linked_return' : 'modified_dietz',
    });
    expect(result.mwr).toBeCloseTo(0, 8);
    expect(result.timeline[0]).toMatchObject({ netFlow: 0, marketMove: 0, contributions: 0 });
  });

  it('excludes opening flows and their FX requirements while retaining later and closing flows', async () => {
    portfolio([
      { date: '2026-09-01', currentValue: 1000, isActualValuation: true },
      { date: '2026-09-02', currentValue: 1100, isActualValuation: true },
      { date: '2026-09-03', currentValue: 1150, isActualValuation: true },
    ]);
    linkedTransaction('opening-withdrawal', 500, '2026-09-01T12:00:00Z');
    linkedTransaction('opening-return', 200, '2026-09-01');
    linkedTransaction('later-deposit', -100, '2026-09-02');
    linkedTransaction('after-closing', -9000, '2026-09-04');
    db.exec(`
      UPDATE transactions SET charged_currency = 'USD' WHERE identifier LIKE 'opening-%';
      UPDATE investment_accounts SET currency = 'USD' WHERE id = 7;
      INSERT INTO investment_holdings VALUES (7, '2026-09-01', 200, 190, 'pikadon', 'opening-return', 'card');
      INSERT INTO investment_positions VALUES (2, 7, 'USD');
      INSERT INTO investment_position_events
        (id, position_id, effective_date, event_type, amount, realized_gain_loss) VALUES
        (1, 2, '2026-09-01', 'deposit', 300, NULL),
        (2, 2, '2026-09-01', 'sell', 200, 50),
        (3, 1, '2026-09-03', 'deposit', 50, NULL),
        (4, 1, '2026-09-04', 'deposit', 9000, NULL);
    `);
    const result = await performance.getInvestmentPerformance({
      assetScope: 'all', normalizeCurrencies: true, includePositionEvents: true,
    });
    expect(result).toMatchObject({
      marketMove: 0, twr: 0, netFlows: { contributions: 150, withdrawals: 0 },
      capitalReturns: 0, income: 0, method: 'daily_linked_return',
      attribution: { realizedGainGross: null, realizedGainNet: null },
      flowCoverage: { includedLinkedTransactionCount: 1, positionEventCount: 1, missingFxCount: 0 },
    });
    expect(result.mwr).toBeCloseTo(0, 7);
    expect(result.timeline.map((point: any) => point.contributions)).toEqual([0, 100, 50]);
  });

  it('includes closing-day deposit returns and keeps the opening day out of attribution', async () => {
    portfolio([
      { date: '2026-09-01', currentValue: 1000, isActualValuation: true },
      { date: '2026-09-03', currentValue: 800 },
    ]);
    linkedTransaction('opening-return', 600, '2026-09-01');
    linkedTransaction('closing-return', 200, '2026-09-03T12:00:00Z');
    db.exec(`INSERT INTO investment_holdings VALUES
      (7, '2026-09-01', 600, 590, 'pikadon', 'opening-return', 'card'),
      (7, '2026-09-03', 200, 190, 'pikadon', 'closing-return', 'card')`);
    const result = await performance.getInvestmentPerformance({ assetScope: 'all' });
    expect(result).toMatchObject({ capitalReturns: 190, income: 10, marketMove: 0, twr: 0 });
    expect(result.mwr).toBeCloseTo(0, 7);
    expect(result.timeline[0]).toMatchObject({ capitalReturns: 0, income: 0, marketMove: 0 });
  });

  it('retains the opening deposit when the opening balance was carried forward', async () => {
    portfolio([
      { date: '2026-09-01', currentValue: 6000, isActualValuation: false },
      { date: '2026-09-17', currentValue: 14500, isActualValuation: true },
    ]);
    linkedTransaction('opening-deposit', -2000, '2026-09-01T21:00:00Z');
    const result = await performance.getInvestmentPerformance({ assetScope: 'all', normalizeCurrencies: true });
    expect(result).toMatchObject({
      netFlows: { contributions: 2000 }, marketMove: 6500,
      twr: 6500 / 8000, method: 'modified_dietz', quality: 'estimated',
    });
    expect(result.timeline[0].contributions).toBe(2000);
    expect(result.confidence.reasons).toContain('period_boundaries_not_observed');
  });

  it('uses each account opening valuation in a mixed portfolio', async () => {
    const openingDate = '2026-09-01';
    portfolio([
      { date: openingDate, currentValue: 2000, isActualValuation: false },
      { date: '2026-09-03', currentValue: 2100, isActualValuation: true },
    ], [
      { accountId: 7, history: [{ date: openingDate, currentValue: 1000, isActualValuation: true }] },
      { accountId: 8, history: [{ date: openingDate, currentValue: 1000, isActualValuation: false }] },
    ]);
    linkedTransaction('included-in-snapshot', -500, openingDate);
    linkedTransaction('not-in-snapshot', -100, openingDate);
    db.exec("UPDATE transaction_account_links SET account_id = 8 WHERE transaction_identifier = 'not-in-snapshot'");
    const result = await performance.getInvestmentPerformance({ assetScope: 'all' });
    expect(result).toMatchObject({ netFlows: { contributions: 100 }, marketMove: 0, twr: 0 });
  });

  it('retains opening withdrawals, deposit returns and position events against a carried balance', async () => {
    portfolio([
      { date: '2026-09-01', currentValue: 1000, isActualValuation: false },
      { date: '2026-09-03', currentValue: 750, isActualValuation: true },
    ]);
    linkedTransaction('withdrawal', 100, '2026-09-01');
    linkedTransaction('return', 200, '2026-09-01');
    db.exec(`
      INSERT INTO investment_holdings VALUES (7, '2026-09-01', 200, 190, 'pikadon', 'return', 'card');
      INSERT INTO investment_position_events (id, position_id, effective_date, event_type, amount)
        VALUES (1, 1, '2026-09-01', 'deposit', 50);
    `);
    const result = await performance.getInvestmentPerformance({ assetScope: 'all', includePositionEvents: true });
    expect(result).toMatchObject({
      netFlows: { contributions: 50, withdrawals: 100 }, capitalReturns: 190, income: 10,
      marketMove: 0, twr: 0,
    });
    expect(result.mwr).toBeCloseTo(0, 7);
  });

  it('withholds a return when opening-flow valuation evidence is missing', async () => {
    portfolio([{ date: '2026-09-01', currentValue: 1000 }, { date: '2026-09-03', currentValue: 1000 }]);
    linkedTransaction('ambiguous-deposit', -1000, '2026-09-01');
    const result = await performance.getInvestmentPerformance({ assetScope: 'all' });
    expect(result).toMatchObject({ twr: null, mwr: null, method: 'unavailable' });
    expect(result.confidence.reasons).toContain('opening_flow_valuation_unknown');
  });

  it('does not infer an individual account is carried from an aggregate carried marker', async () => {
    portfolio([
      { date: '2026-09-01', currentValue: 1000, isActualValuation: false },
      { date: '2026-09-03', currentValue: 1100, isActualValuation: true },
    ], [{ accountId: 7, history: [] }]);
    linkedTransaction('ambiguous-deposit', -100, '2026-09-01');
    const result = await performance.getInvestmentPerformance({ assetScope: 'all' });
    expect(result).toMatchObject({ twr: null, method: 'unavailable' });
    expect(result.confidence.reasons).toContain('opening_flow_valuation_unknown');
  });

  it('does not guess the allocation of an opening transaction linked to mixed valuations', async () => {
    portfolio([
      { date: '2026-09-01', currentValue: 2000, isActualValuation: false },
      { date: '2026-09-03', currentValue: 2100, isActualValuation: true },
    ], [
      { accountId: 7, history: [{ date: '2026-09-01', currentValue: 1000, isActualValuation: true }] },
      { accountId: 8, history: [{ date: '2026-09-01', currentValue: 1000, isActualValuation: false }] },
    ]);
    linkedTransaction('shared-deposit', -100, '2026-09-01');
    db.exec("INSERT INTO transaction_account_links VALUES (8, 'shared-deposit', 'card')");
    const result = await performance.getInvestmentPerformance({ assetScope: 'all' });
    expect(result).toMatchObject({ twr: null, mwr: null, method: 'unavailable' });
    expect(result.confidence.reasons).toContain('opening_flow_valuation_unknown');
  });
});
