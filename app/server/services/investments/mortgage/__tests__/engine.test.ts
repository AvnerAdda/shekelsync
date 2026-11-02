import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const engine = require('../engine.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ratePaths = require('../rate-paths.js');

const {
  annuityPayment,
  buildMortgageSchedule,
  calibrateTrack,
  effectiveToNominal,
  nominalToEffective,
  remainingTermFromPayment,
  toMonthlyRate,
} = engine;

function fixedTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fixed',
    type: 'fixed_unlinked',
    rate: 5,
    termMonths: 120,
    firstPaymentDate: '2026-02-10',
    tranches: [{ drawDate: '2026-01-10', amount: 100000 }],
    ...overrides,
  };
}

function schedule(tracks: unknown[], extra: Record<string, unknown> = {}) {
  return buildMortgageSchedule({ asOf: '2026-01-01', tracks, ...extra });
}

function sum(rows: any[], key: string) {
  return rows.reduce((total, row) => total + row[key], 0);
}

describe('rate helpers', () => {
  it('converts between nominal and effective annual rates', () => {
    expect(nominalToEffective(4)).toBeCloseTo(4.0742, 4);
    expect(effectiveToNominal(4.0742)).toBeCloseTo(4, 3);
    expect(toMonthlyRate(4.0742, 'effective')).toBeCloseTo(toMonthlyRate(4, 'nominal'), 6);
  });

  it('computes annuity payments and solves the remaining term', () => {
    expect(annuityPayment(100000, 0.05 / 12, 120)).toBeCloseTo(1060.66, 2);
    expect(annuityPayment(1200, 0, 12)).toBe(100);
    expect(remainingTermFromPayment(100000, 0.05 / 12, 1060.66)).toBe(120);
    expect(remainingTermFromPayment(100000, 0.05 / 12, 100)).toBe(Infinity);
  });
});

describe('buildMortgageSchedule — amortization types', () => {
  it('matches the closed-form Spitzer schedule and fully repays the loan', () => {
    const result = schedule([fixedTrack()]);
    const rows = result.tracks[0].rows;
    expect(rows).toHaveLength(120);
    expect(rows[0].payment).toBeCloseTo(1060.66, 2);
    expect(rows[0].interest).toBeCloseTo(416.67, 2);
    expect(rows.at(-1).closingBalance).toBe(0);
    expect(sum(rows, 'principal')).toBeCloseTo(100000, 0);
    expect(result.totals.lifetime.interest).toBeCloseTo(1060.66 * 120 - 100000, -1);
    expect(result.current.nextPaymentDate).toBe('2026-02-10');
  });

  it('gives identical payments for the same rate quoted nominal or effective', () => {
    const nominal = schedule([fixedTrack({ rate: 4 })]);
    const effective = schedule([fixedTrack({ rate: nominalToEffective(4), rateConvention: 'effective' })]);
    expect(effective.tracks[0].rows[0].payment).toBeCloseTo(nominal.tracks[0].rows[0].payment, 2);
  });

  it('repays a constant principal with equal-principal amortization', () => {
    const rows = schedule([fixedTrack({ amortization: 'equal_principal' })]).tracks[0].rows;
    expect(rows[0].principal).toBeCloseTo(833.33, 2);
    expect(rows[50].principal).toBeCloseTo(833.33, 2);
    expect(rows[0].payment).toBeGreaterThan(rows[1].payment);
    expect(rows.at(-1).closingBalance).toBe(0);
  });

  it('pays interest only on a balloon until the final payment', () => {
    const rows = schedule([fixedTrack({ amortization: 'balloon', termMonths: 12 })]).tracks[0].rows;
    expect(rows[0].payment).toBeCloseTo(416.67, 2);
    expect(rows[10].closingBalance).toBeCloseTo(100000, 2);
    expect(rows[11].payment).toBeCloseTo(100416.67, 2);
    expect(rows[11].closingBalance).toBe(0);
  });

  it('capitalizes interest on a bullet loan and repays everything at maturity', () => {
    const rows = schedule([fixedTrack({ amortization: 'bullet', termMonths: 12 })]).tracks[0].rows;
    expect(rows[0].payment).toBe(0);
    expect(rows[10].closingBalance).toBeGreaterThan(100000);
    const expected = 100000 * Math.pow(1 + 0.05 / 12, 12);
    expect(rows[11].payment).toBeCloseTo(expected, 1);
  });
});

