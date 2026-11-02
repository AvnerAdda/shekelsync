import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { legacyProfileToTrack } = require('../legacy-adapter.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildMortgageSchedule } = require('../engine.js');

describe('legacyProfileToTrack', () => {
  it('returns none without a balance', () => {
    expect(legacyProfileToTrack({ mortgage_balance: 0 }, { asOf: '2026-11-01' })).toEqual({ mode: 'none' });
  });

  it('solves the remaining term from rate and payment', () => {
    const result = legacyProfileToTrack({
      mortgage_balance: 100000,
      mortgage_interest_rate: 5,
      monthly_mortgage_payment: 1060.66,
      last_valuation_date: '2026-06-01',
    }, { asOf: '2026-11-01' });
    expect(result.mode).toBe('amortizing');
    expect(result.termSource).toBe('solved_from_payment');
    expect(result.track.termMonths).toBe(120);
    const schedule = buildMortgageSchedule({ asOf: '2026-06-01', tracks: [result.track] });
    expect(schedule.current.nextPayment).toBeCloseTo(1060.66, 1);
  });

  it('falls back to term minus elapsed months', () => {
    const result = legacyProfileToTrack({
      mortgage_balance: 500000,
      mortgage_interest_rate: 4,
      mortgage_term_years: 25,
      purchase_date: '2021-06-01',
      last_valuation_date: '2026-06-01',
    }, { asOf: '2026-11-01' });
    expect(result.termSource).toBe('term_minus_elapsed');
    expect(result.track.termMonths).toBe(240);
  });

  it('stays static when nothing describes the amortization', () => {
    expect(legacyProfileToTrack({ mortgage_balance: 300000 }, { asOf: '2026-11-01' })).toEqual({
      mode: 'static',
      balance: 300000,
      payment: null,
    });
  });
});
