import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const analysis = require('../analysis.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const health = require('../health.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildMortgageSchedule } = require('../engine.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ratePaths = require('../rate-paths.js');

const asOf = '2026-11-01';
const paths = ratePaths.buildPaths({
  asOf,
  series: {
    policyRate: [{ date: '2025-01-01', value: 3.25 }],
    cpi: [{ period: '2026-08', value: 105.8 }, { period: '2026-09', value: 105.3 }],
    inflationExpectations: { y1: 1.74, y5: 1.92, y10: 1.95 },
  },
});
const common = { termMonths: 360, firstPaymentDate: '2026-10-10' };
const inputTracks = [
  { id: 'fixed', type: 'fixed_unlinked', rate: 4.45, ...common, tranches: [{ drawDate: '2026-09-10', amount: 747500 }, { drawDate: '2026-12-10', amount: 373750, status: 'planned' }] },
  { id: 'prime', type: 'prime', margin: -0.75, ...common, tranches: [{ drawDate: '2026-09-10', amount: 500000 }, { drawDate: '2026-12-10', amount: 250000, status: 'planned' }] },
];
const schedule = buildMortgageSchedule({ asOf, tracks: inputTracks, paths });
const market = { fixed_unlinked: { period: '2026-08', value: 4.62 }, fixed_cpi: { period: '2026-08', value: 3.29 }, variable_cpi: { period: '2026-08', value: 3.19, anchor: 1.64, margin: 1.55 } };

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    asOf,
    property: { value: 2730000, ownershipPct: 100, purchasePrice: 2730000, purchaseDate: '2026-08-01', annualGrowthPct: 3, annualOwnerCosts: 0 },
    schedule,
    inputTracks,
    costs: [],
    settings: { marketRent: 7500, deliveryDate: '2026-12-10' },
    market,
    cpiKnownIndexAt: paths.cpiKnownIndexAt,
    approvedAmount: 1871250,
    ...overrides,
  };
}

describe('capitalization fee', () => {
  it('is zero when the market rate is at or above your rate, positive when below', () => {
    expect(analysis.capitalizationFee(100000, 0.04 / 12, 0.05 / 12, 240)).toBe(0);
    const fee = analysis.capitalizationFee(100000, 0.05 / 12, 0.03 / 12, 240);
    expect(fee).toBeGreaterThan(15000);
    expect(fee).toBeLessThan(30000);
    // Only payments until the next reset count for variable tracks.
    expect(analysis.capitalizationFee(100000, 0.05 / 12, 0.03 / 12, 240, 12)).toBeLessThan(3000);
  });

  it('ignores planned drawdowns and prime tracks', () => {
    const fees = analysis.estimatePrepaymentFees(schedule, inputTracks, { asOf, market, cpiKnownIndexAt: paths.cpiKnownIndexAt });
    const fixed = fees.tracks.find((track: any) => track.trackId === 'fixed');
    expect(fixed.capitalization).toBe(0); // 4.45% < 4.62% market
    expect(fees.tracks.find((track: any) => track.trackId === 'prime').basis).toBe('not_applicable');
    expect(fees.total).toBe(analysis.OPERATIONAL_FEE);
    const cheaperMarket = analysis.estimatePrepaymentFees(schedule, inputTracks, {
      asOf, market: { ...market, fixed_unlinked: { value: 3.5 } }, cpiKnownIndexAt: paths.cpiKnownIndexAt,
    });
    const fee = cheaperMarket.tracks.find((track: any) => track.trackId === 'fixed').capitalization;
    expect(fee).toBeGreaterThan(50000);
    expect(fee).toBeLessThan(150000); // on the drawn ~747k only
  });
});

