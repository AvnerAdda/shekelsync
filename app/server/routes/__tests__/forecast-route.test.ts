import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const forecastRoute = require('../../routes/forecast.js');
const { createForecastRouter } = forecastRoute;

function buildForecastResult({
  days,
  totalIncome,
}: {
  days: number;
  totalIncome: number;
}) {
  const date = '2026-07-10';
  const totalExpenses = 100;
  const cashFlow = totalIncome - totalExpenses;
  const scenario = {
    totalIncome,
    totalExpenses,
    totalCashFlow: cashFlow,
    dailyResults: [
      {
        date,
        income: totalIncome,
        expenses: totalExpenses,
        cashFlow,
        cumulativeCashFlow: cashFlow,
      },
    ],
  };

  return {
    forecastPeriod: {
      start: date,
      end: date,
      days,
    },
    dailyForecasts: [
      {
        date,
        expectedIncome: totalIncome,
        expectedExpenses: totalExpenses,
        expectedCashFlow: cashFlow,
        cumulativeCashFlow: cashFlow,
        topPredictions: [],
      },
    ],
    scenarios: {
      p10: scenario,
      p50: scenario,
      p90: scenario,
    },
  };
}

function createGenerateForecastMock() {
  let calls = 0;
  return vi.fn(async (options: Record<string, number | boolean | undefined>) => {
    calls += 1;
    const days = typeof options.forecastDays === 'number'
      ? options.forecastDays
      : Number(options.forecastMonths || 1) * 30;

    return buildForecastResult({
      days,
      totalIncome: 1000 + calls,
    });
  });
}

function createSqliteDb() {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
    })),
  };
}

function buildApp(
  generateForecast = createGenerateForecastMock(),
  sqliteDb = createSqliteDb(),
  evaluateForecast = vi.fn().mockResolvedValue({ available: false, sampleCount: 0 }),

) {
  const app = express();
  app.use(express.json());
  app.use('/api/forecast', createForecastRouter({
    sqliteDb,
    generateForecast,
    evaluateForecast,
  }));
  return { app, generateForecast, evaluateForecast };
}

