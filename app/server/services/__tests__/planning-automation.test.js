import { describe, expect, it } from 'vitest';
const { detectNextIncome, detectCardCommitments } = require('../planning-automation.js');

const today = '2026-09-08';
const salary = { patternKey: 'salary', patternType: 'monthly', monthsOfHistory: 4, confidence: 0.8, lastOccurrence: '2026-08-10' };
const prediction = { patternKey: 'salary', categoryType: 'income', incomeType: 'operating', probability: 1,
  probabilityWeightedAmount: 5000, isChosenOccurrence: true };
const day = (date, overrides = {}) => ({ date, predictions: [{ ...prediction, ...overrides }] });
const infer = (days, patterns = [salary], date = today) => detectNextIncome({ categoryPatterns: patterns, dailyForecasts: days }, date, '2026-12-31');
const bank = { account_number: '123', last_update_date: today };
const charge = { vendor: 'max', account_number: '1111', status: 'completed', price: -100,
  charged_currency: 'ILS', date: '2026-09-01', processed_date: '2026-09-10' };
const cards = (transactions, overrides = {}) => detectCardCommitments({ today, banks: [bank],
  cards: [{ vendor: 'max', last_scrape_success: today }], transactions, pairings: [], ...overrides });

describe('automatic planning inputs', () => {
  it('uses the chosen recurring payday, ignoring probability tails, transfers and one-off income', () => {
    expect(infer([
      day('2026-09-09', { probability: 0.05, isChosenOccurrence: false }),
      day('2026-09-09', { incomeType: 'non_operating' }),
      day('2026-09-09', { patternKey: 'refund' }), day('2026-09-10'),
    ])).toBe('2026-09-10');
    expect(infer([day('2026-09-10')], [{ ...salary, insufficientData: true }])).toBeNull();
    expect(infer([day('2026-09-10')], [{ ...salary, lastOccurrence: '2025-12-10' }])).toBeNull();
  });

  it('moves to the next occurrence after payday and respects resolved recurring corrections', () => {
    const days = [day('2026-09-10'), day('2026-10-10')];
    expect(infer(days, [salary], '2026-09-10')).toBe('2026-10-10');
    expect(infer([day('2026-09-12', { patternKey: 'financial_pattern:1', isUserResolvedPattern: true })], [])).toBe('2026-09-12');
    expect(infer([day('2026-09-10')], [{ ...salary, confidence: 0.2 }])).toBeNull();
  });

  it('recognizes calibrated paydays from the current forecast model without a legacy pattern key', () => {
    expect(infer([day('2026-09-09', { patternKey: 'income_schedule:salary:2026-09-10',
      predictionKind: 'recurring_income', isCalibrated: true, probability: 0.1 }),
    day('2026-09-10', { patternKey: 'income_schedule:salary:2026-09-10',
      predictionKind: 'recurring_income', isCalibrated: true })], [])).toBe('2026-09-10');
  });

  it('includes old purchases billed in the future, pending purchases and future installments once', () => {
    expect(cards([
      { ...charge, date: '2026-07-01' },
      { ...charge, status: 'pending', processed_date: null, price: -50 },
      { ...charge, date: '2026-10-10', processed_date: '2026-10-10', price: -200 },
      { ...charge, processed_date: '2026-09-05', price: -999 },
      { ...charge, status: 'cancelled', price: -999 },
    ])).toEqual({ amount: 350, source: 'estimated' });
  });

  it('nets refunds within their own card and billing cycle, without funding other bills', () => {
    expect(cards([charge, { ...charge, price: 25 }, { ...charge, processed_date: '2026-10-10', price: 999 },
      { ...charge, account_number: '2222', price: 999 }])).toEqual({ amount: 75, source: 'imported' });
  });

  it('stops reserving settled cycles after a balance sync, using each paired bank snapshot', () => {
    const transactions = [charge, { ...charge, account_number: '2222' }];
    const pairings = [
      { credit_card_vendor: 'max', credit_card_account_number: '1111', bank_account_number: '123' },
      { credit_card_vendor: 'max', credit_card_account_number: '2222', bank_account_number: '456' },
    ];
    expect(cards(transactions, { banks: [{ ...bank, last_update_date: '2026-09-11' },
      { account_number: '456', last_update_date: today }], pairings })).toEqual({ amount: 100, source: 'imported' });
    expect(cards([charge], { banks: [{ ...bank, last_update_date: '2026-09-11' }] }).amount).toBe(0);
  });

  it('uses a labeled conservative estimate for undated purchases and identifies missing imports', () => {
    expect(cards([{ ...charge, processed_date: null }, { ...charge, processed_date: null, date: '2025-01-01' }]))
      .toEqual({ amount: 100, source: 'estimated' });
    expect(cards([], { cards: [{ vendor: 'max' }] })).toEqual({ amount: null, source: 'unavailable' });
    expect(cards([])).toEqual({ amount: 0, source: 'imported' });
    expect(cards([], { cards: [{ vendor: 'max', last_scrape_success: '2026-08-01' }] }).amount).toBeNull();
    expect(cards([{ ...charge, charged_currency: 'USD' }]).amount).toBeNull();
  });

  it.each(['ILS', ' nis ', '₪', 'ש"ח', 'ש״ח', 'שח', '\u200f₪\u200e'])('recognizes the shekel currency label %s', (currency) => {
    expect(cards([{ ...charge, charged_currency: currency }])).toEqual({ amount: 100, source: 'imported' });
  });

  it('distinguishes foreign card currencies, stale imports, and invalid amounts', () => {
    expect(cards([{ ...charge, charged_currency: 'USD' }]).reason).toBe('UNSUPPORTED_CARD_CURRENCY');
    expect(cards([], { cards: [{ vendor: 'max', last_scrape_success: '2026-08-01' }] }).reason).toBe('STALE_CARD_DATA');
    expect(cards([{ ...charge, price: null }]).reason).toBe('INVALID_CARD_AMOUNT');
  });
});
