import { describe, expect, it } from 'vitest';
import {
  applyInvestmentBasis,
  getDefaultProjectionHorizon,
  resolveHorizonEndDate,
  type NetPositionPoint,
} from '../net-position-projection-helpers';

const anchor = (overrides: Partial<NetPositionPoint> = {}): NetPositionPoint => ({
  date: '2026-09-03', isForecast: false, forecastCumulative: 3800, forecastAfterInvesting: 3300, ...overrides,
});

describe('net position projection helpers', () => {
  it('defaults to end of month for month-to-date and 30 days otherwise', () => {
    expect(getDefaultProjectionHorizon('mtd')).toBe('eom');
    expect(getDefaultProjectionHorizon('30d')).toBe('30');
    expect(getDefaultProjectionHorizon('custom')).toBe('30');
  });

  it('resolves horizon end dates, falling back to 30 days on the last day of the month', () => {
    expect(resolveHorizonEndDate('eom', new Date(2026, 8, 3, 12))).toBe('2026-09-30');
    expect(resolveHorizonEndDate('eom', new Date(2026, 8, 30, 12))).toBe('2026-10-30');
    expect(resolveHorizonEndDate('30', new Date(2026, 8, 3, 12))).toBe('2026-10-03');
  });

  it('clamps custom dates to the fetched forecast window', () => {
    const today = new Date(2026, 8, 3, 12);
    expect(resolveHorizonEndDate('custom', today, '2026-11-15')).toBe('2026-11-15');
    expect(resolveHorizonEndDate('custom', today, '2026-09-03')).toBe('2026-09-04');
    expect(resolveHorizonEndDate('custom', today, '2027-03-01')).toBe('2026-12-02');
    expect(resolveHorizonEndDate('custom', today, null)).toBe('2026-10-03');
  });

  it('shifts every plotted series by the amount invested since the period start', () => {
    const points: NetPositionPoint[] = [
      { date: '2026-09-01', isForecast: false, historicalCumulative: 4000, historicalAfterInvesting: 3500 },
      anchor({ historicalCumulative: 3800, historicalAfterInvesting: 3300, forecastRange: [3800, 3800] }),
      { date: '2026-09-04', isForecast: true, forecastCumulative: 3700, forecastAfterInvesting: 2200, forecastRange: [3500, 3900], p50Cumulative: 3700 },
      // Missing investment data keeps the last known amount deducted.
      { date: '2026-09-05', isForecast: true, forecastCumulative: 4700, forecastRange: [4300, 5100] },
    ];
    expect(applyInvestmentBasis(points, 'before')).toEqual(points);
    const after = applyInvestmentBasis(points, 'after');
    expect(after.map(point => point.historicalCumulative)).toEqual([3500, 3300, undefined, undefined]);
    expect(after.map(point => point.forecastCumulative)).toEqual([undefined, 3300, 2200, 3200]);
    expect(after.map(point => point.forecastRange)).toEqual([undefined, [3300, 3300], [2000, 2400], [2800, 3600]]);
    expect(after[2]).toMatchObject({ p50Cumulative: 2200, forecastAfterInvesting: 2200 });
  });
});
