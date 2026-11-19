import type { Handler } from '../tests/helpers/renderer-app';
import type { RhythmComparison } from '../src/features/analysis/components/rhythm/types';

const rhythm: RhythmComparison = {
  granularity: 'month', metric: 'spend', scope: 'all',
  asOf: '2025-09-21', coverageStart: '2025-01-01',
  current: { key: '2025-09', start: '2025-09-01', end: '2025-09-30' },
  pace: {
    x: 21, length: 30, current: 4620, median: 5250, low: 4305, high: 6195,
    status: 'below', deltaAmount: -630, deltaPercent: -12,
    typicalTotal: 7500, projectedTotal: 6600,
  },
  points: Array.from({ length: 30 }, (_, index) => {
    const x = index + 1;
    return { x, current: x <= 21 ? 220 * x : null, previous: 260 * x,
      median: 250 * x, low: 205 * x, high: 295 * x };
  }),
  checks: [], drivers: [], newMerchants: [], periods: [],
};

const forecast = {
  modelId: 'demo', truthRevision: 1, hasCurrentBalance: true, startingBalance: 4200,
  forecastPeriod: { start: '2025-09-22', end: '2026-03-21' },
  combinedData: [
    { date: '2025-03-21', historicalCumulative: 1800 },
    { date: '2025-05-21', historicalCumulative: 2700 },
    { date: '2025-07-21', historicalCumulative: 3200 },
    { date: '2025-09-21', historicalCumulative: 4200, expectedCumulative: 4200, p10Cumulative: 4200, p90Cumulative: 4200 },
    { date: '2025-11-21', expectedCumulative: 6500, p10Cumulative: 4800, p90Cumulative: 8200 },
    { date: '2026-01-21', expectedCumulative: 8800, p10Cumulative: 5400, p90Cumulative: 12200 },
    { date: '2026-03-21', expectedCumulative: 11200, p10Cumulative: 6200, p90Cumulative: 16200 },
  ].map((point) => ({ historicalCumulative: null, expectedCumulative: null, p10Cumulative: null, p90Cumulative: null, ...point })),
  summaries: {
    pessimistic: { netCashFlow: 2000, endingBalance: 6200 },
    base: { income: 96000, expenses: 89000, netCashFlow: 7000, endingBalance: 11200 },
    optimistic: { netCashFlow: 12000, endingBalance: 16200 },
  },
  expenseDrivers: [], incomeDrivers: [],
};

const portfolioHistory = Array.from({ length: 90 }, (_, index) => {
  const date = new Date('2025-09-21T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - 89 + index);
  const progress = index / 89;
  return { date: date.toISOString().slice(0, 10), currentValue: Math.round(43700 + 4800 * progress + 200 * Math.sin(index / 5) * Math.sin(Math.PI * progress)), costBasis: 43700 };
});

const respond = (data: unknown): Handler => async ({ route }) => { await route.fulfill({ json: data }); };

// All fixtures are fictional. Do not read a developer's database or environment.
export const communityDemoHandlers: Record<string, Handler> = {
  'GET /api/analytics/rhythm-comparison': respond(rhythm),
  'GET /api/analytics/forecast-extended': respond(forecast),
  'GET /api/investments/history': respond({ history: portfolioHistory, accounts: [] }),
};
