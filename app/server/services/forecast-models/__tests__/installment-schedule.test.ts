import { describe, expect, it } from 'vitest';

const {
  parseInstallment,
  isScheduledInstallmentPayment,
  buildInstallmentSchedule,
  applyInstallmentSchedule,
} = require('../installment-schedule.js');
const engine = require('../../forecast.js')._internal;

const tx = (date: string, number: number, total: number, extra: any = {}) => ({
  date, price: -4000, identifier: `installment-${date}-${number}`, name: 'Appliance store',
  vendor: 'max', account_number: '1234', type: 'installments', memo: `תשלום ${number} מתוך ${total}`,
  category_type: 'expense', category_definition_id: 60, category_name: 'אלקטרוניקה',
  category_name_en: 'Electronics', status: 'completed', ...extra,
});
const dates = (start: string, count: number) => Array.from({ length: count }, (_, index) => {
  const date = new Date(`${start}T12:00:00`);
  date.setDate(date.getDate() + index);
  return engine.formatDate(date);
});
const build = (rows: any[], start = '2026-07-10', count = 120, snapshot: any = {}) => {
  const now = new Date(`${start}T12:00:00`);
  now.setDate(now.getDate() - 1);
  return buildInstallmentSchedule(rows, dates(start, count), now, snapshot);
};
// Imported card charges are local midnight stored as UTC; this keeps tests independent of TZ.
const localMidnight = (year: number, month: number, day: number) => new Date(year, month - 1, day).toISOString();
const bucket = (year: number, month: number, day: number) => localMidnight(year, month, day).slice(0, 10);

describe('installment plans from card payment memos', () => {
  it('reads payment number and total the way card scrapers do', () => {
    expect(parseInstallment(tx('2026-06-03', 2, 4))).toEqual({ number: 2, total: 4 });
    expect(parseInstallment(tx('2026-06-03', 1, 1))).toBeNull();
    expect(parseInstallment(tx('2026-06-03', 5, 4))).toBeNull();
    expect(parseInstallment({ ...tx('2026-06-03', 2, 4), type: 'normal' })).toBeNull();
    expect(parseInstallment({ ...tx('2026-06-03', 2, 4), memo: '' })).toBeNull();
  });

  it('schedules each remaining payment on the purchase day and stops after the last one', () => {
    const events = build([tx('2026-06-03', 1, 4), tx('2026-07-03', 2, 4)]);
    expect(events.map((event: any) => [event.date, event.amount, event.installmentNumber])).toEqual([
      ['2026-08-03', 4000, 3],
      ['2026-09-03', 4000, 4],
    ]);
    expect(events[0]).toMatchObject({ installmentTotal: 4, categoryDefinitionId: 60, category: 'Electronics',
      transactionName: 'Appliance store', vendor: 'max' });
    expect(build([tx('2026-06-03', 4, 4)])).toEqual([]);
  });

  it('projects the full plan from its first payment and clamps month-end purchase days', () => {
    const events = build([tx('2026-01-31', 1, 4)], '2026-02-01');
    expect(events.map((event: any) => event.date)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
    const fromClamped = build([tx('2026-01-31', 1, 4), tx('2026-02-28', 2, 4)], '2026-03-01');
    expect(fromClamped.map((event: any) => event.date)).toEqual(['2026-03-31', '2026-04-30']);
  });

  it('places payments in the same stored-day bucket as imported charges', () => {
    const events = build([tx(localMidnight(2026, 6, 1), 1, 3)], '2026-06-20');
    expect(events.map((event: any) => event.date)).toEqual([bucket(2026, 7, 1), bucket(2026, 8, 1)]);
  });

  it('keeps separate purchases, accounts, and repeated merchants apart', () => {
    const rows = [
      tx('2026-06-03', 1, 4),
      tx('2026-07-03', 1, 4, { price: -500 }),
      tx('2026-06-03', 1, 4, { account_number: '9999', price: -300 }),
    ];
    const events = build(rows);
    expect(new Set(events.map((event: any) => event.planKey)).size).toBe(3);
    expect(events.filter((event: any) => event.date === '2026-08-03').map((event: any) => event.amount).sort())
      .toEqual([300, 4000, 500]);
  });

  it('ignores pending, future, refunded and expectation-controlled categories', () => {
    expect(build([tx('2026-06-03', 1, 4, { status: 'pending' })])).toEqual([]);
    expect(build([tx('2026-08-03', 1, 4)])).toEqual([]);
    expect(build([tx('2026-06-03', 1, 4, { price: 4000 })])).toEqual([]);
    expect(build([tx('2026-06-03', 1, 4)], '2026-07-10', 120,
      { categoryExpectations: [{ categoryDefinitionId: 60 }] })).toEqual([]);
  });

  it('removes only later payments from spending history', () => {
    const expectations = new Set([61]);
    expect(isScheduledInstallmentPayment(tx('2026-06-03', 1, 4), expectations)).toBe(false);
    expect(isScheduledInstallmentPayment(tx('2026-07-03', 2, 4), expectations)).toBe(true);
    expect(isScheduledInstallmentPayment(tx('2026-07-03', 2, 4, { category_definition_id: 61 }), expectations)).toBe(false);
    expect(isScheduledInstallmentPayment({ ...tx('2026-07-03', 2, 4), type: 'normal' }, expectations)).toBe(false);
  });

  it('adds scheduled payments to expenses, cash flow and simulations', () => {
    const events = build([tx('2026-06-03', 1, 4), tx('2026-07-03', 2, 4)]);
    const forecasts: any[] = [{ date: '2026-08-03', predictions: [], expectedIncome: 100, expectedExpenses: 25 }];
    const simulations = [{ date: '2026-08-03', monthKey: '2026-08', entries: [] as any[] }];
    applyInstallmentSchedule(forecasts, simulations, events, engine);
    expect(forecasts[0].expectedExpenses).toBe(4025);
    expect(forecasts[0].expectedCashFlow).toBe(-3925);
    expect(forecasts[0].predictions[0]).toMatchObject({
      categoryType: 'expense', expenseType: 'operating', timingBasis: 'scheduled',
      predictionKind: 'installment_payment', probability: 1, probabilityWeightedAmount: 4000,
      installmentNumber: 3, installmentTotal: 4,
    });
    expect(simulations[0].entries).toEqual([expect.objectContaining({
      categoryType: 'expense', patternType: 'installment_schedule', probability: 1, avgAmount: 4000, stdDev: 0,
    })]);
  });
});