describe('buildMortgageSchedule — grace periods', () => {
  it('charges interest only during partial grace, then amortizes over the remaining term', () => {
    const rows = schedule([fixedTrack({ grace: { type: 'partial', endDate: '2026-07-31' } })]).tracks[0].rows;
    expect(rows[0].phase).toBe('grace_partial');
    expect(rows[0].payment).toBeCloseTo(416.67, 2);
    expect(rows[5].closingBalance).toBeCloseTo(100000, 2);
    expect(rows[6].phase).toBe('amortizing');
    expect(rows[6].payment).toBeCloseTo(annuityPayment(100000, 0.05 / 12, 114), 2);
    expect(rows.at(-1).closingBalance).toBe(0);
  });

  it('capitalizes interest during full grace', () => {
    const rows = schedule([fixedTrack({ grace: { type: 'full', endDate: '2026-04-30' } })]).tracks[0].rows;
    expect(rows[0].payment).toBe(0);
    expect(rows[2].closingBalance).toBeCloseTo(100000 * Math.pow(1 + 0.05 / 12, 3), 1);
    expect(rows[3].payment).toBeGreaterThan(1060.66);
    expect(rows.at(-1).closingBalance).toBe(0);
  });
});

describe('buildMortgageSchedule — variable rates', () => {
  it('recalculates prime payments when the policy rate changes', () => {
    const paths = ratePaths.buildPaths({
      asOf: '2026-01-01',
      series: { policyRate: [{ date: '2025-01-01', value: 4.5 }, { date: '2026-06-15', value: 3.5 }] },
    });
    const rows = buildMortgageSchedule({
      asOf: '2026-01-01',
      paths,
      tracks: [{ id: 'p', type: 'prime', margin: -0.5, termMonths: 120, firstPaymentDate: '2026-02-10', tranches: [{ drawDate: '2026-01-10', amount: 100000 }] }],
    }).tracks[0].rows;
    expect(rows[0].annualRate).toBeCloseTo(5.5, 6);
    // Period starting 2026-06-10 still uses the old rate; the next one uses 4.5%.
    expect(rows[5].annualRate).toBeCloseTo(5.5, 6);
    expect(rows[6].annualRate).toBeCloseTo(4.5, 6);
    expect(rows[6].payment).toBeLessThan(rows[5].payment);
    expect(rows.at(-1).closingBalance).toBe(0);
  });

  it('applies scenario shifts only to future prime', () => {
    const paths = ratePaths.buildPaths({
      asOf: '2026-03-01',
      series: { policyRate: [{ date: '2025-01-01', value: 4 }] },
      scenario: { primeShiftPct: 2 },
    });
    expect(paths.primeAt('2026-02-01')).toBeCloseTo(5.5, 6);
    expect(paths.primeAt('2026-04-01')).toBeCloseTo(7.5, 6);
  });

  it('resets variable tracks at each period using anchor + margin', () => {
    const paths = ratePaths.buildPaths({
      asOf: '2026-01-01',
      series: { anchors: { variable_unlinked: [{ date: '2020-01-01', value: 3 }, { date: '2027-01-01', value: 4 }] } },
    });
    const rows = buildMortgageSchedule({
      asOf: '2026-01-01',
      paths,
      tracks: [{
        id: 'v', type: 'variable_unlinked', rate: 5, margin: 1, resetPeriodMonths: 12,
        termMonths: 60, firstPaymentDate: '2026-02-10', tranches: [{ drawDate: '2026-01-10', amount: 100000 }],
      }],
    }).tracks[0].rows;
    expect(rows[0].annualRate).toBeCloseTo(5, 6);
    expect(rows[12].annualRate).toBeCloseTo(5, 6); // reset 2027-01-10 → anchor 4 + 1
    expect(rows[11].annualRate).toBeCloseTo(5, 6);
    const paths2 = ratePaths.buildPaths({
      asOf: '2026-01-01',
      series: { anchors: { variable_unlinked: [{ date: '2020-01-01', value: 2 }] } },
    });
    const rows2 = buildMortgageSchedule({
      asOf: '2026-01-01',
      paths: paths2,
      tracks: [{
        id: 'v', type: 'variable_unlinked', rate: 5, margin: 1, resetPeriodMonths: 12,
        termMonths: 60, firstPaymentDate: '2026-02-10', tranches: [{ drawDate: '2026-01-10', amount: 100000 }],
      }],
    }).tracks[0].rows;
    expect(rows2[12].annualRate).toBeCloseTo(3, 6);
    expect(rows2[12].payment).toBeLessThan(rows2[11].payment);
  });

  it('warns and keeps the entered rate when prime data is missing', () => {
    const result = schedule([{ id: 'p', type: 'prime', rate: 6, margin: -0.5, termMonths: 12, firstPaymentDate: '2026-02-10', tranches: [{ drawDate: '2026-01-10', amount: 12000 }] }]);
    expect(result.tracks[0].rows[0].annualRate).toBeCloseTo(6, 6);
    expect(result.warnings.map((w: any) => w.code)).toContain('prime_path_missing');
  });
});

