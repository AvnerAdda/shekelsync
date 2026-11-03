import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reconcileMortgage, matcherCandidates } = require('../reconciliation.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const matcher = require('../debit-matcher.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildMortgageSchedule } = require('../engine.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require('../service.js');

const schedule = buildMortgageSchedule({
  asOf: '2026-12-20',
  tracks: [{ id: 'f', type: 'fixed_unlinked', rate: 4.45, termMonths: 360, firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-09-10', amount: 1000000 }] }],
});
const payment = schedule.monthly.find((point: any) => point.month === '2026-10').payment;
const debit = (date: string, amount: number, name = 'דסק-משכנתא חיוב') => ({ name, vendor: 'discount', account_number: '0001', price: -amount, date: `${date}T00:00:00.000Z` });

describe('debit matcher', () => {
  it('derives the most frequent mortgage source and ignores fees and other debits', () => {
    const derived = matcher.deriveMatcher([
      debit('2026-10-10', 5000), debit('2026-11-10', 5000), debit('2026-10-12', 300, 'עמלת משכנתא'), debit('2026-10-11', 80, 'Supermarket'),
    ]);
    expect(derived).toMatchObject({ vendor: 'discount', accountNumber: '0001', pattern: 'דסק משכנתא חיוב' });
    expect(matcher.matchesDebit(derived, debit('2026-12-10', 5000))).toBe(true);
    expect(matcher.matchesDebit(derived, { ...debit('2026-12-10', 5000), vendor: 'leumi' })).toBe(false);
    expect(matcher.matchesDebit(derived, { ...debit('2026-12-10', 5000), price: 5000 })).toBe(false);
    expect(matcher.matchesForecastSource(derived, { transactionName: 'דסק-משכנתא חיוב', vendor: 'discount' })).toBe(true);
  });
});

describe('reconcileMortgage', () => {
  const m = matcher.cleanMatcher({ vendor: 'discount', accountNumber: '0001', pattern: 'משכנתא' });

  it('marks months ok, drift, missing, unexpected and pending', () => {
    const result = reconcileMortgage({
      schedule,
      matcher: m,
      today: '2026-12-05',
      transactions: [debit('2026-09-09', 3400), debit('2026-10-10', payment + 5), debit('2026-11-10', payment + 200)],
    });
    const byMonth = Object.fromEntries(result.months.map((item: any) => [item.month, item.status]));
    expect(byMonth).toEqual({ '2026-09': 'unexpected', '2026-10': 'ok', '2026-11': 'drift', '2026-12': 'pending' });
    expect(result.summary.latestMonth).toBe('2026-11');
    expect(result.summary.suggestion).toBe('latest_drift');
    expect(result.matchedCount).toBe(3);

    const missing = reconcileMortgage({ schedule, matcher: m, today: '2026-12-05', transactions: [debit('2026-10-10', payment)] });
    expect(missing.months.find((item: any) => item.month === '2026-11').status).toBe('missing');
    expect(missing.summary.suggestion).toBe('missing_payment');
  });

  it('explains a large gap with the tracks that are not paying yet', () => {
    const twoTracks = buildMortgageSchedule({
      asOf: '2026-12-20',
      tracks: [
        { id: 'f', type: 'fixed_unlinked', rate: 4.45, termMonths: 360, firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-09-10', amount: 1000000 }] },
        // Mis-dated: drawn in November instead of September.
        { id: 'p', type: 'prime', rate: 4, margin: -0.75, termMonths: 360, firstPaymentDate: '2026-12-01', tranches: [{ drawDate: '2026-11-01', amount: 500000 }] },
      ],
    });
    const result = reconcileMortgage({
      schedule: twoTracks, matcher: m, today: '2026-11-05',
      transactions: [debit('2026-10-10', payment + 2400)],
    });
    expect(result.summary.suggestion).toBe('large_gap');
    expect(result.summary.composition.paying).toEqual([expect.objectContaining({ trackId: 'f', date: '2026-10-10' })]);
    expect(result.summary.composition.notYetPaying).toEqual([expect.objectContaining({ trackId: 'p', firstPaymentDate: '2026-12-01' })]);
  });

  it('does not report missing payments before the bank history starts', () => {
    const result = reconcileMortgage({
      schedule, matcher: m, today: '2026-12-20', historyStart: '2026-11-03',
      transactions: [debit('2026-11-10', payment), debit('2026-12-10', payment)],
    });
    expect(result.months.map((item: any) => item.month)).toEqual(['2026-11', '2026-12']);
    expect(result.monthsWithoutHistory).toBe(1); // October
    expect(result.summary.latestStatus).toBe('ok');
  });

  it('flags a consistent drift in the same direction', () => {
    const result = reconcileMortgage({
      schedule, matcher: m, today: '2026-12-20',
      transactions: [debit('2026-10-10', payment + 75), debit('2026-11-10', payment + 80), debit('2026-12-10', payment + 78)],
    });
    expect(result.summary.suggestion).toBe('consistent_drift');
    expect(result.summary.averageDifference).toBeCloseTo(77.67, 1);
  });

  it('reports no matcher and lists candidates', () => {
    expect(reconcileMortgage({ schedule, matcher: null, today: '2026-12-05', transactions: [] }).status).toBe('no_matcher');
    const candidates = matcherCandidates([debit('2026-10-10', 5000), debit('2026-11-10', 5100)], matcher.isMortgagePayment, matcher.normalizeName);
    expect(candidates).toEqual([expect.objectContaining({ vendor: 'discount', count: 2, lastAmount: 5100 })]);
  });
});

describe('service helpers', () => {
  it('computes a price-index ratio from the purchase month', () => {
    const points = [{ period: '2025-01', value: 500 }, { period: '2025-07', value: 520 }, { period: '2026-07', value: 546 }];
    expect(service.indexRatio(points, '2025-03')).toEqual({ ratio: 546 / 500, fromPeriod: '2025-01', toPeriod: '2026-07' });
    expect(service.indexRatio(points, '2024-12')).toBeNull();
    expect(service.indexRatio(points, '2026-08').ratio).toBe(1);
  });

  it('turns linked payments into purchase costs, excluding mortgage debits', () => {
    const costs = service.costsFromLinkedTransactions([
      { name: 'תשלום שוברי גביה', price: -500000, date: '2026-05-25T00:00:00.000Z' },
      { name: 'העברה לספק לדוגמה', price: -2500, date: '2026-05-19T00:00:00.000Z' },
      { name: 'דסק-משכנתא חיוב', price: -2500.75, date: '2026-10-10T00:00:00.000Z' },
    ], 2000000);
    expect(costs.map((cost: any) => [cost.type, cost.amount, cost.deductible])).toEqual([
      ['down_payment', 500000, false],
      ['other', 2500, true],
    ]);
  });
});