describe('Shared /api/forecast routes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T10:00:00.000Z'));
    forecastRoute._internal.clearForecastCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    forecastRoute._internal.clearForecastCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('caches daily forecasts by normalized request options', async () => {
    const { app, generateForecast } = buildApp();

    const first = await request(app)
      .get('/api/forecast/daily?days=30')
      .expect(200);
    const cached = await request(app)
      .get('/api/forecast/daily?days=30')
      .expect(200);
    const budgetWindowVariant = await request(app)
      .get('/api/forecast/daily?days=30&budgetDays=60')
      .expect(200);
    const dayWindowVariant = await request(app)
      .get('/api/forecast/daily?days=60')
      .expect(200);

    expect(generateForecast).toHaveBeenCalledTimes(3);
    expect(cached.body.summaries.base.income).toBe(first.body.summaries.base.income);
    expect(budgetWindowVariant.body.summaries.base.income).not.toBe(first.body.summaries.base.income);
    expect(dayWindowVariant.body.forecastPeriod.days).toBe(60);
  });

  it('bypasses the route cache when noCache is set', async () => {
    const { app, generateForecast } = buildApp();

    const first = await request(app)
      .get('/api/forecast/daily?days=30')
      .expect(200);
    const uncached = await request(app)
      .get('/api/forecast/daily?days=30&noCache=1')
      .expect(200);

    expect(generateForecast).toHaveBeenCalledTimes(2);
    expect(generateForecast.mock.calls[1][0]).toEqual(expect.objectContaining({ noCache: true }));
    expect(uncached.body.summaries.base.income).not.toBe(first.body.summaries.base.income);
  });

  it('honors months when days is omitted', async () => {
    const { app, generateForecast } = buildApp();

    await request(app)
      .get('/api/forecast/daily?months=6')
      .expect(200);

    const options = generateForecast.mock.calls[0][0];
    expect(options.forecastMonths).toBe(6);
    expect(options.forecastDays).toBeUndefined();
  });

  it('includes investment forecasts and defaults missing investment amounts to zero', async () => {
    const baseResult = buildForecastResult({ days: 2, totalIncome: 1000 });
    const result = {
      ...baseResult,
      dailyForecasts: [
        { ...baseResult.dailyForecasts[0], expectedInvestments: 750.25 },
        { ...baseResult.dailyForecasts[0], date: '2026-07-11' },
      ],
    };
    const { app } = buildApp(vi.fn().mockResolvedValue(result));

    const response = await request(app)
      .get('/api/forecast/daily?days=2')
      .expect(200);

    expect(response.body.dailyForecasts).toEqual([
      expect.objectContaining({
        date: '2026-07-10',
        income: 1000,
        expenses: 100,
        investments: 750.25,
      }),
      expect.objectContaining({ date: '2026-07-11', investments: 0 }),
    ]);
  });

  it('enriches predicted transactions with canonical categories and supplied bank metadata across all category types', async () => {
    const categories = [
      { id: 1, name: 'סופרמרקט', name_en: 'Groceries', category_type: 'expense', parent_id: 10, icon: 'cart', color: '#123456' },
      { id: 2, name: 'משכורת', name_en: 'Salary', category_type: 'income', parent_id: 20, icon: 'salary', color: '#234567' },
      { id: 3, name: 'ניירות ערך', name_en: 'Securities', category_type: 'investment', parent_id: 30, icon: 'chart', color: '#345678' },
      { id: 10, name: 'מזון', category_type: 'expense', parent_id: null },
      { id: 20, name: 'הכנסות', category_type: 'income', parent_id: null },
      { id: 30, name: 'השקעות', category_type: 'investment', parent_id: null },
    ];
    const institution = { id: 7, display_name_he: 'בנק הפועלים', display_name_en: 'Bank Hapoalim' };
    const baseResult = buildForecastResult({ days: 1, totalIncome: 1000 });
    const result = {
      ...baseResult,
      dailyForecasts: [{
        ...baseResult.dailyForecasts[0],
        topPredictions: [
          { category: 'Legacy grocery label', categoryDefinitionId: 1, categoryType: 'expense', transactionName: 'שופרסל שלי', vendor: 'hapoalim', institution, expectedAmount: 150, probability: 0.9 },
          { category: 'Salary', categoryDefinitionId: 2, categoryType: 'income', transactionName: 'חברת דוגמה בע״מ', vendor: 'leumi', expectedAmount: 1000, probability: 1 },
          { category: 'Securities', categoryDefinitionId: 3, categoryType: 'investment', transactionName: 'העברה לבית השקעות', vendor: 'hapoalim', expectedAmount: 500, probability: 0.8 },
        ],
      }],
    };
    const sqliteDb = {
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(() => {
          if (!sql.includes('FROM category_definitions')) return [];
          return /WHERE\s+category_type\s*=\s*'expense'/i.test(sql)
            ? categories.filter(category => category.category_type === 'expense')
            : categories;
        }),
      })),
    };
    const { app } = buildApp(vi.fn().mockResolvedValue(result), sqliteDb);

    const response = await request(app).get('/api/forecast/daily?days=1').expect(200);

    expect(response.body.dailyForecasts[0].topPredictions).toEqual([
      expect.objectContaining({
        category: 'Legacy grocery label',
        categoryDefinitionId: 1,
        transactionName: 'שופרסל שלי',
        categoryType: 'expense',
        category_name: 'סופרמרקט',
        parent_name: 'מזון',
        category_icon: 'cart',
        category_color: '#123456',
        vendor: 'hapoalim',
        institution,
        amount: 150,
      }),
      expect.objectContaining({
        transactionName: 'חברת דוגמה בע״מ',
        categoryType: 'income',
        category_name: 'משכורת',
        parent_name: 'הכנסות',
        category_icon: 'salary',
        category_color: '#234567',
        vendor: 'leumi',
      }),
      expect.objectContaining({
        transactionName: 'העברה לבית השקעות',
        categoryType: 'investment',
        category_name: 'ניירות ערך',
        parent_name: 'השקעות',
        category_icon: 'chart',
        category_color: '#345678',
        vendor: 'hapoalim',
      }),
    ]);
    expect(response.body.dailyForecasts[0].predictions).toEqual(response.body.dailyForecasts[0].topPredictions);
    expect(response.body.dailyForecasts[0].predictions.map((prediction: Record<string, number>) => prediction.probabilityWeightedAmount))
      .toEqual([135, 1000, 400]);
  });

  it('leaves missing metadata empty without guessing categories from transaction names or inventing vendors', async () => {
    const baseResult = buildForecastResult({ days: 1, totalIncome: 1000 });
    const result = {
      ...baseResult,
      dailyForecasts: [{
        ...baseResult.dailyForecasts[0],
        topPredictions: [
          { category: 'Unknown category', transactionName: 'Salary', expectedAmount: 50 },
          { category: 'Salary', categoryDefinitionId: 999, transactionName: 'Unknown employer', expectedAmount: 50 },
          { category: 'Salary', expectedAmount: 50 },
        ],
      }],
    };
    const sqliteDb = {
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(() => sql.includes('FROM category_definitions')
          ? [{ id: 2, name: 'משכורת', name_en: 'Salary', category_type: 'income', parent_id: null, icon: 'salary', color: '#234567' }]
          : []),
      })),
    };
    const { app } = buildApp(vi.fn().mockResolvedValue(result), sqliteDb);

    const response = await request(app).get('/api/forecast/daily?days=1').expect(200);
    const predictions = response.body.dailyForecasts[0].topPredictions;

    expect(predictions.slice(0, 2)).toEqual([
      expect.objectContaining({ category: 'Unknown category', transactionName: 'Salary', categoryType: null, category_name: null, parent_name: null, category_icon: null, category_color: null, vendor: null }),
      expect.objectContaining({ category: 'Salary', categoryDefinitionId: 999, category_name: null, parent_name: null, category_icon: null, category_color: null, vendor: null }),
    ]);
    expect(predictions[2]).toMatchObject({
      category: 'Salary',
      transactionName: null,
      categoryType: 'income',
      category_name: 'משכורת',
      parent_name: null,
      category_icon: 'salary',
      category_color: '#234567',
      vendor: null,
    });
    expect(predictions.every((prediction: Record<string, unknown>) => !('institution' in prediction))).toBe(true);
  });

  it('reconciles full prediction details and chart groups with daily totals beyond the top five predictions', async () => {
    const categories = [
      { id: 1, name: 'סופרמרקט', category_type: 'expense', parent_id: 10, icon: 'cart', color: '#123456' },
      { id: 2, name: 'משכורת', category_type: 'income', parent_id: 20 },
      { id: 3, name: 'ניירות ערך', category_type: 'investment', parent_id: 30 },
      { id: 10, name: 'מזון', category_type: 'expense', parent_id: null },
    ];
    const predictions = [
      { category: 'Merchant A', categoryDefinitionId: 1, categoryType: 'expense', vendor: 'visaCal', expectedAmount: 200, probability: 0.5, probabilityWeightedAmount: 80 },
      { category: 'Merchant B', categoryDefinitionId: 1, categoryType: 'expense', vendor: 'visaCal', expectedAmount: 50, probability: 0.5 },
      { category: 'Employer', categoryDefinitionId: 2, vendor: 'discount', expectedAmount: 1000, probability: 1 },
      { category: 'Broker deposit', categoryDefinitionId: 3, categoryType: 'investment', vendor: 'discount', expectedAmount: 500, probability: 1, probabilityWeightedAmount: 500 },
      { category: 'Suppressed payment', categoryDefinitionId: 1, categoryType: 'expense', vendor: 'visaCal', expectedAmount: 999, probability: 1, probabilityWeightedAmount: 0 },
      { category: 'Broker withdrawal', categoryDefinitionId: 3, categoryType: 'investment', vendor: 'discount', expectedAmount: -120, probability: 0.5 },
      { category: 'Merchant C', categoryDefinitionId: 1, transactionName: 'שופרסל שלי', categoryType: 'expense', expectedAmount: 20, probability: 0.25, patternId: 'pattern-c', occurrenceId: 'occurrence-c', correctionCapabilities: ['set_category_expectation'] },
      { category: 'Uncategorized investment', categoryType: 'investment', probabilityWeightedAmount: -10 },
    ];
    const baseResult = buildForecastResult({ days: 1, totalIncome: 1000 });
    const result = {
      ...baseResult,
      dailyForecasts: [{
        ...baseResult.dailyForecasts[0],
        expectedExpenses: 110,
        expectedInvestments: 430,
        predictions,
        topPredictions: predictions.slice(0, 5),
      }],
    };
    const sqliteDb = {
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(() => sql.includes('FROM category_definitions') ? categories : []),
      })),
    };
    const { app } = buildApp(vi.fn().mockResolvedValue(result), sqliteDb);

    const response = await request(app).get('/api/forecast/daily?days=1').expect(200);
    const day = response.body.dailyForecasts[0];

    expect(day.chartBreakdown).toEqual([
      { categoryId: 1, categoryName: 'סופרמרקט', vendor: 'visaCal', income: 0, expenses: 105, investments: 0 },
      { categoryId: 2, categoryName: 'משכורת', vendor: 'discount', income: 1000, expenses: 0, investments: 0 },
      { categoryId: 3, categoryName: 'ניירות ערך', vendor: 'discount', income: 0, expenses: 0, investments: 440 },
      { categoryId: 1, categoryName: 'סופרמרקט', vendor: null, income: 0, expenses: 5, investments: 0 },
      { categoryId: null, categoryName: null, vendor: null, income: 0, expenses: 0, investments: -10 },
    ]);
    for (const metric of ['income', 'expenses', 'investments']) {
      expect(day.chartBreakdown.reduce((sum: number, group: Record<string, number>) => sum + group[metric], 0)).toBe(day[metric]);
    }
    expect(day.topPredictions).toHaveLength(5);
    expect(day.predictions).toHaveLength(predictions.length);
    expect(day.topPredictions).toEqual(day.predictions.slice(0, 5));
    expect(day.predictions.map((prediction: Record<string, number>) => prediction.probabilityWeightedAmount))
      .toEqual([80, 25, 1000, 500, 0, -60, 5, -10]);
    for (const [categoryType, metric] of [['income', 'income'], ['expense', 'expenses'], ['investment', 'investments']]) {
      const detailTotal = day.predictions
        .filter((prediction: Record<string, unknown>) => prediction.categoryType === categoryType)
        .reduce((sum: number, prediction: Record<string, number>) => sum + prediction.probabilityWeightedAmount, 0);
      expect(detailTotal).toBe(day[metric]);
    }
    expect(day.predictions[6]).toMatchObject({
      patternId: 'pattern-c',
      occurrenceId: 'occurrence-c',
      transactionName: 'שופרסל שלי',
      categoryDefinitionId: 1,
      category_name: 'סופרמרקט',
      parent_name: 'מזון',
      category_icon: 'cart',
      category_color: '#123456',
      amount: 20,
      probability: 0.25,
      probabilityWeightedAmount: 5,
      correctionCapabilities: ['set_category_expectation'],
    });
  });

  it('keeps an explicitly empty full prediction list instead of falling back to top predictions', async () => {
    const baseResult = buildForecastResult({ days: 1, totalIncome: 0 });
    const result = {
      ...baseResult,
      dailyForecasts: [{
        ...baseResult.dailyForecasts[0],
        predictions: [],
        topPredictions: [{ category: 'Food', categoryType: 'expense', expectedAmount: 100, probability: 1 }],
      }],
    };
    const { app } = buildApp(vi.fn().mockResolvedValue(result));

    const response = await request(app).get('/api/forecast/daily?days=1').expect(200);

    expect(response.body.dailyForecasts[0].predictions).toEqual([]);
    expect(response.body.dailyForecasts[0].topPredictions).toHaveLength(1);
  });

  it('leaves unsupported chart allocations unassigned when predictions or amounts are incomplete', async () => {
    const baseResult = buildForecastResult({ days: 2, totalIncome: 1000 });
    const result = {
      ...baseResult,
      dailyForecasts: [
        {
          ...baseResult.dailyForecasts[0],
          topPredictions: [{ category: 'Food', categoryType: 'expense', expectedAmount: 100, probability: 1 }],
        },
        {
          ...baseResult.dailyForecasts[0],
          date: '2026-07-11',
          predictions: [
            { category: 'Food', categoryType: 'expense', expectedAmount: 100 },
            { category: 'Food', categoryType: 'expense', probability: 1 },
            { category: 'Unknown type', probabilityWeightedAmount: 200 },
            { category: 'Food', categoryType: 'expense', probabilityWeightedAmount: NaN },
            { category: 'Food', categoryType: 'expense', expectedAmount: Infinity, probability: 1 },
            { category: 'Uncategorized', categoryType: 'expense', vendor: ' ', expectedAmount: 20, probability: 0.5 },
          ],
        },
      ],
    };
    const { app } = buildApp(vi.fn().mockResolvedValue(result));

    const response = await request(app).get('/api/forecast/daily?days=2').expect(200);

    expect(response.body.dailyForecasts[0].chartBreakdown).toEqual([]);
    expect(response.body.dailyForecasts[1].chartBreakdown).toEqual([
      { categoryId: null, categoryName: null, vendor: null, income: 0, expenses: 10, investments: 0 },
    ]);
  });

  it('combines populated actuals, budgets, and category forecasts', async () => {
    const scenario = (totalExpenses: number) => ({
      totalIncome: 2000,
      totalOperatingIncome: 1500,
      totalNonOperatingIncome: 500,
      totalExpenses,
      totalOperatingExpenses: totalExpenses - 50,
      totalNonOperatingExpenses: 50,
      totalCashFlow: 2000 - totalExpenses,
      totalOperatingCashFlow: 1500 - (totalExpenses - 50),
      totalNonOperatingCashFlow: 450,
      dailyResults: [{
        date: '2026-07-10',
        income: 2000,
        operatingIncome: 1500,
        nonOperatingIncome: 500,
        expenses: totalExpenses,
        operatingExpenses: totalExpenses - 50,
        nonOperatingExpenses: 50,
        cashFlow: 2000 - totalExpenses,
        operatingCashFlow: 1500 - (totalExpenses - 50),
        nonOperatingCashFlow: 450,
        cumulativeCashFlow: 2000 - totalExpenses,
        cumulativeOperatingCashFlow: 1500 - (totalExpenses - 50),
        cumulativeNonOperatingCashFlow: 450,
        cumulativeOperatingExpenses: totalExpenses - 50,
        cumulativeNonOperatingExpenses: 50,
      }],
    });
    const generateForecast = vi.fn().mockResolvedValue({
      forecastPeriod: { start: '2026-07-10', end: '2026-07-10', days: 1 },
      dailyForecasts: [{
        date: '2026-07-10',
        expectedIncome: 2000,
        expectedOperatingIncome: 1500,
        expectedNonOperatingIncome: 500,
        expectedExpenses: 250,
        expectedOperatingExpenses: 200,
        expectedNonOperatingExpenses: 50,
        expectedCashFlow: 1750,
        expectedOperatingCashFlow: 1300,
        expectedNonOperatingCashFlow: 450,
        cumulativeCashFlow: 1750,
        cumulativeOperatingCashFlow: 1300,
        cumulativeNonOperatingCashFlow: 450,
        cumulativeOperatingExpenses: 200,
        cumulativeNonOperatingExpenses: 50,
        topPredictions: [{
          category: 'Food',
          categoryDefinitionId: 1,
          expectedAmount: 200,
          probability: 0.8,
        }],
        predictions: [
          {
            category: 'Food',
            categoryDefinitionId: 1,
            categoryType: 'expense',
            probabilityWeightedAmount: 200,
          },
          {
            category: 'Travel',
            categoryDefinitionId: 2,
            categoryType: 'expense',
            probabilityWeightedAmount: 50,
          },
        ],
      }],
      scenarios: {
        p10: scenario(300),
        p50: scenario(200),
        p90: scenario(100),
      },
    });
    const sqliteDb = {
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(() => {
          if (sql.includes('SUM(ABS(t.price)) AS spent')) {
            return [
              { category_definition_id: 1, category_name: 'Food', spent: 900 },
              { category_definition_id: 2, category_name: 'Travel', spent: 300 },
            ];
          }
          if (sql.includes('FROM category_definitions')) {
            return [
              { id: 1, name: 'Food', name_en: 'Food', name_fr: 'Alimentation', icon: 'food', color: '#111', parent_id: 10 },
              { id: 2, name: 'Travel', name_en: 'Travel', name_fr: 'Voyage', icon: 'travel', color: '#222', parent_id: 20 },
            ];
          }
          if (sql.includes('FROM category_budgets')) {
            return [
              {
                budget_id: 9,
                category_definition_id: 1,
                budget_limit: 1000,
                category_name: 'Food',
                category_name_en: 'Food',
                category_name_fr: 'Alimentation',
                category_icon: 'food',
                category_color: '#111',
                parent_category_id: 10,
              },
              {
                budget_id: 10,
                category_definition_id: 2,
                budget_limit: 250,
                category_name: 'Travel',
                category_name_en: 'Travel',
                category_name_fr: 'Voyage',
                category_icon: 'travel',
                category_color: '#222',
                parent_category_id: 20,
              },
            ];
          }
          return [];
        }),
      })),
    };
    const { app } = buildApp(generateForecast, sqliteDb);

    const response = await request(app)
      .get('/api/forecast/daily?days=30&budgetDays=30')
      .expect(200);

    expect(response.body.dailyForecasts[0].topCategory).toBe('Food');
    expect(response.body.dailyForecasts[0]).toMatchObject({
      operatingIncome: 1500,
      nonOperatingIncome: 500,
      operatingExpenses: 200,
      nonOperatingExpenses: 50,
      operatingCashFlow: 1300,
      nonOperatingCashFlow: 450,
      cumulativeOperatingCashFlow: 1300,
      cumulativeNonOperatingCashFlow: 450,
      cumulativeOperatingExpenses: 200,
      cumulativeNonOperatingExpenses: 50,
    });
    expect(response.body.scenarios.p50).toMatchObject({
      totalOperatingIncome: 1500,
      totalNonOperatingIncome: 500,
      totalOperatingExpenses: 150,
      totalNonOperatingExpenses: 50,
      totalOperatingCashFlow: 1350,
      totalNonOperatingCashFlow: 450,
    });
    expect(response.body.summaries.base).toMatchObject({
      operatingNetCashFlow: 1350,
      operatingIncome: 1500,
      nonOperatingIncome: 500,
      operatingExpenses: 150,
      nonOperatingExpenses: 50,
    });
    expect(response.body.budgetSummary).toMatchObject({
      totalBudgets: 2,
      highRisk: 1,
      exceeded: 1,
      totalProjectedOverrun: 200,
    });
    expect(response.body.budgetOutlook).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryName: 'Food', projectedTotal: 1100, status: 'at_risk' }),
      expect.objectContaining({ categoryName: 'Travel', projectedTotal: 350, status: 'exceeded' }),
    ]));
  });

  it('rejects invalid forecast query parameters before generating', async () => {
    const { app, generateForecast } = buildApp();

    const invalidDays = await request(app)
      .get('/api/forecast/daily?days=abc')
      .expect(400);
    const invalidBudgetDays = await request(app)
      .get('/api/forecast/daily?budgetDays=0')
      .expect(400);
    const invalidMonths = await request(app)
      .get('/api/forecast/daily?months=25')
      .expect(400);

    expect(invalidDays.body.error).toBe('days must be an integer');
    expect(invalidBudgetDays.body.error).toBe('budgetDays must be between 1 and 365');
    expect(invalidMonths.body.error).toBe('months must be between 1 and 24');
    expect(generateForecast).not.toHaveBeenCalled();
  });

  it('exposes bounded realized forecast accuracy without generating a new forecast', async () => {
    const { app, generateForecast, evaluateForecast } = buildApp();
    evaluateForecast.mockResolvedValue({
      available: true,
      evaluationWindowDays: 120,
      sampleCount: 42,
      expenseMae: 18.5,
    });

    const response = await request(app)
      .get('/api/forecast/accuracy?days=120')
      .expect(200);

    expect(response.body).toMatchObject({ available: true, sampleCount: 42, expenseMae: 18.5 });
    expect(evaluateForecast).toHaveBeenCalledWith({ days: 120, modelId: undefined });
    expect(generateForecast).not.toHaveBeenCalled();

    const invalid = await request(app)
      .get('/api/forecast/accuracy?days=2')
      .expect(400);
    expect(invalid.body.error).toBe('days must be between 7 and 365');
  });

  it('filters accuracy by forecast version', async () => {
    vi.useRealTimers();
    const { app, evaluateForecast } = buildApp();
    await request(app).get('/api/forecast/accuracy?days=90&model=pattern-v1').expect(200);
    expect(evaluateForecast).toHaveBeenCalledWith({ days: 90, modelId: 'pattern-v1' });
    await request(app).get('/api/forecast/accuracy/compare').expect(404);
  });
});