describe('buildMortgageSchedule — CPI linkage', () => {
  const cpi = [
    { period: '2025-12', value: 100 },
    { period: '2026-01', value: 101 },
    { period: '2026-02', value: 102 },
    { period: '2026-03', value: 99 },
  ];

  it('uses the known index: month M is known only after the 15th of M+1', () => {
    expect(ratePaths.knownCpiPeriod('2026-03-15')).toBe('2026-01');
    expect(ratePaths.knownCpiPeriod('2026-03-16')).toBe('2026-02');
  });

  it('indexes the balance and payment by the known-index ratio', () => {
    const paths = ratePaths.buildPaths({ asOf: '2026-06-01', series: { cpi, inflationExpectations: { y1: 0, y5: 0, y10: 0 } } });
    const track = {
      id: 'c', type: 'fixed_cpi', rate: 3, termMonths: 24,
      firstPaymentDate: '2026-02-16', tranches: [{ drawDate: '2026-01-16', amount: 100000 }],
    };
    const rows = buildMortgageSchedule({ asOf: '2026-06-01', paths, tracks: [track] }).tracks[0].rows;
    // Draw on Jan 16 → known Dec (100). Feb 16 → known Jan (101).
    expect(rows[0].indexRatio).toBeCloseTo(1.01, 6);
    expect(rows[0].indexation).toBeCloseTo(1000, 2);
    expect(rows[0].payment).toBeCloseTo(annuityPayment(100000, 0.0025, 24) * 1.01, 2);
    // Identity: opening + indexation + interest − payment = closing.
    for (const row of rows) {
      expect(row.openingBalance + row.indexation + row.interest - row.payment).toBeCloseTo(row.closingBalance, 1);
    }
  });

  it('floors deflation at the base index when requested', () => {
    const deflation = [{ period: '2025-12', value: 100 }, { period: '2026-01', value: 98 }];
    const paths = ratePaths.buildPaths({ asOf: '2026-06-01', series: { cpi: deflation, inflationExpectations: { y1: 0 } } });
    const base = { id: 'c', type: 'fixed_cpi', rate: 3, termMonths: 12, firstPaymentDate: '2026-02-16', tranches: [{ drawDate: '2026-01-16', amount: 100000 }] };
    const free = buildMortgageSchedule({ asOf: '2026-06-01', paths, tracks: [base] }).tracks[0].rows[0];
    const floored = buildMortgageSchedule({ asOf: '2026-06-01', paths, tracks: [{ ...base, cpiFloorAtBase: true }] }).tracks[0].rows[0];
    expect(free.indexRatio).toBeCloseTo(0.98, 6);
    expect(floored.indexRatio).toBe(1);
  });

  it('projects CPI from inflation expectations beyond the last published month', () => {
    const paths = ratePaths.buildPaths({ asOf: '2026-04-01', series: { cpi, inflationExpectations: { y1: 2.4 } } });
    const known = paths.cpiKnownIndexAt('2027-05-20'); // known = 2027-04, 13 months after 2026-03
    expect(known).toBeGreaterThan(99 * 1.02);
    expect(known).toBeLessThan(99 * 1.03);
  });
});

