import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const model = require('../mortgage-schedule.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildInvestmentSchedule } = require('../investment-schedule.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MORTGAGE_TABLE_STATEMENTS } = require('../../investments/mortgage/schema.js');

function dates(from: string, to: string) {
  const result: string[] = [];
  for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${to}T00:00:00Z`); time += 86_400_000) {
    result.push(new Date(time).toISOString().slice(0, 10));
  }
  return result;
}

const now = new Date(2026, 10, 1, 12, 0, 0); // 1 Nov 2026, local

function seed(db: DatabaseSync, { categoryType = 'investment', link = true } = {}) {
  db.exec(`
    CREATE TABLE investment_accounts (id INTEGER PRIMARY KEY, account_name TEXT);
    CREATE TABLE category_definitions (id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, category_type TEXT);
    CREATE TABLE transactions (identifier TEXT, vendor TEXT, account_number TEXT, date TEXT, name TEXT, price REAL,
      category_definition_id INTEGER, category_type TEXT, status TEXT DEFAULT 'completed');
    CREATE TABLE transaction_account_links (account_id INTEGER, transaction_identifier TEXT, transaction_vendor TEXT);
    INSERT INTO investment_accounts VALUES (4, 'Apartment');
    INSERT INTO category_definitions VALUES (7, 'נדל"ן', 'Real Estate', '${categoryType}');
    INSERT INTO transactions VALUES
      ('m1', 'discount', '0162', '2026-08-09T21:00:00.000Z', 'דסק-משכנתא חיוב', -6600, 7, '${categoryType}', 'completed'),
      ('m2', 'discount', '0162', '2026-09-09T21:00:00.000Z', 'דסק-משכנתא חיוב', -6610, 7, '${categoryType}', 'completed'),
      ('m3', 'discount', '0162', '2026-10-09T21:00:00.000Z', 'דסק-משכנתא חיוב', -6700.8, 7, '${categoryType}', 'completed');
  `);
  if (link) db.exec("INSERT INTO transaction_account_links VALUES (4, 'm1', 'discount'), (4, 'm2', 'discount'), (4, 'm3', 'discount')");
  for (const statement of MORTGAGE_TABLE_STATEMENTS) db.exec(statement);
  db.exec(`
    INSERT INTO mortgage_loans (id, account_id) VALUES (1, 4);
    INSERT INTO mortgage_tracks (id, loan_id, track_type, rate, term_months, first_payment_date)
      VALUES (1, 1, 'fixed_unlinked', 4.45, 360, '2026-08-10');
    INSERT INTO mortgage_track_drawdowns (track_id, draw_date, amount, status) VALUES (1, '2026-07-10', 1300000, 'drawn');
  `);
}

describe('mortgage schedule in the forecast', () => {
  let db: DatabaseSync;
  beforeEach(() => { db = new DatabaseSync(':memory:'); });
  afterEach(() => db.close());

  it('is a no-op without mortgage tables', () => {
    const context = model.loadMortgageForecastContext(db, now);
    expect(context.hasLoans).toBe(false);
    expect(model.buildMortgageScheduleEvents(context, dates('2026-11-01', '2026-12-31'))).toEqual([]);
  });

  it('emits computed payments and derives the debit matcher from linked transactions', () => {
    seed(db);
    const context = model.loadMortgageForecastContext(db, now);
    expect(context.hasLoans).toBe(true);
    expect(context.loans[0].matcher).toMatchObject({ vendor: 'discount', accountNumber: '0162', source: 'linked_transactions' });
    expect(context.loans[0].category).toEqual({ id: 7, name: 'Real Estate', type: 'investment' });
    const events = model.buildMortgageScheduleEvents(context, dates('2026-11-01', '2026-12-31'), []);
    expect(events.map((event: any) => event.date)).toEqual(['2026-11-10', '2026-12-10']);
    // 1.3M at 4.45% over 360 months.
    expect(events[0].amount).toBeGreaterThan(6500);
    expect(events[0].amount).toBeLessThan(6600);
    expect(events[0]).toMatchObject({ sourceKey: 'mortgage:1', inference: 'mortgage_schedule', categoryType: 'investment' });
  });

  it('skips a payment that was already debited', () => {
    seed(db);
    const context = model.loadMortgageForecastContext(db, now);
    const history = [{ name: 'דסק-משכנתא חיוב', vendor: 'discount', account_number: '0162', price: -6600, date: '2026-11-09T21:00:00.000Z' }];
    const events = model.buildMortgageScheduleEvents(context, dates('2026-11-01', '2026-12-31'), history);
    expect(events.map((event: any) => event.date)).toEqual(['2026-12-10']);
  });

  it('suppresses the inferred mortgage source so it is not counted twice', () => {
    seed(db);
    const context = model.loadMortgageForecastContext(db, now);
    const history = db.prepare(`SELECT t.*, cd.name AS category_name, cd.name_en AS category_name_en
      FROM transactions t LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id`).all();
    const inferred = buildInvestmentSchedule(history, dates('2026-11-01', '2026-12-31'), now);
    expect(inferred.length).toBeGreaterThan(0);
    expect(inferred.filter((event: any) => !context.matchesSource(event))).toEqual([]);
    expect(context.matchesTransaction(history[0])).toBe(true);
    expect(context.matchesTransaction({ ...history[0], name: 'Groceries' })).toBe(false);
  });

  it('falls back to recent mortgage-named debits when nothing is linked', () => {
    seed(db, { link: false });
    const context = model.loadMortgageForecastContext(db, now);
    expect(context.loans[0].matcher).toMatchObject({ vendor: 'discount' });
  });

  it('projects expense-categorized mortgages as scheduled expenses and drops confirmed duplicates', () => {
    seed(db, { categoryType: 'expense' });
    const context = model.loadMortgageForecastContext(db, now);
    const events = model.buildMortgageScheduleEvents(context, dates('2026-11-01', '2026-11-30'), []);
    expect(events[0].categoryType).toBe('expense');
    const days = [{ date: '2026-11-10', predictions: [
      { patternKey: 'financial_pattern:3', categoryType: 'expense', transactionName: 'דסק-משכנתא חיוב', isUserResolvedPattern: true },
      { patternKey: 'financial_pattern:4', categoryType: 'expense', transactionName: 'Arnona' },
    ] }];
    const simulations = [{ date: '2026-11-10', entries: [{ patternKey: 'financial_pattern:3' }, { patternKey: 'financial_pattern:4' }] }];
    const forecastEngine = { refreshForecastDayPredictions: () => {} };
    model.applyMortgageExpenseSchedule(days, simulations, events, forecastEngine);
    const dropped = model.dropDuplicateMortgagePredictions(days, simulations, context, forecastEngine);
    expect(dropped).toBe(1);
    expect(days[0].predictions.map((prediction: any) => prediction.patternKey)).toEqual(['financial_pattern:4', 'mortgage_schedule:mortgage:1']);
    expect(simulations[0].entries.map((entry: any) => entry.patternKey)).toEqual(['financial_pattern:4', 'mortgage_schedule:mortgage:1']);
  });

  it('ignores debits after the forecast date (replays)', () => {
    seed(db);
    // Replay as of 1 Sep 2026: only the August debit is known.
    db.exec("UPDATE transactions SET name = 'Other mortgage' WHERE identifier IN ('m2', 'm3')");
    const replay = model.loadMortgageForecastContext(db, new Date(2026, 8, 1, 12));
    expect(replay.loans[0]).toMatchObject({ evidenceCount: 1, matcher: expect.objectContaining({ pattern: 'דסק משכנתא חיוב' }) });
    const today = model.loadMortgageForecastContext(db, now);
    // Once known, the two later debits define the matcher.
    expect(today.loans[0]).toMatchObject({ evidenceCount: 2, matcher: expect.objectContaining({ pattern: 'other mortgage' }) });
  });
});
