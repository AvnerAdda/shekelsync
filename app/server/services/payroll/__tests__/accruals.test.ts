import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchPayrollAccrualRows, buildAccrualRows } = require('../accruals.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PAYROLL_TABLE_STATEMENTS } = require('../schema.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  applyContributionRollforward,
  appendContributionHistory,
} = require('../../investments/linked-transaction-rollforward.js');

function sqliteAdapter(db: DatabaseSync) {
  return {
    async query(sql: string, params: unknown[] = []) {
      const bindings: any[] = [];
      const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => {
        bindings.push(params[Number(index) - 1] ?? null);
        return '?';
      });
      return { rows: db.prepare(sqliteSql).all(...bindings) };
    },
  };
}

// Israel is UTC+3 in summer: a deposit stored as 21:00Z belongs to the next local day.
const deposits = [
  ['s-aug', 'hapoalim', '111', '2026-07-31T21:00:00.000Z', 'משכורת אינטל 07/26', 18000],
  ['s-sep', 'hapoalim', '111', '2026-08-31T21:00:00.000Z', 'משכורת אינטל 08/26', 18000],
  ['s-sep-bonus', 'hapoalim', '111', '2026-09-19T21:00:00.000Z', 'משכורת אינטל בונוס', 5000],
  ['s-oct', 'hapoalim', '111', '2026-09-30T21:00:00.000Z', 'משכורת אינטל 09/26', 18100],
  ['s-nov', 'hapoalim', '111', '2026-10-31T22:00:00.000Z', 'משכורת אינטל 10/26', 18100],
  ['other-bank', 'leumi', '999', '2026-09-30T21:00:00.000Z', 'משכורת אינטל', 18000],
  ['wife', 'leumi', '222', '2026-09-30T21:00:00.000Z', 'WIX COM LTD', 14000],
];

