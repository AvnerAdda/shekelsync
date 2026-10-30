import { describe, expect, it } from 'vitest';
const { CONFIDENCE_THRESHOLDS, scorePredictionConfidence } = require('../forecast-confidence.js');

const range = (amount: number, spread: number) => ({ low: amount * (1 - spread), high: amount * (1 + spread) });

describe('forecast confidence', () => {
  it('treats scheduled installments with a fixed amount as sure', () => {
    const result = scorePredictionConfidence({ predictionKind: 'installment_payment', timingBasis: 'scheduled',
      expectedAmount: 500, probability: 1, amountRange: range(500, 0) });
    expect(result).toMatchObject({ confidence: 1, tier: 'sure', timingScore: 1, amountScore: 1 });
  });

  it('keeps a regular bill with a varying amount likely, and a stable bill sure', () => {
    const electricity = scorePredictionConfidence({ forecastBasis: 'recurring_bill', timingBasis: 'estimated',
      expectedAmount: 600, probability: 1, amountRange: range(600, 0.25) });
    const water = scorePredictionConfidence({ forecastBasis: 'recurring_bill', timingBasis: 'estimated',
      expectedAmount: 150, probability: 1, amountRange: range(150, 0.03) });
    expect(electricity.tier).toBe('likely');
    expect(water.tier).toBe('sure');
    expect(water.confidence).toBeGreaterThan(electricity.confidence);
  });

  it('never treats typical daily spending as more than uncertain', () => {
    for (const prediction of [
      { timingBasis: 'daily_average', expectedAmount: 80, amountRange: range(80, 0) },
      { isBaselineForecast: true, expectedAmount: 80, amountRange: range(80, 0) },
    ]) {
      expect(scorePredictionConfidence(prediction).tier).toBe('uncertain');
    }
  });

  it('treats a detected pay cycle by its date regularity and amount stability', () => {
    const fixedSalary = scorePredictionConfidence({ forecastBasis: 'income_schedule', timingBasis: 'estimated',
      expectedAmount: 7029, probability: 1, amountRange: range(7029, 0.03) });
    const variableSalary = scorePredictionConfidence({ forecastBasis: 'income_schedule', timingBasis: 'estimated',
      expectedAmount: 20000, probability: 1, amountRange: range(20000, 0.35) });
    const splitAcrossDays = scorePredictionConfidence({ forecastBasis: 'income_schedule', timingBasis: 'estimated',
      expectedAmount: 7029, probability: 0.5, amountRange: range(7029, 0.03) });
    expect(fixedSalary.tier).toBe('sure');
    expect(variableSalary.tier).toBe('likely');
    expect(splitAcrossDays.timingScore).toBe(0.5);
    const secondPaycheck = scorePredictionConfidence({ forecastBasis: 'income_schedule', evidenceCount: 2,
      expectedAmount: 7029, probability: 1, amountRange: range(7029, 0.03) });
    expect(secondPaycheck).toMatchObject({ timingScore: 0.6, tier: 'likely' });
  });

  it('scores pay that has not arrived yet by its awaiting status', () => {
    const result = scorePredictionConfidence({ awaitingReceipt: true, timingBasis: 'estimated',
      expectedAmount: 12000, probability: 0.6, amountRange: range(12000, 0.02) });
    expect(result.timingScore).toBe(0.9);
    expect(result.tier).toBe('sure');
  });

  it('uses pattern evidence for recurring occurrences instead of their probability floor', () => {
    const detected = scorePredictionConfidence({ isUserResolvedPattern: true, timingBasis: 'estimated',
      confidence: 0.4, probability: 0.45, expectedAmount: 50, amountRange: range(50, 0.15) });
    const confirmed = scorePredictionConfidence({ isUserResolvedPattern: true, timingBasis: 'scheduled',
      confidence: 0.4, probability: 0.45, expectedAmount: 50, amountRange: range(50, 0.15) });
    expect(detected.timingScore).toBe(0.4);
    expect(detected.tier).toBe('uncertain');
    expect(confirmed.tier).toBe('sure');
  });

  it('limits estimated category patterns by both their evidence and their chance on that day', () => {
    expect(scorePredictionConfidence({ patternConfidence: 0.9, probability: 0.3, expectedAmount: 40,
      amountRange: range(40, 0) }).timingScore).toBe(0.3);
    expect(scorePredictionConfidence({ patternConfidence: 0.5, probability: 1, expectedAmount: 40,
      amountRange: range(40, 0) }).timingScore).toBe(0.5);
  });

  it('falls back to neutral scores when the amount or range is missing', () => {
    expect(scorePredictionConfidence({ expectedAmount: 100 }).amountScore).toBe(0.5);
    expect(scorePredictionConfidence({ expectedAmount: 0, amountRange: { low: 0, high: 0 } }).amountScore).toBe(0.5);
    expect(scorePredictionConfidence().tier).toBe('uncertain');
  });

  it('scores signed investment ranges by their magnitude', () => {
    const result = scorePredictionConfidence({ predictionKind: 'recurring_investment', evidenceCount: 6,
      expectedAmount: -2000, probability: 1, amountRange: { low: -2000, high: -2000 } });
    expect(result.amountScore).toBe(1);
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLDS.sure);
  });
});
