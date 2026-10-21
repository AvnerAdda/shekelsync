import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const forecast = require('../forecast.js');
const extendedForecast = require('../analytics/extended-forecast.js');

describe('received income with stale transaction types', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 13, 12));
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE transactions (
        identifier TEXT, vendor TEXT, date TEXT, name TEXT, price REAL,
        account_number TEXT, is_pikadon_related INTEGER, category_type TEXT,
        category_definition_id INTEGER, status TEXT
      );
      CREATE TABLE category_definitions (
        id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, parent_id INTEGER,
        category_type TEXT, is_counted_as_income INTEGER
      );
      CREATE TABLE transaction_pairing_exclusions (
        transaction_identifier TEXT, transaction_vendor TEXT
      );
      CREATE TABLE investment_accounts (
        id INTEGER PRIMARY KEY, currency TEXT, account_type TEXT, is_active INTEGER
      );
      CREATE TABLE investment_holdings (
        id INTEGER PRIMARY KEY, account_id INTEGER, current_value REAL,
        as_of_date TEXT, holding_type TEXT
      );
      INSERT INTO category_definitions VALUES
        (1, 'Salary', 'Salary', NULL, 'income', 1),
        (2, 'Shopping', 'Shopping', NULL, 'expense', 0);
    `);
    forecast.__setDatabaseCtor(function () {
      return { prepare: db.prepare.bind(db), close() {} };
    });
    forecast.clearCache();
    for (const date of ['2026-07-06', '2026-08-05', '2026-09-06']) addReceipt(date);
  });

  afterEach(() => {
    forecast.__resetDatabaseCtor();
    forecast.clearCache();
    extendedForecast.__resetDependencies();
    db.close();
    vi.useRealTimers();
  });

  function addReceipt(date: string, extra: { name?: string; type?: string; status?: string; category?: number } = {}) {
    db.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)')
      .run(`${extra.name || 'Payroll'}-${date}`, 'bank', date, extra.name || 'Payroll', 1000,
        extra.type || 'income', extra.category ?? 1, extra.status || 'completed');
  }

  async function generate() {
    return forecast.generateDailyForecast({
      includeToday: false, forecastDays: 30, monteCarloRuns: 30,
      noCache: true, recordSnapshot: false,
    });
  }

  it('removes the received cycle from predictions, totals and simulations while preserving next month', async () => {
    addReceipt('2026-10-07', { type: 'expense' });
    const result = await generate();
    const october = result.dailyForecasts.filter((day: any) => day.date < '2026-11-01');
    expect(october.flatMap((day: any) => day.predictions).filter((p: any) => p.categoryType === 'income')).toEqual([]);
    expect(october.reduce((sum: number, day: any) => sum + day.expectedIncome, 0)).toBe(0);
    expect(result.dailyForecasts.reduce((sum: number, day: any) => sum + day.expectedIncome, 0)).toBe(1000);
    expect(result.dailyForecasts.flatMap((day: any) => day.predictions)
      .filter((p: any) => p.categoryType === 'income')).toEqual([
      expect.objectContaining({ expectedPaymentDate: '2026-11-06', awaitingReceipt: false }),
    ]);
    for (const scenario of Object.values(result.scenarios) as any[]) {
      expect(scenario.dailyResults.filter((day: any) => day.date < '2026-11-01')
        .reduce((sum: number, day: any) => sum + day.income, 0)).toBe(0);
    }
    expect(forecast._internal.getCurrentMonthTransactions(db, '2026-10')[0].category_type).toBe('income');
  });

  it.each([
    { date: '2026-10-07', status: 'pending' },
    { date: '2026-10-15', status: 'completed' },
  ])('retains awaiting income when the receipt is not yet completed as of today: $date/$status', async ({ date, status }) => {
    addReceipt(date, { type: 'expense', status });
    const result = await generate();
    expect(result.dailyForecasts[0].predictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryType: 'income', awaitingReceipt: true, expectedAmount: 1000 }),
    ]));
  });

  it('keeps an unpaid second source in the same salary category', async () => {
    for (const date of ['2026-07-09', '2026-08-09', '2026-09-09']) addReceipt(date, { name: 'Second job' });
    addReceipt('2026-10-07', { type: 'expense' });
    const result = await generate();
    const awaiting = result.dailyForecasts.flatMap((day: any) => day.predictions).filter((p: any) => p.awaitingReceipt);
    expect(awaiting).toEqual([
      expect.objectContaining({ transactionName: 'Second job', expectedAmount: 1000 }),
    ]);
  });

  it('uses category types while keeping expense refunds and uncategorized fallbacks distinct', () => {
    addReceipt('2026-10-07', { type: 'expense' });
    addReceipt('2026-10-08', { name: 'Shopping refund', type: 'income', category: 2 });
    addReceipt('2026-10-09', { name: 'Uncategorized income', category: 999 });
    const rows = forecast._internal.getAllTransactions(db);
    expect(rows.find((row: any) => row.name === 'Payroll' && row.date === '2026-10-07').category_type).toBe('income');
    expect(rows.find((row: any) => row.name === 'Shopping refund').category_type).toBe('expense');
    expect(rows.find((row: any) => row.name === 'Uncategorized income').category_type).toBe('income');
  });

  it('shows the same received income classification in outlook history', async () => {
    addReceipt('2026-10-07', { type: 'expense' });
    addReceipt('2026-10-08', { name: 'Shopping refund', type: 'income', category: 2 });
    extendedForecast.__setDependencies({
      database: { query: async (sql: string, params: any[] = []) => ({
        rows: db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
      }) },
      forecast: { generateDailyForecast: generate },
      financialTruth: { getProjectionSnapshot: () => ({ truthRevision: 0 }) },
    });
    const result = await extendedForecast.getExtendedForecast({ noCache: true });
    expect(result.combinedData.find((day: any) => day.date === '2026-10-07'))
      .toMatchObject({ income: 1000, expenses: 0 });
    expect(result.combinedData.find((day: any) => day.date === '2026-10-08'))
      .toMatchObject({ income: 0, expenses: -1000 });
  });
});