describe('payroll accruals', () => {
  let db: DatabaseSync;
  let client: ReturnType<typeof sqliteAdapter>;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE investment_accounts (id INTEGER PRIMARY KEY, account_type TEXT, currency TEXT);
      CREATE TABLE transactions (
        identifier TEXT, vendor TEXT, account_number TEXT, date TEXT, transaction_datetime TEXT, name TEXT, price REAL
      );
      INSERT INTO investment_accounts VALUES (7, 'pension', 'ILS'), (8, 'provident', 'ILS'), (10, 'provident', 'USD');
    `);
    for (const statement of PAYROLL_TABLE_STATEMENTS) db.exec(statement);
    db.exec(`
      INSERT INTO household_employment (id, member, gross_monthly, salary_match_pattern, salary_match_vendor, salary_match_account_number, is_active)
        VALUES (1, 'self', 20000, 'משכורת אינטל', 'hapoalim', '111', 1),
               (2, 'spouse', 15000, 'wix com ltd', 'leumi', '222', 0);
      INSERT INTO payroll_contribution_plans (id, employment_id, kind, account_id, employee_pct, employer_pct, salary_cap, start_date, is_active) VALUES
        (11, 1, 'pension', 7, 6, 6.5, NULL, '2026-08-01', 1),
        (12, 1, 'severance', 7, 0, 6, NULL, '2026-08-01', 1),
        (13, 1, 'keren_hishtalmut', 8, 2.5, 7.5, 15712, '2026-09-15', 1),
        (14, 2, 'keren_hishtalmut', 10, 2.5, 7.5, NULL, '2026-08-01', 1),
        (15, 2, 'pension', 7, 6, 6.5, NULL, '2026-08-01', 1);
    `);
    const insert = db.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, NULL, ?, ?)');
    deposits.forEach((row) => insert.run(...row));
    client = sqliteAdapter(db);
  });

  afterEach(() => {
    db.close();
  });

  it('accrues one contribution per plan for each month the salary arrives', async () => {
    const rows = await fetchPayrollAccrualRows(client, [7, 8, 10]);
    const summary = rows.map((row: any) => [row.account_id, row.payroll_kind, row.identifier, row.price]);
    expect(summary).toEqual([
      [7, 'pension', 'payroll:11:2026-08', -2500],
      [7, 'severance', 'payroll:12:2026-08', -1200],
      [7, 'pension', 'payroll:11:2026-09', -2500],
      [7, 'severance', 'payroll:12:2026-09', -1200],
      [7, 'pension', 'payroll:11:2026-10', -2500],
      [7, 'severance', 'payroll:12:2026-10', -1200],
      [7, 'pension', 'payroll:11:2026-11', -2500],
      [7, 'severance', 'payroll:12:2026-11', -1200],
      // KH starts 2026-09-15, after September's salary; capped at 15,712.
      [8, 'keren_hishtalmut', 'payroll:13:2026-10', -1571.2],
      [8, 'keren_hishtalmut', 'payroll:13:2026-11', -1571.2],
    ]);
    expect(rows[0]).toMatchObject({
      vendor: 'payroll_estimate',
      category_type: 'investment',
      is_estimated: 1,
      payroll_member: 'self',
      payroll_employee_amount: 1200,
      payroll_employer_amount: 1300,
      salary_transaction_identifier: 's-aug',
      original_currency: 'ILS',
    });
  });

  it('respects the requested date range', async () => {
    const rows = await fetchPayrollAccrualRows(client, [7], { startDate: '2026-09-01', endDate: '2026-10-31' });
    expect(rows.map((row: any) => row.identifier)).toEqual([
      'payroll:11:2026-09', 'payroll:12:2026-09', 'payroll:11:2026-10', 'payroll:12:2026-10',
    ]);
  });

  it('returns nothing without plans, accounts or payroll tables', async () => {
    expect(await fetchPayrollAccrualRows(client, [])).toEqual([]);
    expect(await fetchPayrollAccrualRows(client, [99])).toEqual([]);
    const bare = new DatabaseSync(':memory:');
    try {
      expect(await fetchPayrollAccrualRows(sqliteAdapter(bare), [7])).toEqual([]);
    } finally {
      bare.close();
    }
  });

  it('skips plans that cannot accrue', () => {
    const base = {
      plan_id: 1, kind: 'pension', account_id: 7, employee_pct: 6, employer_pct: 6.5, salary_cap: null,
      start_date: '2026-01-01', plan_is_active: 1, employment_id: 1, member: 'self', gross_monthly: 20000,
      salary_match_pattern: 'salary', employment_is_active: 1, account_currency: 'ILS',
    };
    const salary = [{ identifier: 'x', vendor: 'v', date: '2026-05-01T09:00:00.000Z', name: 'SALARY', price: 100 }];
    expect(buildAccrualRows([base], salary)).toHaveLength(1);
    expect(buildAccrualRows([{ ...base, gross_monthly: 0 }], salary)).toHaveLength(0);
    expect(buildAccrualRows([{ ...base, salary_match_pattern: null }], salary)).toHaveLength(0);
    expect(buildAccrualRows([{ ...base, start_date: null }], salary)).toHaveLength(0);
    expect(buildAccrualRows([{ ...base, account_currency: 'USD' }], salary)).toHaveLength(0);
    expect(buildAccrualRows([{ ...base, employee_pct: 0, employer_pct: 0 }], salary)).toHaveLength(0);
  });

  describe('roll-forward of estimates', () => {
    it('adds estimates after the statement without moving its date', async () => {
      const rows = await fetchPayrollAccrualRows(client, [7, 8], { endDate: '2026-10-31' });
      const accounts = [
        { id: 7, current_value: 100000, cost_basis: 80000, as_of_date: '2026-09-15' },
        { id: 8, current_value: null, cost_basis: null, as_of_date: null },
      ];
      applyContributionRollforward(accounts, rows);
      expect(accounts[0]).toMatchObject({
        current_value: 103700,
        cost_basis: 83700,
        as_of_date: '2026-09-15',
        estimated_contribution_adjustment: 3700,
        estimated_contribution_count: 2,
        estimated_contribution_since: '2026-09-15',
        estimated_contribution_through: '2026-10-01',
      });
      expect(accounts[0]).not.toHaveProperty('linked_contribution_adjustment');
      // No statement yet: estimates alone would misstate the balance.
      expect(accounts[1]).toEqual({ id: 8, current_value: null, cost_basis: null, as_of_date: null });
    });

    it('still advances the date for real linked deposits alongside estimates', async () => {
      const rows = await fetchPayrollAccrualRows(client, [7], { endDate: '2026-10-31' });
      const linkedDeposit = {
        account_id: 7, identifier: 'bank-1', vendor: 'hapoalim', date: '2026-10-10T09:00:00.000Z', price: -500, category_type: 'investment', name: 'הפקדה',
      };
      const accounts = [{ id: 7, current_value: 100000, cost_basis: 100000, as_of_date: '2026-09-15' }];
      applyContributionRollforward(accounts, [...rows, linkedDeposit]);
      expect(accounts[0]).toMatchObject({
        current_value: 104200,
        as_of_date: '2026-10-10',
        linked_contribution_adjustment: 500,
        estimated_contribution_adjustment: 3700,
      });
    });

    it('marks history points that include estimates as non-valuations', async () => {
      const rows = await fetchPayrollAccrualRows(client, [7], { endDate: '2026-10-31' });
      const points = [{ date: '2026-09-15', currentValue: 100000, costBasis: 80000, isActualValuation: true }];
      const augmented = appendContributionHistory(points, rows);
      expect(augmented.map((point: any) => [point.date, point.currentValue, point.isActualValuation, point.estimatedContributionTotal]))
        .toEqual([
          ['2026-09-15', 100000, true, undefined],
          ['2026-10-01', 103700, false, 3700],
        ]);
    });
  });
});

describe('cost-basis carry between statements', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { computeCostBasisCarry, applyCostBasisCarryToHistory, fetchStatementCostHistory } = require('../accruals.js');
  const estimate = (date: string, amount: number) => ({
    account_id: 6, is_estimated: 1, date: `${date}T09:00:00.000Z`, price: -amount,
  });

  it('carries contributions into a statement that repeats the previous cost basis', () => {
    const statements = new Map([[6, [
      { date: '2026-10-29', costBasis: 112000 },
      { date: '2026-11-08', costBasis: 112000 },
    ]]]);
    const carries = computeCostBasisCarry(statements, [
      estimate('2026-10-05', 999), // before the first statement: ignored
      estimate('2026-11-05', 1178.4),
      estimate('2026-12-05', 1178.4), // after the latest statement: roll-forward's job
    ]);
    expect(carries.get(6)).toEqual({
      carry: 1178.4,
      statementDate: '2026-11-08',
      schedule: [{ date: '2026-10-29', carry: 0 }, { date: '2026-11-08', carry: 1178.4 }],
    });
  });

  it('trusts a hand-edited cost basis and restarts the carry from it', () => {
    const statements = new Map([[6, [
      { date: '2026-08-01', costBasis: 100000 },
      { date: '2026-09-01', costBasis: 100000 },
      { date: '2026-10-01', costBasis: 105000 },
      { date: '2026-11-01', costBasis: 105000 },
    ]]]);
    const carries = computeCostBasisCarry(statements, [
      estimate('2026-08-15', 1000),
      estimate('2026-09-15', 1000),
      estimate('2026-10-15', 1000),
    ]);
    expect(carries.get(6).schedule.map((entry: any) => entry.carry)).toEqual([0, 1000, 0, 1000]);
    expect(carries.get(6).carry).toBe(1000);
  });

  it('ignores accounts without estimates or without a cost basis', () => {
    const statements = new Map([[6, [{ date: '2026-10-01', costBasis: null }, { date: '2026-11-01', costBasis: null }]]]);
    expect(computeCostBasisCarry(statements, [estimate('2026-10-15', 1000)]).size).toBe(0);
    expect(computeCostBasisCarry(new Map(), [estimate('2026-10-15', 1000)]).size).toBe(0);
    expect(computeCostBasisCarry(statements, []).size).toBe(0);
  });

  it('applies the carry to history points from their statement onwards', () => {
    const points = [
      { date: '2026-10-29', currentValue: 127307, costBasis: 112000 },
      { date: '2026-11-08', currentValue: 125507, costBasis: 112000 },
    ];
    const carried = applyCostBasisCarryToHistory(points, [
      { date: '2026-10-29', carry: 0 }, { date: '2026-11-08', carry: 1178.4 },
    ]);
    expect(carried[0]).toBe(points[0]);
    expect(carried[1]).toMatchObject({ costBasis: 113178.4, estimatedCostBasisCarry: 1178.4 });
    expect(carried[1].roi).toBeCloseTo(((125507 - 113178.4) / 113178.4) * 100, 6);
  });

  it('reads statement totals per date, excluding pikadon holdings', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE investment_holdings (account_id INTEGER, as_of_date TEXT, cost_basis REAL, holding_type TEXT, status TEXT);
        INSERT INTO investment_holdings VALUES
          (6, '2026-10-29', 112000, 'standard', 'active'),
          (6, '2026-11-08T10:00:00Z', 100000, 'standard', 'active'),
          (6, '2026-11-08', 12000, NULL, NULL),
          (6, '2026-11-08', 5000, 'pikadon', 'active'),
          (7, '2026-10-29', NULL, 'standard', 'active');
      `);
      const history = await fetchStatementCostHistory(sqliteAdapter(db), [6, 7]);
      expect(history.get(6)).toEqual([
        { date: '2026-10-29', costBasis: 112000 },
        { date: '2026-11-08', costBasis: 112000 },
      ]);
      expect(history.get(7)).toEqual([{ date: '2026-10-29', costBasis: null }]);
    } finally {
      db.close();
    }
  });