describe('buildSaleAnalysis', () => {
  it('computes the four break-even answers for an off-plan purchase', () => {
    const result = analysis.buildSaleAnalysis(baseInput());
    expect(result.assumptions).toContain('down_payment_derived');
    expect(result.cashInvested.upfront).toBe(2730000 - 1871250);
    expect(result.debt.undrawn).toBe(623750);
    // Clear-debt price covers balance + undrawn + fees + selling costs.
    const payoff = result.debt.payoffToday; // balance + accrued + fees + undrawn
    const costs = (price: number) => analysis.saleCosts(price, result.settings);
    expect(result.breakEven.clearDebtPrice - costs(result.breakEven.clearDebtPrice)).toBeCloseTo(payoff, -1);
    expect(result.breakEven.recoverCashPrice).toBeGreaterThan(result.breakEven.clearDebtPrice);
    // Parts are rounded independently: allow ₪2.
    expect(Math.abs(result.today.netProceeds - (result.today.price - result.today.saleCosts - result.today.mortgagePayoff - result.today.undrawnCommitment - result.today.prepaymentFees))).toBeLessThanOrEqual(2);
    expect(Math.abs(result.today.profit - (result.today.netProceeds - result.cashInvested.total))).toBeLessThanOrEqual(2);
    expect(result.sensitivity).toHaveLength(13);
    expect(result.sensitivity[6].changePct).toBe(0);
  });

  it('charges capital gains tax only without the single-apartment exemption', () => {
    const exempt = analysis.buildSaleAnalysis(baseInput({ property: { value: 3500000, purchasePrice: 2730000, purchaseDate: '2026-08-01' } }));
    const taxed = analysis.buildSaleAnalysis(baseInput({
      property: { value: 3500000, purchasePrice: 2730000, purchaseDate: '2026-08-01' },
      settings: { singleApartmentExemption: false, capitalGainsTaxPct: 25 },
    }));
    expect(exempt.today.capitalGainsTax).toBe(0);
    expect(taxed.today.capitalGainsTax).toBeGreaterThan(100000);
    expect(taxed.today.netProceeds).toBeLessThan(exempt.today.netProceeds);
  });

  it('compares owning with renting and investing, counting undrawn debt as owed', () => {
    const result = analysis.buildSaleAnalysis(baseInput());
    const first = result.alternative.points[0];
    expect(first.year).toBe(2026);
    // Today the owner is behind by roughly the selling costs.
    expect(first.advantage).toBeLessThan(0);
    expect(result.alternative.crossoverYear).toBeGreaterThan(2026);
    const appreciation = analysis.breakEvenAppreciation(baseInput(), 10);
    expect(appreciation).toBeGreaterThan(-5);
    expect(appreciation).toBeLessThan(5);
    // Higher rent saved makes owning look better.
    const highRent = analysis.buildSaleAnalysis(baseInput({ settings: { marketRent: 12000, deliveryDate: '2026-12-10' } }));
    expect(highRent.alternative.points.at(-1).advantage).toBeGreaterThan(result.alternative.points.at(-1).advantage);
  });

  it('invests costs paid before the purchase date in the alternative', () => {
    const withEarlyCosts = analysis.buildSaleAnalysis(baseInput({
      costs: [{ type: 'down_payment', amount: 858750, date: '2026-05-25' }],
    }));
    const first = withEarlyCosts.alternative.points[0];
    // The down payment (and its growth since May) is in the alternative.
    expect(first.alternativeWealth).toBeGreaterThan(858750);
    // The appreciation-search path agrees with the full analysis.
    const fast = analysis.buildSaleAnalysis({ ...baseInput({ costs: [{ type: 'down_payment', amount: 858750, date: '2026-05-25' }] }), alternativeOnly: true });
    expect(fast.alternative.points).toEqual(withEarlyCosts.alternative.points);
  });

  it('works without a mortgage', () => {
    const result = analysis.buildSaleAnalysis(baseInput({ schedule: null, inputTracks: [], approvedAmount: 0 }));
    expect(result.debt.balance).toBe(0);
    expect(result.breakEven.clearDebtPrice).toBe(0);
    expect(result.alternative).toBeNull();
  });
});

describe('buildMortgageHealth', () => {
  const run = (scenario: Record<string, number>) => buildMortgageSchedule({
    asOf, tracks: inputTracks, paths: ratePaths.buildPaths({ asOf, series: { policyRate: [{ date: '2025-01-01', value: 3.25 }] }, scenario }),
  });
  const summary = {
    balance: schedule.current.balance,
    undrawn: 623750,
    tracks: schedule.current.byTrack,
  };
  const schedules = { base: schedule, prime1: run({ primeShiftPct: 1 }), combined: run({ primeShiftPct: 2 }) };

  it('rates each dimension and reports the overall worst verdict', () => {
    const result = health.buildMortgageHealth({
      summary, inputTracks, market, schedules, propertyValue: 2730000,
      income: { monthly: 25000 },
    });
    expect(result.rates.tracks.find((track: any) => track.trackId === 'fixed').verdict).toBe('good');
    expect(result.rates.tracks.find((track: any) => track.trackId === 'prime').verdict).toBe('unknown');
    expect(result.exposure.steadyMonth).toBe('2027-02');
    expect(result.exposure.perPrimePoint).toBeGreaterThan(300);
    expect(result.exposure.meetsFixedThird).toBe(true);
    expect(result.affordability.paymentToIncomePct).toBeCloseTo((result.exposure.steadyPayment / 25000) * 100, 0);
    expect(result.equity.loanToValuePct).toBeCloseTo(((summary.balance + 623750) / 2730000) * 100, 0);
    expect(['good', 'watch', 'risk']).toContain(result.overall);
  });

  it('reports unknown affordability without income and flags high payment-to-income', () => {
    const noIncome = health.buildMortgageHealth({ summary, inputTracks, market, schedules, propertyValue: 2730000, income: { monthly: null } });
    expect(noIncome.affordability.verdict).toBe('unknown');
    const tight = health.buildMortgageHealth({ summary, inputTracks, market, schedules, propertyValue: 2730000, income: { monthly: 15000 } });
    expect(tight.affordability.verdict).toBe('risk');
    expect(tight.overall).toBe('risk');
  });
});
