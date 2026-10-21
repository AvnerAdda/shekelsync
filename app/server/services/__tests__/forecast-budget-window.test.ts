import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const forecast = require('../forecast.js');
const model = require('../forecast-models/pattern.js');

afterEach(() => {
  forecast.clearCache();
  forecast.__resetDatabaseCtor();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('monthly budget forecast coverage', () => {
  it.each([
    { now: new Date(2026, 9, 12, 12), options: { forecastDays: 7 }, remaining: 19 },
    { now: new Date(2026, 9, 1, 12), options: { forecastDays: 30, includeToday: true }, remaining: 30 },
    { now: new Date(2028, 1, 28, 12), options: { forecastDays: 1, includeToday: true }, remaining: 1 },
    { now: new Date(2026, 9, 24, 12), options: { forecastDays: 1 }, remaining: 7 },
  ])('extends a short requested window to month-end: $now', async ({ now, options, remaining }) => {
    const result = { truthRevision: 4, dailyForecasts: [{ date: 'original' }] };
    const extended = { truthRevision: 4, dailyForecasts: [{ date: 'extended' }] };
    const generate = vi.fn().mockResolvedValue(extended);
    const chosen = await forecast.ensureMonthlyBudgetForecast(result, { ...options, noCache: true }, generate, now);

    expect(chosen).toBe(extended);
    expect(result.dailyForecasts).toEqual([{ date: 'original' }]);
    expect(generate).toHaveBeenCalledExactlyOnceWith({ ...options, noCache: true, forecastDays: remaining, includeToday: false });
    expect(generate.mock.calls[0][0]).not.toHaveProperty('recordSnapshot');
  });

  it.each([
    { now: new Date(2026, 9, 12, 12), options: { forecastDays: 19 } },
    { now: new Date(2026, 9, 12, 12), options: { forecastDays: 20, includeToday: true } },
    { now: new Date(2026, 9, 12, 12), options: { forecastMonths: 1 } },
    { now: new Date(2026, 9, 12, 12), options: {} },
    { now: new Date(2026, 9, 31, 12), options: { forecastDays: 1, includeToday: true } },
  ])('reuses an already sufficient forecast: $options', async ({ now, options }) => {
    const result = { truthRevision: 4 };
    const generate = vi.fn();
    expect(await forecast.ensureMonthlyBudgetForecast(result, options, generate, now)).toBe(result);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects combining forecasts based on different financial revisions', async () => {
    await expect(forecast.ensureMonthlyBudgetForecast({ truthRevision: 4 }, { forecastDays: 1 },
      vi.fn().mockResolvedValue({ truthRevision: 5 }), new Date(2026, 9, 12, 12)))
      .rejects.toMatchObject({ status: 409, message: 'Financial truth changed while this budget forecast was updating' });
  });

  it('preserves the requested service forecast while budgeting all remaining days on SQLite', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 12, 12));
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE transactions (
          identifier TEXT, vendor TEXT, date TEXT, name TEXT, price REAL,
          account_number TEXT, is_pikadon_related INTEGER, category_type TEXT,
          category_definition_id INTEGER, status TEXT
        );
        CREATE TABLE transaction_pairing_exclusions (transaction_identifier TEXT, transaction_vendor TEXT);
        CREATE TABLE category_definitions (
          id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, name_fr TEXT,
          icon TEXT, color TEXT, parent_id INTEGER, category_type TEXT, is_counted_as_income INTEGER
        );
        CREATE TABLE category_budgets (
          id INTEGER PRIMARY KEY, category_definition_id INTEGER, period_type TEXT,
          budget_limit REAL, is_active INTEGER
        );
        INSERT INTO category_definitions VALUES (1, 'Groceries', 'Groceries', 'Courses', 'cart', '#123456', NULL, 'expense', 0);
        INSERT INTO category_budgets VALUES (1, 1, 'monthly', 900, 1);
        INSERT INTO transactions VALUES ('purchase', 'bank', '2026-10-12T18:00:00', 'Purchase', -360, NULL, 0, 'expense', 1, 'completed');
      `);
      forecast.__setDatabaseCtor(function () {
        return { prepare: db.prepare.bind(db), close() {} };
      });
      const generateModel = vi.spyOn(model, 'generateForecast').mockImplementation(({ engine, now, config }: any) => {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const dailyForecasts = Array.from({ length: config.forecastDays }, (_, index) => {
          const date = new Date(start);
          date.setDate(date.getDate() + index);
          return { date: engine.formatDate(date), expectedExpenses: 30,
            predictions: [{ category: 'Groceries', categoryDefinitionId: 1, categoryType: 'expense', probabilityWeightedAmount: 30 }] };
        });
        const scenario = { totalExpenses: dailyForecasts.length * 30,
          dailyResults: dailyForecasts.map(day => ({ date: day.date, expenses: 30 })) };
        return { truthRevision: 0,
          forecastPeriod: { start: dailyForecasts[0].date, end: dailyForecasts.at(-1).date, days: dailyForecasts.length },
          dailyForecasts, scenarios: { p10: scenario, p50: scenario, p90: scenario } };
      });

      const result = await forecast.getForecast({ forecastDays: 7, recordSnapshot: false, noCache: true });

      expect(generateModel).toHaveBeenCalledTimes(2);
      expect(result.forecastPeriod).toEqual({ start: '2026-10-13', end: '2026-10-19', days: 7 });
      expect(result.dailyForecasts).toHaveLength(7);
      expect(result.scenarios.p50.totalExpenses).toBe(210);
      expect(result.budgetOutlook).toEqual([expect.objectContaining({
        actualSpent: 360, forecasted: 570, projectedTotal: 930, limit: 900, status: 'at_risk',
      })]);
      expect(result.budgetSummary.totalProjectedOverrun).toBe(30);
    } finally {
      db.close();
    }
  });
});
