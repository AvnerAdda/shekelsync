import { describe, expect, it } from 'vitest';
const { buildPredictionIntervals } = require('../prediction-intervals.js');

describe('prediction intervals', () => {
  it('uses every path at each date rather than the paths ranked by their final totals', () => {
    const paths = [[100, -200], [-100, 200], [0, 0]].map(values => ({
      dailyResults: values.map((cashFlow, i) => ({
        date: `2026-10-0${i + 6}`, cashFlow, operatingCashFlow: cashFlow / 2, expenses: Math.max(0, -cashFlow),
      })),
    }));
    const result = buildPredictionIntervals(paths);
    expect(result.level).toBe(0.8);
    expect(result.daily[0].cashFlow.p10).toBe(-80);
    expect(result.daily[1].cashFlow.p10).toBe(-160);
    // Cumulative quantiles are calculated from cumulative paths, never summed daily quantiles.
    expect(result.daily[1].cumulativeCashFlow.p10).toBe(-80);
    expect(result.daily[1].cumulativeOperatingCashFlow.p10).toBe(-40);
    for (const day of result.daily) for (const key of ['cashFlow', 'cumulativeCashFlow', 'expenses']) {
      expect(day[key].p10).toBeLessThanOrEqual(day[key].p50);
      expect(day[key].p50).toBeLessThanOrEqual(day[key].p90);
    }
  });

  it('leaves intervals unavailable when simulations are intentionally disabled', () => {
    expect(buildPredictionIntervals([])).toEqual({ level: 0.8, daily: [] });
  });
});