describe('buildMortgageSchedule — drawdowns and events', () => {
  it('adds a planned tranche to the same maturity and raises the payment', () => {
    const track = fixedTrack({
      termMonths: 120,
      tranches: [
        { drawDate: '2026-01-10', amount: 100000 },
        { drawDate: '2026-06-20', amount: 50000, status: 'planned' },
      ],
    });
    const result = schedule([track]);
    const rows = result.tracks[0].rows;
    expect(rows).toHaveLength(120);
    expect(rows[5].payment).toBeGreaterThan(rows[4].payment);
    expect(rows.at(-1).closingBalance).toBe(0);
    expect(result.totals.drawn).toBe(150000);
    expect(result.tracks[0].tranches[1].firstPaymentDate).toBe('2026-07-10');
    // Planned tranche counts at face value between draw and first payment.
    const june = result.monthly.find((m: any) => m.month === '2026-06');
    expect(june.drawn).toBe(50000);
    expect(june.balance).toBeGreaterThan(140000);
  });

  it('uses the market rate for planned tranches without a contract rate', () => {
    const paths = ratePaths.buildPaths({ asOf: '2026-01-01', series: { marketRates: { fixed_unlinked: [{ period: '2025-12', value: 6 }] } } });
    const result = buildMortgageSchedule({
      asOf: '2026-01-01',
      paths,
      tracks: [fixedTrack({ tranches: [{ drawDate: '2026-01-10', amount: 100000, rate: 5 }, { drawDate: '2026-03-20', amount: 100000, status: 'planned' }] })],
    });
    expect(result.tracks[0].tranches[1].assumedRate).toBe(6);
    expect(result.tracks[0].rows[5].annualRate).toBeCloseTo(5.5, 1);
  });

  it('reduces the payment or the term after a partial prepayment', () => {
    const events = (mode: string) => [{ trackId: 'fixed', type: 'prepay_partial', date: '2026-06-15', amount: 20000, mode }];
    const reducePayment = schedule([fixedTrack()], { events: events('reduce_payment') }).tracks[0].rows;
    const reduceTerm = schedule([fixedTrack()], { events: events('reduce_term') }).tracks[0].rows;
    expect(reducePayment[4].prepayment).toBe(0);
    expect(reducePayment[5].prepayment).toBe(20000);
    expect(reducePayment[6].payment).toBeLessThan(1060.66 - 100);
    expect(reducePayment).toHaveLength(120);
    expect(reduceTerm[6].payment).toBeCloseTo(1060.66, 0);
    expect(reduceTerm.length).toBeLessThan(100);
    expect(reduceTerm.at(-1).closingBalance).toBe(0);
  });

  it('closes a track on full prepayment or refinance', () => {
    const result = schedule([fixedTrack()], {
      events: [{ trackId: 'fixed', type: 'prepay_full', date: '2026-04-01', fee: 500 }],
    });
    const rows = result.tracks[0].rows;
    expect(rows.at(-1).date).toBe('2026-04-10');
    expect(rows.at(-1).closingBalance).toBe(0);
    expect(rows.at(-1).fees).toBe(500);
    expect(result.tracks[0].closedDate).toBe('2026-04-01');
    expect(result.monthly.at(-1).balance).toBe(0);

    const refinanced = schedule([fixedTrack()], {
      events: [{ type: 'refinance', date: '2026-04-01', payload: { closeTrackIds: ['fixed'] } }],
    });
    expect(refinanced.tracks[0].closedDate).toBe('2026-04-01');
  });

  it('re-bases the balance on a bank statement anchor', () => {
    const result = schedule([fixedTrack({ anchor: { date: '2026-05-01', balance: 90000, remainingMonths: 100 } })]);
    const rows = result.tracks[0].rows;
    const firstAfter = rows.find((row: any) => row.date > '2026-05-01');
    expect(firstAfter.openingBalance).toBeCloseTo(90000, 2);
    expect(firstAfter.payment).toBeCloseTo(annuityPayment(90000, 0.05 / 12, 100), 2);
    expect(result.warnings.find((w: any) => w.code === 'anchor_applied')).toBeTruthy();
    expect(rows.at(-1).closingBalance).toBe(0);
  });

  it('never produces negative balances and conserves principal', () => {
    const result = schedule([
      fixedTrack({ amortization: 'equal_principal' }),
      fixedTrack({ id: 'b', rate: 3, termMonths: 60 }),
    ], { events: [{ trackId: 'b', type: 'prepay_partial', date: '2026-03-05', amount: 999999 }] });
    for (const track of result.tracks) {
      for (const row of track.rows) expect(row.closingBalance).toBeGreaterThanOrEqual(0);
      const repaid = sum(track.rows, 'principal') + sum(track.rows, 'prepayment');
      expect(repaid).toBeCloseTo(100000, 0);
    }
  });
});

