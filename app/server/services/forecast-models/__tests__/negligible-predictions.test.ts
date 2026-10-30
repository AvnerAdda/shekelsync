import { describe, expect, it } from 'vitest';
const { _internal: { dropNegligiblePredictions } } = require('../pattern.js');
const engine = require('../../forecast.js')._internal;

describe('negligible forecast predictions', () => {
  it('drops payments under 5 NIS or under a 5% chance from the day and its totals, keeping daily spending', () => {
    const day = {
      date: '2026-11-06', expectedIncome: 20530, expectedOperatingIncome: 20530, expectedNonOperatingIncome: 0,
      expectedExpenses: 1190 + 4 + 3 + 2.5, expectedInvestments: 0,
      predictions: [
        { patternKey: 'arnona', categoryType: 'expense', probability: 1, probabilityWeightedAmount: 1190 },
        { patternKey: 'rimon', categoryType: 'expense', probability: 0.5, probabilityWeightedAmount: 4 },
        { patternKey: 'unlikely', categoryType: 'expense', probability: 0.03, probabilityWeightedAmount: 3 },
        { patternKey: 'groceries', categoryType: 'expense', probability: 0.04, probabilityWeightedAmount: 2.5, timingBasis: 'daily_average' },
        { patternKey: 'salary', categoryType: 'income', incomeType: 'operating', probability: 1, probabilityWeightedAmount: 20530 },
      ],
    };
    const simulation = { date: '2026-11-06', entries: [{ patternKey: 'arnona' }, { patternKey: 'rimon' }, { patternKey: 'groceries' }] };

    dropNegligiblePredictions([day], [simulation], engine);

    expect(day.predictions.map(prediction => prediction.patternKey).sort()).toEqual(['arnona', 'groceries', 'salary']);
    expect(day.expectedExpenses).toBeCloseTo(1192.5);
    expect(day.expectedOperatingExpenses).toBeCloseTo(1192.5);
    expect(day.expectedCashFlow).toBeCloseTo(20530 - 1192.5);
    expect(simulation.entries.map(entry => entry.patternKey)).toEqual(['arnona', 'groceries']);
  });
});
