import { describe, expect, it } from 'vitest';
const math = require('../planning-math.js');

const today = '2026-09-08';
function projection(overrides = {}) {
  const horizon = overrides.horizon || 60;
  return math.calculateProjection({
    today, horizon, cashBalance: 10000, cardCommitments: 700,
    settings: { cash_buffer: 500, next_income_date: '2026-09-10' }, goals: [],
    forecastDays: Array.from({ length: horizon }, (_, i) => ({
      date: math.shiftDays(today, i + 1), expectedOperatingIncome: i === 1 ? 100000 : 0, expectedOperatingExpenses: 100,
    })), ...overrides,
  });
}

describe('planning ledger arithmetic', () => {
  it('excludes future salary from spendability and deducts existing card debt once', () => {
    const result = projection();
    expect(result.available_spend).toBe(8600);
    expect(result.forecast_expenses_until_income).toBe(200);
    expect(result.daily[0].date).toBe('2026-09-09');
    expect(result.ending_balance).toBe(102800);
  });

  it('reserves included savings only and counts contributions through payday separately from the horizon', () => {
    const result = projection({
      settings: { cash_buffer: 500, next_income_date: '2026-10-02' },
      goals: [
        { target_amount: 1250, saved_amount: 1000, monthly_contribution: 200, reserve_location: 'included_cash', target_date: null },
        { target_amount: 1600, saved_amount: 1000, monthly_contribution: 400, reserve_location: 'external', target_date: '2026-10-31' },
      ],
    });
    expect(result.reserved_cash).toBe(1000);
    expect(result.planned_contributions).toBe(600);
    expect(result.total_planned_contributions).toBe(650);
    expect(result.available_spend).toBe(4800);
    expect(result.daily.find((day) => day.date === '2026-11-01').contributions).toBe(50);
  });

  it('reports an overdraft shortfall and never converts a negative balance into available cash', () => {
    const result = projection({ cashBalance: -100 });
    expect(result.available_spend).toBe(0);
    expect(result.shortfall).toBe(1500);
  });

  it('deducts hypothetical costs before payday without spending hypothetical proceeds', () => {
    const result = projection({ changes: [
      { date: '2026-09-10', amount: -250.01, frequency: 'one_time' },
      { date: '2026-09-09', amount: 2000, frequency: 'one_time' },
    ] });
    expect(result.available_spend).toBe(8349.99);
    expect(result.ending_balance).toBe(104549.99);
  });

  it('keeps monthly anchors stable across shorter months and inclusive end dates', () => {
    const dates = [...math.expandChanges([{ date: '2026-01-31', amount: -10, frequency: 'monthly', end_date: '2026-03-31' }], '2026-01-30', 90).keys()];
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(math.monthlyOccurrence('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('aligns goal guidance with upcoming first-of-month reservations and completed goals', () => {
    const goal = { id: 1, target_amount: 1000, saved_amount: 100, monthly_contribution: 300, target_date: '2026-11-15' };
    expect(math.describeGoal(goal, today)).toMatchObject({ months_until_target: 2, required_monthly_contribution: 450, on_track: false });
    expect(math.describeGoal({ ...goal, target_date: today }, today)).toMatchObject({ months_until_target: 0, required_monthly_contribution: null, on_track: false });
    expect(math.describeGoal({ ...goal, saved_amount: 1100 }, today)).toMatchObject({ remaining_amount: 0, required_monthly_contribution: 0, on_track: true });
  });

  it('rejects impossible dates, non-finite values, empty numbers, duplicate changes and invalid horizons', () => {
    expect(math.validDate('2026-02-30')).toBe(false);
    for (const value of [null, '', ' ', NaN, Infinity, -1, 1e10]) expect(() => math.money(value, 'Amount')).toThrow();
    expect(() => math.validateHorizon('180days')).toThrow();
    expect(() => math.validateGoal({ name: 'Goal', target_amount: 100, reserve_location: 'investment' })).toThrow();
    const change = { id: 'x', label: 'Cost', date: '2026-09-20', amount: -100, frequency: 'one_time' };
    expect(() => math.validateChanges([change, change])).toThrow(/unique/);
  });
});
