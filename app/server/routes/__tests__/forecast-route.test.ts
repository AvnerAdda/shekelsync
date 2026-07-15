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

function buildApp(generateForecast = createGenerateForecastMock()) {
  const app = express();
  app.use(express.json());
  app.use('/api/forecast', createForecastRouter({
    sqliteDb: createSqliteDb(),
    generateForecast,
  }));
  return { app, generateForecast };
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
});
