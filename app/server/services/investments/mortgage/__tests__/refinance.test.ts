import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const refinance = require('../refinance.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ratePaths = require('../rate-paths.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildMortgageSchedule } = require('../engine.js');

const asOf = '2026-11-01';
const series = { policyRate: [{ date: '2025-01-01', value: 3.25 }], cpi: [{ period: '2026-09', value: 105.3 }], inflationExpectations: { y1: 1.7 } };
const paths = ratePaths.buildPaths({ asOf, series });
const market = { fixed_unlinked: { period: '2026-08', value: 4.62 }, fixed_cpi: { period: '2026-08', value: 3.29 }, variable_cpi: { period: '2026-08', value: 3.19, anchor: 1.64, margin: 1.55 } };
const common = { termMonths: 360, firstPaymentDate: '2026-10-10' };
const input = {
  events: [],
  options: {},
  tracks: [
    { id: 'fixed', type: 'fixed_unlinked', rate: 5.2, ...common, tranches: [{ drawDate: '2026-09-10', amount: 800000 }] },
    { id: 'prime', type: 'prime', margin: -0.5, ...common, tranches: [{ drawDate: '2026-09-10', amount: 400000 }] },
  ],
};

describe('compareRefinance', () => {
  it('weighs the saving against a large early-repayment fee', () => {
    // 5.2% fixed while the market is at 4.62%: repaying costs a capitalization fee.
    const result = refinance.compareRefinance({
      asOf, input, paths, market,
      closeTrackIds: ['fixed'],
      offerTracks: [{ type: 'fixed_unlinked', rate: 4.2, termMonths: 358, sharePct: 100 }],
    });
    expect(result.date).toBe('2026-11-10');
    expect(result.closedBalance).toBeGreaterThan(795000);
    expect(result.offerAmount).toBe(result.closedBalance);
    expect(result.savings.monthlyPaymentChange).toBeLessThan(-400);
    expect(result.costs.prepaymentFees).toBeGreaterThan(20000);
    expect(result.savings.nominal).toBeGreaterThan(result.savings.presentValue);
    expect(result.breakEvenMonths).toBeGreaterThan(36);
    expect(result.verdict).toBe('marginal');
    // Only the refinanced track changes.
    expect(result.offer.maturityDate).toBe(result.current.maturityDate);
  });

  it('is worth it when there is no capitalization fee', () => {
    const cheapTrack = { ...input, tracks: [{ ...input.tracks[0], rate: 4.5 }, input.tracks[1]] };
    const result = refinance.compareRefinance({
      asOf, input: cheapTrack, paths, market,
      closeTrackIds: ['fixed'],
      offerTracks: [{ type: 'fixed_unlinked', rate: 3.9, termMonths: 358 }],
    });
    expect(result.costs.prepaymentFees).toBe(60);
    expect(result.breakEvenMonths).toBeLessThanOrEqual(12);
    expect(result.verdict).toBe('worth_it');
  });

  it('rejects a more expensive offer', () => {
    const result = refinance.compareRefinance({
      asOf, input, paths, market,
      closeTrackIds: ['fixed'],
      offerTracks: [{ type: 'fixed_unlinked', rate: 5.6, termMonths: 358 }],
    });
    expect(result.savings.monthlyPaymentChange).toBeGreaterThan(0);
    expect(result.verdict).toBe('not_worth_it');
    expect(result.breakEvenMonths).toBeNull();
  });

  it('splits the balance across offer tracks and can finance the costs', () => {
    const result = refinance.compareRefinance({
      asOf, input, paths, market,
      closeTrackIds: ['fixed', 'prime'],
      offerTracks: [
        { type: 'fixed_unlinked', rate: 4.4, termMonths: 300, sharePct: 50 },
        { type: 'prime', margin: -0.9, termMonths: 300, sharePct: 50 },
      ],
      switchingCosts: 5000,
      financeFees: true,
    });
    const total = result.offerTracks.reduce((sum: number, track: any) => sum + track.amount, 0);
    expect(total).toBeCloseTo(result.closedBalance + result.costs.total, 0);
    expect(result.costs.financed).toBe(true);
    expect(result.offer.maturityDate < result.current.maturityDate).toBe(true);
  });

  it('validates its input', () => {
    expect(() => refinance.compareRefinance({ asOf, input, paths, market, closeTrackIds: [], offerTracks: [{ type: 'prime', margin: 0 }] }))
      .toThrow(/at least one track/);
    expect(() => refinance.compareRefinance({ asOf, input, paths, market, closeTrackIds: ['fixed'], offerTracks: [] }))
      .toThrow(/offer track/);
  });
});

describe('resolveShares', () => {
  it('fills unspecified shares with the remainder and never exceeds 100%', () => {
    expect(refinance.resolveShares([{ sharePct: null }, { sharePct: 30 }])).toEqual([0.7, 0.3]);
    expect(refinance.resolveShares([{ sharePct: null }, { sharePct: null }])).toEqual([0.5, 0.5]);
    expect(refinance.resolveShares([{ sharePct: 60 }, { sharePct: 60 }])).toEqual([0.5, 0.5]);
    expect(refinance.resolveShares([{ sharePct: 120 }, { sharePct: null }])).toEqual([1, 0]);
  });

  it('allocates the whole balance with a partially specified split', () => {
    const result = refinance.compareRefinance({
      asOf, input, paths, market,
      closeTrackIds: ['fixed'],
      offerTracks: [{ type: 'prime', margin: -0.5, termMonths: 300, sharePct: null }, { type: 'fixed_unlinked', rate: 4, termMonths: 300, sharePct: 30 }],
    });
    const amounts = result.offerTracks.map((track: any) => track.amount);
    expect(amounts.every((amount: number) => amount > 0)).toBe(true);
    expect(amounts[0] / result.offerAmount).toBeCloseTo(0.7, 2);
    expect(amounts.reduce((sum: number, amount: number) => sum + amount, 0)).toBeCloseTo(result.offerAmount, 0);
  });
});

describe('buildRefinanceCheck', () => {
  it('benchmarks fixed tracks at the market average and skips prime', () => {
    const tracks = refinance.buildRefinanceCheck({ asOf, input, paths, market });
    const fixed = tracks.find((track: any) => track.trackId === 'fixed');
    expect(fixed).toMatchObject({ status: 'checked', marketRate: 4.62 });
    expect(fixed.monthlyPaymentChange).toBeLessThan(0); // 5.2% → 4.62%
    expect(tracks.find((track: any) => track.trackId === 'prime').status).toBe('no_benchmark');
  });
});

describe('buildStressTest', () => {
  it('orders scenarios by severity and reports payment-to-income', () => {
    const result = refinance.buildStressTest({
      asOf,
      monthlyIncome: 25000,
      runSchedule: (scenario: any) => buildMortgageSchedule({ ...input, paths: ratePaths.buildPaths({ asOf, series, scenario }), asOf }),
    });
    const byKey = Object.fromEntries(result.scenarios.map((item: any) => [item.key, item]));
    expect(byKey.base.totalCostDelta).toBe(0);
    expect(byKey.prime1.paymentIn1y).toBeGreaterThan(byKey.base.paymentIn1y);
    expect(byKey.prime2.paymentIn1y).toBeGreaterThan(byKey.prime1.paymentIn1y);
    expect(byKey.prime3.totalCostDelta).toBeGreaterThan(byKey.prime2.totalCostDelta);
    expect(byKey.combined.peakPaymentToIncomePct).toBeCloseTo((byKey.combined.peakPayment / 25000) * 100, 1);
    expect(byKey.base.payments.length).toBeGreaterThan(300);
  });
});