describe('keren hishtalmut liquidity', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fetchKerenHishtalmutLiquidity } = require('../accruals.js');

  it('returns the earliest withdrawal date per linked account', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE investment_accounts (id INTEGER PRIMARY KEY, currency TEXT);
        INSERT INTO investment_accounts VALUES (6, 'ILS'), (7, 'ILS'), (9, 'ILS');`);
      for (const statement of PAYROLL_TABLE_STATEMENTS) db.exec(statement);
      db.exec(`
        INSERT INTO household_employment (id, member, is_active) VALUES (1, 'self', 1), (2, 'spouse', 1);
        INSERT INTO payroll_contribution_plans (employment_id, kind, account_id, start_date, opened_date, is_active) VALUES
          (1, 'keren_hishtalmut', 6, '2022-02-01', NULL, 1),
          (2, 'keren_hishtalmut', 6, '2023-01-01', '2018-05-01', 1),
          (1, 'pension', 7, '2022-02-01', NULL, 1),
          (2, 'pension', 9, '2022-02-01', NULL, 0);
      `);
      const liquidity = await fetchKerenHishtalmutLiquidity(sqliteAdapter(db), [6, 7, 9]);
      expect([...liquidity.entries()]).toEqual([[6, { withdrawableFrom: '2024-05-01', member: 'spouse' }]]);
    } finally {
      db.close();
    }
  });

  it('returns nothing when the payroll tables do not exist', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      expect((await fetchKerenHishtalmutLiquidity(sqliteAdapter(db), [6])).size).toBe(0);
    } finally {
      db.close();
    }
  });
});
});