describe('buildMortgageSchedule — bank conventions', () => {
  it('charges broken-period interest separately on the next payment day', () => {
    const result = buildMortgageSchedule({
      asOf: '2026-08-01',
      options: { brokenPeriodInterest: 'separate' },
      tracks: [fixedTrack({ termMonths: 120, firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-08-19', amount: 100000 }] })],
    });
    const rows = result.tracks[0].rows;
    // 22 days of interest on 10 Sep, interest only.
    expect(rows[0]).toMatchObject({ date: '2026-09-10', phase: 'broken_period', principal: 0 });
    expect(rows[0].payment).toBeCloseTo(100000 * 0.05 * (22 / 365), 2);
    // Regular payments from 10 Oct over the full term.
    expect(rows[1].date).toBe('2026-10-10');
    expect(rows[1].payment).toBeCloseTo(1060.66, 2);
    expect(rows).toHaveLength(121);
    expect(rows.at(-1).closingBalance).toBe(0);
    // The balance is counted once while the loan waits for its first payment.
    expect(result.monthly.find((point: any) => point.month === '2026-09').balance).toBe(100000);
    expect(result.warnings.map((w: any) => w.code)).not.toContain('first_payment_gap');
  });

  it('has no broken period when the draw falls on a payment day', () => {
    const rows = buildMortgageSchedule({
      asOf: '2026-08-01',
      options: { brokenPeriodInterest: 'separate' },
      tracks: [fixedTrack({ firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-09-10', amount: 100000 }] })],
    }).tracks[0].rows;
    expect(rows[0]).toMatchObject({ date: '2026-10-10', phase: 'amortizing' });
  });

  it('can apply prime changes one installment later', () => {
    const paths = ratePaths.buildPaths({
      asOf: '2026-08-01',
      series: { policyRate: [{ date: '2025-01-01', value: 3.5 }, { date: '2026-09-03', value: 3.25 }] },
    });
    const track = { id: 'p', type: 'prime', margin: -0.75, termMonths: 360, firstPaymentDate: '2026-10-10', tranches: [{ drawDate: '2026-09-10', amount: 500000 }] };
    const run = (lag: number) => buildMortgageSchedule({ asOf: '2026-08-01', paths, tracks: [track], options: { primeChangeLagMonths: lag } }).tracks[0].rows;
    expect(run(0)[0].annualRate).toBeCloseTo(4, 6);
    expect(run(1)[0].annualRate).toBeCloseTo(4.25, 6);
    expect(run(1)[1].annualRate).toBeCloseTo(4, 6);
  });
});

describe('buildMortgageSchedule — current snapshot', () => {
  it('sums every track\'s next payment even when tracks pay on different days', () => {
    const result = buildMortgageSchedule({
      asOf: '2026-11-05',
      tracks: [
        fixedTrack({ id: 'a', firstPaymentDate: '2026-02-01' }),
        fixedTrack({ id: 'b', firstPaymentDate: '2026-02-10' }),
      ],
    });
    expect(result.current.nextPaymentDate).toBe('2026-11-10');
    expect(result.current.nextPayment).toBeCloseTo(1060.66 * 2, 1);
  });

  it('warns when the first payment is far from the draw date', () => {
    const result = schedule([fixedTrack({ firstPaymentDate: '2026-04-01' })]);
    expect(result.warnings.map((w: any) => w.code)).toContain('first_payment_gap');
  });
});

describe('golden fixture — off-plan purchase with three tracks', () => {
  // Synthetic case: 2,000,000 apartment, 75% LTV (1,500,000), two
  // thirds drawn on 10 Sep 2026, the rest at delivery with the same mix.
  const paths = ratePaths.buildPaths({
    asOf: '2026-11-01',
    series: {
      policyRate: [{ date: '2025-01-01', value: 4.5 }, { date: '2026-09-29', value: 3.25 }],
      cpi: [{ period: '2026-07', value: 104.9 }, { period: '2026-08', value: 105.8 }, { period: '2026-09', value: 105.3 }],
      inflationExpectations: { y1: 1.74, y5: 1.92, y10: 1.95 },
      anchors: { variable_cpi: [{ period: '2026-08', value: 1.64 }] },
    },
  });
  const common = { termMonths: 360, firstPaymentDate: '2026-10-10' };
  const tracks = (convention: string) => [
    { id: 'cpi', type: 'variable_cpi', rate: 2.63, margin: 0.97, rateConvention: convention, ...common, tranches: [{ drawDate: '2026-09-10', amount: 100000 }, { drawDate: '2026-12-10', amount: 50000, status: 'planned' }] },
    { id: 'prime', type: 'prime', margin: -0.75, ...common, tranches: [{ drawDate: '2026-09-10', amount: 500000 }, { drawDate: '2026-12-10', amount: 250000, status: 'planned' }] },
    { id: 'fixed', type: 'fixed_unlinked', rate: 4.54, rateConvention: convention, ...common, tranches: [{ drawDate: '2026-09-10', amount: 400000 }, { drawDate: '2026-12-10', amount: 200000, status: 'planned' }] },
  ];

  it('lands the next payment within the expected range for the synthetic loan', () => {
    const nominal = buildMortgageSchedule({ asOf: '2026-11-01', paths, tracks: tracks('nominal') });
    const effective = buildMortgageSchedule({ asOf: '2026-11-01', paths, tracks: tracks('effective') });
    expect(nominal.current.nextPayment).toBeGreaterThan(4800);
    expect(nominal.current.nextPayment).toBeLessThan(4900);
    expect(effective.current.nextPayment).toBeCloseTo(4800, -1);
    // prime − 0.75 with a 3.25% policy rate is 4.00% nominal (4.07% effective).
    const prime = effective.current.byTrack.find((t: any) => t.trackId === 'prime');
    expect(prime.currentRate).toBeCloseTo(4, 6);
    expect(nominalToEffective(prime.currentRate)).toBeCloseTo(4.07, 2);
  });

  it('covers the full loan after delivery', () => {
    const result = buildMortgageSchedule({ asOf: '2026-11-01', paths, tracks: tracks('effective') });
    // Track amounts as entered sum to 1,000,000 drawn (+50% at delivery).
    expect(result.totals.drawn).toBe(1500000);
    const feb = result.monthly.find((m: any) => m.month === '2027-02');
    expect(feb.balance).toBeGreaterThan(1_480_000);
    expect(feb.payment).toBeGreaterThan(7200);
    expect(feb.payment).toBeLessThan(7500);
    expect(result.totals.maturityDate).toBe('2056-09-10');
  });

  it('reproduces the statement balance and payment once anchored', () => {
    const anchored = tracks('effective').map((track) => ({ ...track }));
    // Spread the bank total (1,002,500) pro-rata across tracks as of the statement date.
    const drawn = 1000000;
    for (const track of anchored) {
      const amount = (track.tranches as any[])[0].amount;
      (track as any).anchor = { date: '2026-11-01', balance: 1002500 * (amount / drawn), remainingMonths: 359 };
    }
    const result = buildMortgageSchedule({ asOf: '2026-11-01', paths, tracks: anchored });
    expect(result.current.nextPayment).toBeGreaterThan(4800);
    expect(result.current.nextPayment).toBeLessThan(4900);
  });

  it('calibration prefers the convention closest to the bank payment', () => {
    const track = tracks('nominal')[2];
    const statement = { date: '2026-11-01', payment: annuityPayment(400000, toMonthlyRate(4.54, 'effective'), 360) };
    const result = calibrateTrack({ ...track, tranches: [track.tranches[0]] }, statement, { paths });
    expect(result.best.rateConvention).toBe('effective');
  });
});
