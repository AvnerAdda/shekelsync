import { describe, expect, it } from 'vitest';
const { selectExpenseEstimator } = require('../expense-estimator.js');
const forecast = require('../../forecast.js')._internal;
const date = (index: number) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
const now = (days: number) => new Date(2026, 0, 1 + days, 12);
const history = (days: number, amount: (index: number) => number = () => 50) => Array.from({ length: days }, (_, index) => ({
  date: date(index), price: -amount(index),
}));

describe('adaptive variable spending selection', () => {
  it('uses the calendar average when a constant daily rate outperforms the monthly estimate', () => {
    const result = selectExpenseEstimator(history(240), now(240));
    expect(result.estimator).toBe('calendar_average');
    expect(result.dailyRate).toBe(50);
    expect(result.validation.origins).toBe(12);
    expect(result.validation.scores.calendar_average).toBe(0);
    expect(result.validation.lastOrigin < result.validation.observedThrough).toBe(true);
  });

  it.each([true, false])('adapts after a sustained spending change (increase: %s)', increase => {
    const older = increase ? 50 : 200;
    const recent = increase ? 200 : 50;
    const result = selectExpenseEstimator(history(240, index => index < 150 ? older : recent), now(240));
    expect(result.estimator).toBe('adaptive');
    expect(result.dailyRate).toBeCloseTo(recent);
    expect(result.validation.scores.adaptive).toBeLessThan(result.validation.scores.robust_monthly);
    for (const horizon of ['daily', 'days_7', 'days_30']) {
      expect(result.validation.byHorizon.adaptive[horizon])
        .toBeLessThanOrEqual(result.validation.byHorizon.robust_monthly[horizon] * 1.01);
    }
  });

  it('does not let a newly observed isolated large purchase reset the usual rate', () => {
    const result = selectExpenseEstimator(history(240, index => index === 235 ? 10000 : 50), now(240));
    expect(result.estimator).toBe('robust_monthly');
    expect(result.dailyRate).toBeNull();
  });

  it.each([0, 45, 100, 150])('retains the robust estimate without enough matured comparisons (%s days)', days => {
    expect(selectExpenseEstimator(history(days), now(days))).toMatchObject({
      estimator: 'robust_monthly', dailyRate: null, validation: null,
    });
  });

  it('excludes future evidence and the potentially incomplete current day', () => {
    const rows = history(240);
    const original = selectExpenseEstimator(rows, now(240));
    const dirty = [...rows,
      { date: date(240), price: -1000000 },
      { date: date(270), price: -1000000 },
      { date: '2026-02-30', price: -1000000 },
      { date: 'bad-date', price: -1000000 },
      { date: date(230), price: NaN },
    ];
    expect(selectExpenseEstimator(dirty, now(240))).toEqual(original);
  });

  it('nets refunds against spending and counts calendar days without purchases', () => {
    const rows = history(240, () => 75).flatMap(row => [row, { date: row.date, price: 25 }]);
    expect(selectExpenseEstimator(rows, now(240)).dailyRate).toBeCloseTo(50);
    const weekly = history(240, index => index % 7 === 0 ? 350 : 0).filter(row => row.price !== 0);
    const result = selectExpenseEstimator(weekly, now(240));
    // Averaging only purchase days would give 350 rather than roughly 50.
    // These weekly origins have twelve purchases in training and five in the
    // thirty-day target: (5 * 350 - (12 * 350 / 90) * 30) / 30.
    expect(result.validation.byHorizon.calendar_average.days_30).toBeCloseTo(350 / 30);
    expect(result.validation.byHorizon.calendar_average.daily).toBeLessThan(100);
  });

  it('is independent of input order, currency scale, and the wall-clock date', () => {
    const rows = history(240, index => index < 150 ? 50 : 200);
    const original = selectExpenseEstimator(rows, now(240));
    expect(selectExpenseEstimator([...rows].reverse(), now(240))).toEqual(original);
    for (const scale of [0.01, 10000]) {
      const scaled = selectExpenseEstimator(rows.map(row => ({ ...row, price: row.price * scale })), now(240));
      expect(scaled.estimator).toBe(original.estimator);
      expect(scaled.dailyRate).toBeCloseTo(original.dailyRate * scale);
    }
    expect(selectExpenseEstimator([...rows, ...history(30).map(row => ({ ...row, date: '2027' + row.date.slice(4) }))], now(240)))
      .toEqual(original);
  });

  it.each([{ gaps: false, older: false }, { gaps: true, older: false }, { gaps: false, older: true }])(
    'benchmarks the live robust baseline, including month ends and missing ledger months (%j)', ({ gaps, older }) => {
    const availableMonths = ['2026-01', '2026-03', '2026-05', '2026-07', '2026-09'];
    const days = older ? 600 : 273;
    const rows = history(days, index => !older || index === 0 || (index >= 181 && index <= 310) ? 50 : 0)
      .filter(row => row.price !== 0 && (!gaps || availableMonths.includes(row.date.slice(0, 7))))
      .map(row => ({ ...row, category_type: 'expense', category_definition_id: 2 }));
    const ledger = older ? [...rows, ...history(days).filter(row => row.date.endsWith('-01')).map(row => ({
      ...row, category_type: 'income', category_definition_id: 9, price: 1000,
    }))] : rows;
    const completedMonths = [...new Set(ledger.filter(row => row.date.slice(0, 7) < date(days).slice(0, 7))
      .map(row => row.date.slice(0, 7)))].sort();
    const selection = selectExpenseEstimator(rows, now(days), { completedMonths });
    if (older) expect(selectExpenseEstimator(rows, now(days))).toEqual(selection);
    const pattern = { patternKey: 'category:2', category: 'Groceries', categoryDefinitionId: 2,
      categoryType: 'expense', patternType: 'weekly', avgOccurrencesPerMonth: 4,
      firstTransactionDate: rows[0].date };
    const patterns = { 'category:2': pattern };
    const losses: number[] = [];
    const firstOrigin = new Date(selection.validation.firstOrigin + 'T12:00:00Z').getTime();
    for (let origin = new Date(selection.validation.lastOrigin + 'T12:00:00Z').getTime(); origin >= firstOrigin; origin -= 7 * 86400000) {
      const originKey = new Date(origin).toISOString().slice(0, 10);
      const issued = new Date(origin + 86400000);
      const past = ledger.filter(row => row.date <= originKey);
      const live = forecast.buildVariableExpenseMonthlyBaselines(past, patterns, issued)['category:2'];
      expect(live).toBeDefined();
      let loss = 0;
      for (const horizon of [7, 30]) {
        const groups = new Map<string, { date: string }[]>();
        for (let day = 1; day <= horizon; day++) {
          const key = new Date(origin + day * 86400000).toISOString().slice(0, 10);
          const month = key.slice(0, 7);
          if (!groups.has(month)) groups.set(month, []);
          groups.get(month)!.push({ date: key });
        }
        const expected = [...groups.values()].reduce((sum, days) => sum + forecast.calculateVariableExpenseBaselineTarget(
          { ...live, dailyRate: null }, days, [], issued, patterns,
        ), 0);
        const through = new Date(origin + horizon * 86400000).toISOString().slice(0, 10);
        const actual = Math.max(0, rows.filter(row => row.date > originKey && row.date <= through)
          .reduce((sum, row) => sum - row.price, 0));
        loss += Math.abs(expected - actual) / horizon;
      }
      losses.push(loss / 2);
    }
    expect(losses).toHaveLength(selection.validation.origins);
    expect(selection.validation.scores.robust_monthly)
      .toBeCloseTo(losses.reduce((sum, loss) => sum + loss, 0) / losses.length, 8);
  });

  it('does not compare against a monthly baseline that lacked recurring expense history', () => {
    const rows = [{ date: '2026-01-01', price: -1000 }, { date: '2026-08-01', price: -1000 }];
    expect(selectExpenseEstimator(rows, now(240))).toMatchObject({
      estimator: 'robust_monthly', dailyRate: null, validation: null,
    });
  });

  it('honors the configured monthly history window during comparison', () => {
    const rows = history(273, index => index < 181 ? 50 : 150);
    const shorter = selectExpenseEstimator(rows, now(273), { baselineMonths: 3 });
    const longer = selectExpenseEstimator(rows, now(273), { baselineMonths: 6 });
    expect(shorter.validation.scores.robust_monthly).not.toBeCloseTo(longer.validation.scores.robust_monthly, 4);
  });
});
