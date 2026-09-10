import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ensemble = require('../ensemble-v1.js');

describe('ensemble-v1 forecast model', () => {
  it('blends pattern and time-series components by horizon', () => {
    const { blendDailyForecasts } = ensemble._internal;
    const now = new Date('2026-07-01T12:00:00');
    const patternDays = [{
      date: '2026-07-02',
      expectedIncome: 100,
      expectedExpenses: 40,
      expectedCashFlow: 60,
      expectedOperatingIncome: 100,
      expectedNonOperatingIncome: 0,
      expectedOperatingExpenses: 40,
      expectedNonOperatingExpenses: 0,
      expectedOperatingCashFlow: 60,
      expectedNonOperatingCashFlow: 0,
      predictions: [],
      topPredictions: [],
    }];
    const tsDays = [{
      date: '2026-07-02',
      expectedIncome: 60,
      expectedExpenses: 20,
      expectedCashFlow: 40,
    }];

    const blended = blendDailyForecasts(patternDays, tsDays, now);
    expect(blended[0].expectedIncome).toBeGreaterThan(60);
    expect(blended[0].expectedIncome).toBeLessThan(100);
    expect(blended[0].modelBlend).toMatchObject({ horizonDays: 1, patternWeight: 0.75, tsWeight: 0.25 });
  });

  it('forecasts variable spending with holt linear smoothing', () => {
    const { holtLinearForecast } = ensemble._internal;
    const series = [
      { date: '2026-06-01', value: 100 },
      { date: '2026-06-02', value: 110 },
      { date: '2026-06-03', value: 120 },
      { date: '2026-06-04', value: 130 },
    ];
    expect(holtLinearForecast(series, 3)).toBeGreaterThan(130);
  });

  it('computes residual quantiles for uncertainty bands', () => {
    const { quantile } = ensemble._internal;
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBeCloseTo(1.9, 5);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 5);
  });
});
