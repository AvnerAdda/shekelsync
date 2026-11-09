import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require('../service.js');

function sqliteAdapter(db: DatabaseSync) {
  return {
    async query(sql: string, params: unknown[] = []) {
      const bindings: any[] = [];
      const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => {
        bindings.push(params[Number(index) - 1] ?? null);
        return '?';
      });
      const statement = db.prepare(sqliteSql);
      if (/^\s*(SELECT|WITH)/i.test(sqliteSql) || /RETURNING/i.test(sqliteSql)) {
        return { rows: statement.all(...bindings) };
      }
      statement.run(...bindings);
      return { rows: [] };
    },
  };
}

describe('payroll service', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE user_profile (id INTEGER PRIMARY KEY, username TEXT, marital_status TEXT);
      CREATE TABLE spouse_profile (id INTEGER PRIMARY KEY, user_profile_id INTEGER, name TEXT);
      CREATE TABLE investment_accounts (
        id INTEGER PRIMARY KEY, account_name TEXT, account_type TEXT, institution TEXT, is_active INTEGER DEFAULT 1
      );
      CREATE TABLE category_definitions (
        id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, parent_id INTEGER,
        category_type TEXT, is_counted_as_income INTEGER
      );
      CREATE TABLE transactions (
        identifier TEXT, vendor TEXT, vendor_nickname TEXT, account_number TEXT, date TEXT,
        name TEXT, price REAL, category_definition_id INTEGER
      );
      INSERT INTO user_profile VALUES (1, 'Avner', 'Married');
      INSERT INTO spouse_profile VALUES (1, 1, 'Dana');
      INSERT INTO investment_accounts (id, account_name, account_type, institution) VALUES
        (7, 'Harel Pension', 'pension', 'Harel'),
        (8, 'Clal Study Fund', 'provident', 'Clal'),
        (9, 'Brokerage', 'brokerage', 'IBKR');
      INSERT INTO category_definitions VALUES
        (1, 'הכנסות', 'Income', NULL, 'income', 1),
        (2, 'משכורת', 'Salary', 1, 'income', 1),
        (3, 'סופר', 'Groceries', NULL, 'expense', 1);
      INSERT INTO transactions VALUES
        ('a1', 'hapoalim', 'Main', '111', '2026-08-01T00:00:00.000Z', 'משכורת אינטל 08/26', 18000, 2),
        ('a2', 'hapoalim', 'Main', '111', '2026-09-01T00:00:00.000Z', 'משכורת אינטל 09/26', 18200, 2),
        ('a3', 'hapoalim', 'Main', '111', '2026-10-01T00:00:00.000Z', 'משכורת אינטל 10/26', 18100, 2),
        ('b1', 'leumi', NULL, '222', '2026-09-10T00:00:00.000Z', 'WIX COM LTD', 14000, NULL),
        ('b2', 'leumi', NULL, '222', '2026-10-10T00:00:00.000Z', 'WIX COM LTD', 14000, NULL),
        ('c1', 'leumi', NULL, '222', '2026-10-15T00:00:00.000Z', 'One-off refund', 2500, NULL),
        ('d1', 'hapoalim', NULL, '111', '2026-10-03T00:00:00.000Z', 'Groceries', -500, 3),
        ('e1', 'hapoalim', NULL, '111', '2026-05-31T00:00:00.000Z', 'משכורת אינטל 05/26', 17000, 2);
    `);
    service.__setDependencies({ database: sqliteAdapter(db), now: () => new Date('2026-11-09T09:00:00Z') });
  });

  afterEach(() => {
    service.__resetDependencies();
    db.close();
  });

  it('returns both members with no employment and the eligible accounts', async () => {
    const setup = await service.getPayrollSetup();
    expect(setup.members.map((member: any) => [member.member, member.displayName, member.available, member.employment]))
      .toEqual([['self', 'Avner', true, null], ['spouse', 'Dana', true, null]]);
    expect(setup.accounts.map((account: any) => account.id)).toEqual([8, 7]);
    expect(setup.defaults.plans.keren_hishtalmut.salary_cap).toBe(15712);
  });

  it('hides the spouse when the user is not married', async () => {
    db.exec("UPDATE user_profile SET marital_status = 'Single'");
    const setup = await service.getPayrollSetup();
    expect(setup.members.find((member: any) => member.member === 'spouse').available).toBe(false);
  });

  it('saves employment with plans, applies defaults and computes the breakdown', async () => {
    const view = await service.saveEmployment('self', {
      employer_name: 'Intel',
      gross_monthly: 25000,
      salary_match_pattern: 'משכורת אינטל',
      salary_match_vendor: 'hapoalim',
      salary_match_account_number: '111',
      plans: [
        { kind: 'pension', account_id: 7 },
        { kind: 'severance', account_id: 7, employer_pct: 8.33 },
        { kind: 'keren_hishtalmut', account_id: 8 },
      ],
    });

    expect(view.employment).toMatchObject({ member: 'self', employer_name: 'Intel', gross_monthly: 25000, is_active: 1 });
    const byKind = Object.fromEntries(view.plans.map((plan: any) => [plan.kind, plan]));
    expect(byKind.pension).toMatchObject({ account_id: 7, employee_pct: 6, employer_pct: 6.5, salary_cap: null, start_date: '2026-11-09' });
    expect(byKind.severance).toMatchObject({ employee_pct: 0, employer_pct: 8.33 });
    expect(byKind.keren_hishtalmut).toMatchObject({ account_id: 8, salary_cap: 15712 });
    // pension 3125 + severance 2082.5 + KH 1571.2
    expect(view.breakdown.totals.total).toBeCloseTo(6778.7, 2);
  });

  it('updates in place and keeps the original start date', async () => {
    await service.saveEmployment('self', { gross_monthly: 20000, plans: [{ kind: 'pension', start_date: '2026-01-01' }] });
    const view = await service.saveEmployment('self', { gross_monthly: 22000, plans: [{ kind: 'pension', employee_pct: 7 }] });
    expect(view.employment.gross_monthly).toBe(22000);
    expect(view.plans).toHaveLength(1);
    expect(view.plans[0]).toMatchObject({ employee_pct: 7, start_date: '2026-01-01' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM household_employment').get() as any).n).toBe(1);
  });

  it('keeps a switched-off plan without a start date', async () => {
    const view = await service.saveEmployment('spouse', { gross_monthly: 15000, plans: [{ kind: 'keren_hishtalmut', is_active: 0 }] });
    expect(view.plans[0]).toMatchObject({ is_active: 0, start_date: null });
    expect(view.breakdown.totals.total).toBe(0);
  });

  it('rejects invalid payloads', async () => {
    await expect(service.saveEmployment('child', {})).rejects.toMatchObject({ status: 400 });
    await expect(service.saveEmployment('self', { gross_monthly: -1 })).rejects.toMatchObject({ status: 400 });
    await expect(service.saveEmployment('self', { plans: [{ kind: 'gemel' }] })).rejects.toMatchObject({ status: 400 });
    await expect(service.saveEmployment('self', { plans: [{ kind: 'pension', employee_pct: 120 }] })).rejects.toMatchObject({ status: 400 });
    await expect(service.saveEmployment('self', { plans: [{ kind: 'pension' }, { kind: 'pension' }] })).rejects.toMatchObject({ status: 400 });
    await expect(service.saveEmployment('self', { plans: [{ kind: 'pension', account_id: 404 }] })).rejects.toMatchObject({ status: 400 });
    await expect(service.saveEmployment('self', { plans: [{ kind: 'pension', account_id: 9 }] })).rejects.toMatchObject({ status: 400 });
    await expect(service.saveEmployment('self', { plans: [{ kind: 'pension', start_date: '2026-13-45' }] })).rejects.toMatchObject({ status: 400 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM household_employment').get() as any).n).toBe(0);
  });

  it('deletes a member employment and its plans', async () => {
    await service.saveEmployment('self', { gross_monthly: 20000, plans: [{ kind: 'pension' }] });
    const view = await service.deleteEmployment('self');
    expect(view.employment).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS n FROM payroll_contribution_plans').get() as any).n).toBe(0);
  });

  it('lists recurring salary-like deposits from the last six months and who claims them', async () => {
    await service.saveEmployment('spouse', {
      gross_monthly: 18000,
      salary_match_pattern: 'wix com ltd',
      salary_match_vendor: 'leumi',
      salary_match_account_number: '222',
    });
    const { candidates } = await service.getSalaryCandidates();
    expect(candidates.map((candidate: any) => candidate.name)).toEqual(['משכורת אינטל 10/26', 'WIX COM LTD']);
    expect(candidates[0]).toMatchObject({
      vendor: 'hapoalim',
      accountNumber: '111',
      monthCount: 3,
      medianAmount: 18100,
      lastDate: '2026-10-01',
      looksLikeSalary: true,
      claimedBy: null,
      match: { salary_match_pattern: 'משכורת אינטל', salary_match_vendor: 'hapoalim', salary_match_account_number: '111' },
    });
    expect(candidates[1]).toMatchObject({ looksLikeSalary: false, monthCount: 2, claimedBy: 'spouse' });
  });
});
