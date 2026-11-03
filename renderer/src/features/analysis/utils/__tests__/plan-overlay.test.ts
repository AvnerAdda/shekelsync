import { describe, expect, it } from 'vitest';
import { applyPlanOverlay, hasActivePlans, overlayHorizon, type PlanOverlay } from '../plan-overlay';

const overlay = (overrides: Partial<PlanOverlay> = {}): PlanOverlay => ({
  as_of_date: '2026-11-03', status: 'ready', spending_period_end: '2026-11-10', available_spend: 500,
  available_spend_baseline: 500, shortfall: 0, cash_buffer: 1000, reserved_cash: 2000, include_goals: true,
  starting_floor: 3000,
  daily: [
    { date: '2026-11-04', scenario_change: 0, external_contributions: 0, reserved_floor: 3000 },
    { date: '2026-11-20', scenario_change: -4000, external_contributions: 0, reserved_floor: 3000 },
    { date: '2026-12-01', scenario_change: 0, external_contributions: 500, included_contributions: 200, reserved_floor: 3200 },
    { date: '2026-12-15', scenario_change: 1000, external_contributions: 0, reserved_floor: 3200 },
  ],
  scenarios: [{ id: 1, name: 'Car', selected: true }],
  goals: [{ id: 2, name: 'Trip', reserve_location: 'external', monthly_contribution: 500, remaining_amount: 5000 }],
  ...overrides,
});

const rows = [
  { date: '2026-10-01', historicalCumulative: 9000, expectedCumulative: null },
  { date: '2026-11-03', historicalCumulative: 10000, expectedCumulative: 10000 },
  { date: '2026-11-30', historicalCumulative: null, expectedCumulative: 9500 },
  { date: '2026-12-10', historicalCumulative: null, expectedCumulative: 9800 },
  { date: '2026-12-31', historicalCumulative: null, expectedCumulative: 9700 },
];

describe('plan overlay', () => {
  it('accumulates scenario changes and external contributions from today', () => {
    const result = applyPlanOverlay(rows, overlay(), 10000);
    expect(result.rows.map(row => row.plannedCumulative)).toEqual([null, 10000, 5500, 5300, 6200]);
    expect(result.rows.map(row => row.reservedFloor)).toEqual([null, 3000, 3000, 3200, 3200]);
    expect(result).toMatchObject({ plannedEnding: 6200, expectedEnding: 9700, plannedLowest: { date: '2026-12-10', value: 5300 }, dipDate: null });
  });

  it('reports the first day the plans fall below the reserved floor', () => {
    const result = applyPlanOverlay(rows, overlay({ daily: overlay().daily.map(day => ({ ...day, reserved_floor: 6000 })) }), 10000);
    expect(result.dipDate).toBe('2026-11-30');
  });

  it('leaves rows untouched without an overlay or a starting balance', () => {
    expect(applyPlanOverlay(rows, null, 10000).rows.every(row => row.plannedCumulative === null)).toBe(true);
    expect(applyPlanOverlay(rows, overlay(), null).plannedEnding).toBeNull();
  });

  it('knows when a selection can move the curve', () => {
    expect(hasActivePlans(overlay(), { goals: true, scenarioIds: [] })).toBe(true);
    expect(hasActivePlans(overlay({ goals: [] }), { goals: true, scenarioIds: [] })).toBe(false);
    expect(hasActivePlans(overlay({ goals: [] }), { goals: false, scenarioIds: [1] })).toBe(true);
    expect(hasActivePlans(overlay({ goals: [] }), { goals: false, scenarioIds: [99] })).toBe(false);
  });

  it('derives a bounded horizon from the forecast period', () => {
    expect(overlayHorizon({ days: 182 })).toBe(182);
    expect(overlayHorizon({ days: 900 })).toBe(365);
    expect(overlayHorizon({ end: '2026-12-03' }, new Date(2026, 10, 3))).toBe(30);
    expect(overlayHorizon(undefined)).toBe(183);
  });
});
