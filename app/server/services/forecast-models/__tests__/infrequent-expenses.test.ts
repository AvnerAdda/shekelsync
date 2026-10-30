import { describe, expect, it } from 'vitest';
const { buildInfrequentExpenseEstimates: build, applyInfrequentExpenseEstimates: apply } = require('../infrequent-expenses.js');
const engine = {
  formatDate: (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
  isOperatingExpensePattern: () => true,
  refreshForecastDayPredictions: (day: any) => { day.expectedCashFlow = day.expectedIncome - day.expectedExpenses; },
};
const now = new Date(2026, 9, 1, 12);
const dates = Array.from({ length: 183 }, (_, i) => engine.formatDate(new Date(2026, 9, 2 + i, 12)));
const pattern = { categoryType: 'expense', categoryDefinitionId: 2, category: 'Utilities', patternType: 'bi-monthly', avgOccurrencesPerMonth: 0.5 };
const patterns = { 'category:2': pattern };
const row = (date: string, price = -600, extra = {}) => ({ date, price, name: 'Utility company', vendor: 'bank', category_type: 'expense', category_definition_id: 2, status: 'completed', ...extra });
const bills = [row('2026-03-15'), row('2026-05-15'), row('2026-07-15'), row('2026-09-15')];
const feed = row('2026-01-01', 1000, { category_type: 'income', category_definition_id: 9 });
const estimate = (rows = bills, truth = {}, forecastDates = dates, asOf = now) => build(rows, patterns, forecastDates, asOf, engine, truth).get('category:2');
const total = (result: any) => [...result.daily.values()].reduce((sum: number, day: any) => sum + day.probability * day.amount, 0);

describe('infrequent expense estimates', () => {
  it('pays a two-month bill once per due cycle, rather than on every likely weekday', () => {
    const result = estimate();
    expect(result.basis).toBe('recurring_bill');
    expect([...result.daily.keys()]).toEqual(['2026-11-15', '2027-01-15', '2027-03-15']);
    expect(total(result)).toBe(1800);
  });

  it('uses the recent typical bill amount and combines accounts paid on the same day', () => {
    const rows = bills.flatMap(payment => [row(payment.date, -200), row(payment.date, -400, { account_number: 'other' })]);
    expect(total(estimate(rows))).toBe(1800);
    expect(total(estimate([...bills.slice(0, 1), ...bills.slice(1).map(payment => ({ ...payment, price: -900 }))]))).toBe(2700);
  });

  it('preserves month-end cadence across short months and leap years', () => {
    const rows = ['2027-08-31', '2027-09-30', '2027-10-31'].map(date => row(date));
    const forecastDates = ['2027-11-29', '2027-11-30', '2028-01-31', '2028-02-28', '2028-02-29'];
    expect([...estimate(rows, {}, forecastDates, new Date(2027, 10, 1, 12)).daily.keys()])
      .toEqual(['2027-11-30', '2028-01-31', '2028-02-29']);
  });

  it('does not duplicate a bill paid early in the current cycle', () => {
    expect(estimate([...bills.slice(0, -1), row('2026-09-13')], {}, ['2026-09-15'], new Date(2026, 8, 14, 12)).daily.size).toBe(0);
  });

  it('learns local payment dates from timestamp imports and is independent of row order', () => {
    const timestamped = bills.map(payment => ({ ...payment, date: new Date(`${payment.date}T00:00:00`).toISOString() }));
    expect(estimate(timestamped)).toEqual(estimate(bills));
    expect(estimate([...bills].reverse())).toEqual(estimate(bills));
  });

  it('stops an automatic bill after more than two missed cycles', () => {
    expect(estimate(bills.slice(0, 3), {}, ['2027-03-15'], new Date(2027, 2, 1, 12)).daily.size).toBe(0);
  });

  it.each([
    ['2026-05-02', '2026-06-21', '2026-09-15'],
    ['2026-05-01', '2026-07-15', '2026-09-28'],
  ])('uses a calendar allowance for purchases without dependable cadence (%j)', (...paymentDates: string[]) => {
    const result = estimate([feed, ...paymentDates.map(date => row(date, -300))]);
    expect(result.basis).toBe('irregular_allowance');
    expect(result.daily.size).toBe(dates.length);
    expect(total(result)).toBeCloseTo(900 / 180 * dates.length);
    expect(result.daily.get(dates[0]).timingBasis).toBe('daily_average');
  });

  it('counts zero-spend days, nets refunds, and ignores incomplete and future evidence', () => {
    const rows = [feed, row('2026-09-10', -600), row('2026-09-11', 150)];
    const clean = estimate(rows);
    expect(total(clean)).toBeCloseTo(450 / 180 * dates.length);
    const dirty = [...rows, row('2026-10-01', -10000), row('2026-11-01', -10000), row('2026-09-12', -10000, { status: 'pending' }), row('2026-02-30', -10000), row('bad-date', -10000)];
    expect(total(estimate(dirty))).toBeCloseTo(total(clean));
    expect(total(estimate([feed, row('2026-09-10', -600), row('2026-09-11', 900)]))).toBe(0);
  });

  it('requires enough feed coverage for an allowance and avoids combining different merchants into a bill', () => {
    expect(estimate([row('2026-09-10')])).toBeUndefined();
    expect(estimate([feed, ...bills.map((payment, i) => ({ ...payment, name: `Merchant ${i}` }))]).basis).toBe('irregular_allowance');
    expect(estimate([feed, ...bills.map((payment, i) => ({ ...payment, vendor: `bank ${i}` }))]).basis).toBe('irregular_allowance');
  });

  it('schedules each bill in a category that mixes merchants, keeping one-off purchases as an allowance', () => {
    const electric = ['2026-04-22', '2026-06-22', '2026-08-22'].map(date => row(date, -450, { name: 'Israel Electric' }));
    const gas = ['2026-03-04', '2026-05-04', '2026-07-04', '2026-09-04'].map(date => row(date, -200, { name: 'Dorgaz' }));
    const result = build([feed, ...electric, ...gas, row('2026-05-27', -2000, { name: 'Marble' })], patterns, dates, now, engine, {});
    const bills = [...result.values()].filter((entry: any) => entry.basis === 'recurring_bill');
    expect(bills.map((entry: any) => [entry.transactionName, [...entry.daily.keys()][0]]).sort()).toEqual([
      ['Dorgaz', '2026-11-04'], ['Israel Electric', '2026-10-22'],
    ]);
    // The marble purchase stays a spread allowance, not a bill.
    expect(total(result.get('category:2'))).toBeCloseTo(2000 / 180 * dates.length);
  });

  it('accepts two regular payments of a monthly to quarterly bill with their evidence count', () => {
    const twice = estimate([row('2026-06-15'), row('2026-08-15')]);
    expect(twice.basis).toBe('recurring_bill');
    expect(twice.daily.get('2026-10-15')).toMatchObject({ amount: 600, evidenceCount: 2 });
    // Six months apart is not enough to know the schedule.
    expect(estimate([feed, row('2026-03-15'), row('2026-09-15')]).basis).toBe('irregular_allowance');
  });

  it.each([
    { patterns: [{ categoryDefinitionId: 2, source: 'manual' }] },
    { patterns: [{ categoryDefinitionId: 2, source: 'detected', confirmed: true }] },
    { patterns: [{ categoryDefinitionId: 2, source: 'detected', state: 'paused' }] },
    { patterns: [{ categoryDefinitionId: 2, source: 'detected', corrections: [{}] }] },
    { categoryExpectations: [{ categoryDefinitionId: 2 }] },
  ])('preserves saved financial controls (%j)', truth => {
    expect(estimate(bills, truth)).toBeUndefined();
  });

  it('does not replace frequent spending or income patterns', () => {
    for (const overrides of [{ avgOccurrencesPerMonth: 5 }, { categoryType: 'income' }, { patternType: 'weekly' }]) {
      expect(build(bills, { 'category:2': { ...pattern, ...overrides } }, dates, now, engine).size).toBe(0);
    }
  });

  it('reconciles chart contributions and simulation expectations while keeping other categories', () => {
    const forecastDates = ['2026-11-14', '2026-11-15'];
    const old = { patternKey: 'category:2', categoryType: 'expense', probabilityWeightedAmount: 10000 };
    const other = { patternKey: 'category:3', categoryType: 'expense', probabilityWeightedAmount: 25 };
    const days = forecastDates.map(date => ({ date, expectedIncome: 100, predictions: [old, other] }));
    const simulations = forecastDates.map(date => ({ date, entries: [old, { ...other, probability: 1, avgAmount: 25 }] }));
    apply(days, simulations, build(bills, patterns, forecastDates, now, engine), engine);
    expect(days.map((day: any) => day.expectedExpenses)).toEqual([25, 625]);
    expect(days.map((day: any) => day.expectedCashFlow)).toEqual([75, -525]);
    for (let i = 0; i < days.length; i++) {
      const total = simulations[i].entries.reduce((sum: number, entry: any) => sum + entry.probability * entry.avgAmount, 0);
      expect(total).toBe((days[i] as any).expectedExpenses);
    }
    expect((days[1].predictions[1] as any).forecastBasis).toBe('recurring_bill');
  });
});
