import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Run the actual SQL against an isolated database so signs, joins, and date
// boundaries cannot be hidden by query-specific mocks.
const forecastService = require('../forecast.js');
const forecastRoute = require('../../routes/forecast.js');
const { DEFAULT_ACTIVE_MODEL } = require('../forecast-models/registry.js');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE transactions (
      identifier TEXT, vendor TEXT, date TEXT, price REAL, category_type TEXT,
      category_definition_id INTEGER, status TEXT
    );
    CREATE TABLE transaction_pairing_exclusions (
      transaction_identifier TEXT, transaction_vendor TEXT
    );
    CREATE TABLE category_definitions (
      id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, name_fr TEXT, icon TEXT,
      color TEXT, parent_id INTEGER, category_type TEXT
    );
    CREATE TABLE category_budgets (
      id INTEGER PRIMARY KEY, category_definition_id INTEGER, period_type TEXT,
      budget_limit REAL, is_active INTEGER
    );
    CREATE TABLE financial_truth_state (id INTEGER PRIMARY KEY, revision INTEGER);
    CREATE TABLE forecast_prediction_snapshots (
      id INTEGER PRIMARY KEY, generated_date TEXT, target_date TEXT,
      model_id TEXT, horizon_days INTEGER, expected_expenses REAL,
      expected_cash_flow REAL, p10_cash_flow REAL, p90_cash_flow REAL
    );
    INSERT INTO category_definitions VALUES
      (1, 'Groceries', 'Groceries', 'Courses', 'cart', '#123456', NULL, 'expense');
    INSERT INTO category_budgets VALUES (1, 1, 'monthly', 1000, 1);
    INSERT INTO financial_truth_state VALUES (1, 0);
  `);
  return db;
}

function addTransaction(
  db: DatabaseSync,
  identifier: string,
  date: string,
  price: number,
  categoryType = 'expense',
  status = 'completed',
) {
  db.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(identifier, 'test-bank', date, price, categoryType, status);
}

function useForecastDatabase(db: DatabaseSync) {
  // The service closes each borrowed connection; the fixture owns this database.
  forecastService.__setDatabaseCtor(function () {
    return { prepare: db.prepare.bind(db), close() {} };
  });
}

function emptyForecast() {
  return {
    forecastPeriod: { start: '2026-07-10', end: '2026-07-10', days: 1 },
    dailyForecasts: [],
    scenarios: {},
  };
}

function spendingForecast(dates: string[], amount = 30) {
  const dailyResults = dates.map(date => ({ date, expenses: amount }));
  return {
    forecastPeriod: { start: dates[0], end: dates.at(-1), days: dates.length },
    dailyForecasts: dates.map(date => ({
      date,
      expectedExpenses: amount,
      predictions: [{
        category: 'Groceries', categoryDefinitionId: 1, categoryType: 'expense',
        probabilityWeightedAmount: amount,
      }],
    })),
    scenarios: {
      p10: { dailyResults: dailyResults.map(day => ({ ...day, expenses: amount * 2 })) },
      p50: { dailyResults },
      p90: { dailyResults: dailyResults.map(day => ({ ...day, expenses: amount / 2 })) },
    },
  };
}

describe('forecast actual spending SQL', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createDatabase();
    forecastRoute._internal.clearForecastCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    forecastService.__resetDatabaseCtor();
    forecastRoute._internal.clearForecastCache();
    db.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { budgetDays: 1, start: '2026-07-09', beforeStart: '2026-07-08' },
    { budgetDays: 30, start: '2026-06-10', beforeStart: '2026-06-09' },
    { budgetDays: 365, start: '2025-07-10', beforeStart: '2025-07-09' },
  ])('nets refunds across exactly $budgetDays calendar days including all of today', async ({ budgetDays, start, beforeStart }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9, 10));
    addTransaction(db, 'start-boundary', start, -50);
    addTransaction(db, 'purchase-date', '2026-07-09', -200);
    addTransaction(db, 'purchase-time', '2026-07-09T10:00:00', -300);
    addTransaction(db, 'refund-time', '2026-07-09T23:59:59.999', 100);
    addTransaction(db, 'too-old', `${beforeStart}T23:59:59.999`, -9000);
    addTransaction(db, 'tomorrow-date', '2026-07-10', -9000);
    addTransaction(db, 'tomorrow-time', '2026-07-10T00:00:00', -9000);
    addTransaction(db, 'income', '2026-07-09', 10000, 'income');
    addTransaction(db, 'pending', '2026-07-09', -9000, 'expense', 'pending');
    addTransaction(db, 'paired', '2026-07-09', -9000);
    db.exec(`INSERT INTO transaction_pairing_exclusions VALUES
      ('paired', 'test-bank'), ('paired', 'test-bank');`);
    const app = express();
    app.use('/api/forecast', forecastRoute.createForecastRouter({
      sqliteDb: db,
      generateForecast: async () => spendingForecast(['2026-07-10']),
    }));

    const response = await request(app)
      .get(`/api/forecast/daily?days=1&budgetDays=${budgetDays}`)
      .expect(200);

    expect(response.body.actual.startDate).toBe(start);
    expect(response.body.actual.endDate).toBe('2026-07-09');
    expect(response.body.budgetPeriod).toEqual({
      type: 'rolling_history', start, end: '2026-07-09', actualThrough: '2026-07-09',
    });
    expect(response.body.budgetOutlook).toEqual([
      expect.objectContaining({
        categoryDefinitionId: 1, actualSpent: 450, forecasted: 0, projectedTotal: 450,
        scenarios: { p10: 450, p50: 450, p90: 450 },
      }),
    ]);
    expect(response.body.budgetOutlook[0].limit).toBeCloseTo(1000 * budgetDays / 30);
  });

  it.each([
    { year: 2026, month: 10, day: 1, monthDays: 31 },
    { year: 2026, month: 10, day: 31, monthDays: 31 },
    { year: 2028, month: 2, day: 28, monthDays: 29 },
    { year: 2026, month: 2, day: 28, monthDays: 28 },
  ])('compares one calendar month at $year-$month-$day without duplicate actual and forecast days', async ({ year, month, day, monthDays }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, month - 1, day, 10));
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const today = `${monthKey}-${String(day).padStart(2, '0')}`;
    const monthEnd = `${monthKey}-${monthDays}`;
    const priorDate = new Date(year, month - 1, 0);
    const priorMonthEnd = `${priorDate.getFullYear()}-${String(priorDate.getMonth() + 1).padStart(2, '0')}-${priorDate.getDate()}`;
    addTransaction(db, 'old-month', priorMonthEnd, -900);
    addTransaction(db, 'month-actuals', `${today}T23:59:59.999`, -30 * day);
    if (day < monthDays) addTransaction(db, 'future-actual', monthEnd, -9000);
    const nextMonthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const forecast = spendingForecast([
      ...Array.from({ length: monthDays - day + 1 }, (_, i) => `${monthKey}-${String(day + i).padStart(2, '0')}`),
      nextMonthStart,
    ]);
    const app = express();
    app.use('/api/forecast', forecastRoute.createForecastRouter({
      sqliteDb: db,
      generateForecast: async () => forecast,
    }));

    const response = await request(app).get('/api/forecast/daily?days=31&includeToday=true').expect(200);
    useForecastDatabase(db);
    const serviceResult = forecastService._internal.buildBudgetOutlook(forecast);
    const expected = {
      categoryDefinitionId: 1, limit: 1000,
      actualSpent: 30 * day, forecasted: 30 * (monthDays - day), projectedTotal: 30 * monthDays,
      scenarios: {
        p10: 30 * day + 60 * (monthDays - day),
        p50: 30 * monthDays,
        p90: 30 * day + 15 * (monthDays - day),
      },
    };
    expect(response.body.budgetOutlook).toEqual([expect.objectContaining(expected)]);
    expect(serviceResult.budgetOutlook).toEqual([expect.objectContaining(expected)]);
    expect(response.body.budgetSummary.totalProjectedOverrun).toBe(0);
    expect(response.body.budgetPeriod).toEqual({
      type: 'calendar_month', start: `${monthKey}-01`, end: monthEnd, actualThrough: today,
    });
    expect(response.body.dailyForecasts).toHaveLength(forecast.dailyForecasts.length);
  });

  it.each([
    { days: 7, includeToday: false },
    { days: 30, includeToday: true },
  ])('completes the monthly budget while preserving a $days day forecast (includeToday=$includeToday)', async ({ days, includeToday }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 10));
    addTransaction(db, 'today', '2026-10-01', -30);
    const generateForecast = vi.fn(async (options: { forecastDays: number; includeToday: boolean }) => {
      const firstDay = options.includeToday ? 1 : 2;
      return spendingForecast(Array.from({ length: options.forecastDays }, (_, i) => (
        `2026-10-${String(firstDay + i).padStart(2, '0')}`
      )));
    });
    const app = express();
    app.use('/api/forecast', forecastRoute.createForecastRouter({ sqliteDb: db, generateForecast }));

    const response = await request(app)
      .get(`/api/forecast/daily?days=${days}&includeToday=${includeToday}`)
      .expect(200);

    expect(generateForecast).toHaveBeenCalledTimes(2);
    expect(generateForecast.mock.calls[1][0]).toMatchObject({ forecastDays: 30, includeToday: false });
    expect(response.body.forecastPeriod.days).toBe(days);
    expect(response.body.dailyForecasts).toHaveLength(days);
    expect(response.body.scenarios.p50.daily).toHaveLength(days);
    expect(response.body.budgetOutlook).toEqual([
      expect.objectContaining({ actualSpent: 30, forecasted: 900, projectedTotal: 930, limit: 1000 }),
    ]);
  });

  it('nets refunds in the service budget outlook used by analytics and quests', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9, 10));
    addTransaction(db, 'purchase', '2026-07-08', -500);
    addTransaction(db, 'refund', '2026-07-09T10:00:00', 100);
    addTransaction(db, 'prior-month', '2026-06-30', -9000);
    addTransaction(db, 'future-actual', '2026-07-10', -9000);
    useForecastDatabase(db);

    const result = forecastService._internal.buildBudgetOutlook(emptyForecast());

    expect(result.budgetOutlook).toEqual([
      expect.objectContaining({ categoryDefinitionId: 1, actualSpent: 400, projectedTotal: 400 }),
    ]);
  });

  it('keeps refund-only categories even when they have no budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 9, 10));
    db.exec('DELETE FROM category_budgets');
    addTransaction(db, 'refund-only', '2026-07-09', 100);
    const app = express();
    app.use('/api/forecast', forecastRoute.createForecastRouter({
      sqliteDb: db, generateForecast: async () => emptyForecast(),
    }));
    const response = await request(app).get('/api/forecast/daily?days=30').expect(200);
    useForecastDatabase(db);
    const serviceResult = forecastService._internal.buildBudgetOutlook(emptyForecast());

    for (const result of [response.body, serviceResult]) {
      expect(result.budgetOutlook).toEqual([
        expect.objectContaining({ actualSpent: -100, projectedTotal: -100, forecasted: 0, limit: 0 }),
      ]);
    }
  });

  it('scores realized expenses and cash flow after refunds, including refund-only days', () => {
    const dates = db.prepare(`SELECT
      date('now', 'localtime', '-1 day') AS yesterday,
      date('now', 'localtime', '-2 days') AS beforeYesterday,
      date('now', 'localtime', '-3 days') AS issued
    `).get() as { yesterday: string; beforeYesterday: string; issued: string };
    addTransaction(db, 'purchase', dates.beforeYesterday, -500);
    addTransaction(db, 'refund', `${dates.beforeYesterday}T18:30:00`, 100);
    addTransaction(db, 'income', dates.beforeYesterday, 1000, 'income');
    addTransaction(db, 'refund-only', `${dates.yesterday}T12:00:00`, 100);
    addTransaction(db, 'paired', dates.beforeYesterday, -9000);
    addTransaction(db, 'pending', dates.beforeYesterday, -9000, 'expense', 'pending');
    db.exec("INSERT INTO transaction_pairing_exclusions VALUES ('paired', 'test-bank')");
    const snapshot = db.prepare(`INSERT INTO forecast_prediction_snapshots
      (generated_date, target_date, model_id, horizon_days, expected_expenses,
       expected_cash_flow, p10_cash_flow, p90_cash_flow)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    snapshot.run(dates.issued, dates.beforeYesterday, DEFAULT_ACTIVE_MODEL, 1, 400, 600, 590, 610);
    snapshot.run(dates.issued, dates.yesterday, DEFAULT_ACTIVE_MODEL, 2, 0, 0, 90, 110);
    useForecastDatabase(db);

    const result = forecastService.getForecastAccuracy({ days: 7, modelId: DEFAULT_ACTIVE_MODEL });

    expect(result).toMatchObject({
      available: true,
      sampleCount: 2,
      expenseMae: 50,
      expenseMape: 50,
      expenseWape: 20,
      cashFlowMae: 50,
      cashFlowBias: -50,
      intervalCoverage: 100,
    });
    expect(result.byHorizon.days_1_7).toMatchObject({ sampleCount: 2, expenseWape: 20 });
  });
});
