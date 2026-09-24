import { afterEach, describe, expect, it, vi } from 'vitest';

const { prepareProjectionPolicy, isProtectedInvestmentPattern } = require('../projection-policy.js');
const engine = require('../../forecast.js')._internal;

const categories = [
  { id: 1, name: 'Investments', name_en: 'Investments', category_type: 'investment' },
  { id: 2, name: 'Salary', name_en: 'Salary', category_type: 'income', is_counted_as_income: 1 },
  { id: 3, name: 'Rent', name_en: 'Rent', category_type: 'expense' },
];
const pattern = (extra: any = {}) => ({
  id: 1, categoryDefinitionId: 1, displayName: 'Broker', direction: 'expense',
  source: 'manual', state: 'active', confirmed: false, corrections: [],
  frequency: 'monthly', nextExpectedDate: '2026-04-15', amount: 1000,
  amountTolerance: 0, confidence: 1, occurrenceCount: 4, skippedOccurrences: [],
  ...extra,
});
const policy = (patterns: any[]) => prepareProjectionPolicy([], { patterns }, engine, categories).truthSnapshot;
const inject = (patterns: any[]) => {
  const day: any = {
    date: '2026-04-15', predictions: [], topPredictions: [], expectedIncome: 0,
    expectedExpenses: 0, expectedInvestments: 0, expectedOperatingIncome: 0,
    expectedOperatingExpenses: 0, expectedNonOperatingIncome: 0, expectedNonOperatingExpenses: 0,
  };
  const simulation: any = { date: day.date, monthKey: '2026-04', entries: [] };
  engine.injectResolvedRecurringPredictions([day], [simulation], policy(patterns));
  return { day, simulation };
};

afterEach(() => vi.restoreAllMocks());

describe('investment projection policy', () => {
  it.each(['detected', 'legacy_subscription'])('defers uncorrected %s investment patterns to investment inference', source => {
    expect(policy([pattern({ source })]).patterns).toEqual([]);
    expect(isProtectedInvestmentPattern(pattern({ source }))).toBe(false);
  });

  it.each([
    { source: 'manual' },
    { source: 'detected', confirmed: true },
    { source: 'legacy_subscription', confirmed: true },
    { source: 'detected', corrections: [{ action: 'override_pattern' }] },
    { source: 'legacy_subscription', corrections: [{ action: 'skip_occurrence' }] },
    { source: 'detected', state: 'paused' },
    { source: 'legacy_subscription', state: 'suppressed' },
  ])('preserves user authority for %j', extra => {
    const original = pattern(extra);
    const resolved = policy([original]).patterns[0];
    expect(resolved).toMatchObject({ ...original, projectionCategoryType: 'investment',
      investmentDirection: 1, incomeType: null, expenseType: null });
    expect(original).not.toHaveProperty('projectionCategoryType');
    expect(isProtectedInvestmentPattern(original)).toBe(true);
  });

  it('classifies withdrawals without changing their stored direction or amount', () => {
    const resolved = policy([pattern({ direction: 'income', amount: 300 })]).patterns[0];
    expect(resolved).toMatchObject({ direction: 'income', amount: 300,
      projectionCategoryType: 'investment', investmentDirection: -1 });
  });

  it('uses transaction categories when no category metadata was supplied', () => {
    const rows = [{ category_definition_id: 1, category_type: 'investment', price: -1000 }];
    const result = prepareProjectionPolicy(rows, { patterns: [pattern()] }, engine);
    expect(result.truthSnapshot.patterns[0].projectionCategoryType).toBe('investment');
    expect(result.transactions).toEqual(rows);
  });
});

describe('resolved investment occurrences', () => {
  it('keeps a saved contribution on its exact date and out of income and expenses', () => {
    const { day, simulation } = inject([pattern()]);
    expect(day).toMatchObject({ expectedInvestments: 1000, expectedIncome: 0,
      expectedExpenses: 0, expectedCashFlow: 0 });
    expect(day.predictions[0]).toMatchObject({ date: '2026-04-15', categoryType: 'investment',
      predictionKind: 'recurring_investment', expectedAmount: 1000, probabilityWeightedAmount: 1000,
      isUserResolvedPattern: true });
    expect(simulation.entries[0]).toMatchObject({ categoryType: 'investment', avgAmount: 1000,
      investmentDirection: 1, incomeType: null, expenseType: null });
  });

  it.each([300, -300])('keeps withdrawal amount %i negative exactly once', amount => {
    const { day, simulation } = inject([pattern({ direction: 'income', amount })]);
    expect(day).toMatchObject({ expectedInvestments: -300, expectedIncome: 0, expectedExpenses: 0 });
    expect(day.predictions[0]).toMatchObject({ expectedAmount: -300,
      probabilityWeightedAmount: -300, investmentDirection: -1 });
    expect(simulation.entries[0]).toMatchObject({ avgAmount: 300, investmentDirection: -1 });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = engine.simulateScenario([simulation], {});
    expect(result).toMatchObject({ totalInvestments: -300, totalIncome: 0, totalExpenses: 0 });
  });

  it('preserves ordering of signed withdrawal amount ranges', () => {
    const { day } = inject([pattern({ direction: 'income', amount: 300, amountTolerance: 25 })]);
    expect(day.predictions[0].amountRange).toEqual({ low: -325, high: -275 });
  });

  it.each([
    { state: 'paused' },
    { state: 'suppressed' },
    { state: 'ended', endedAt: '2026-04-01' },
    { skippedOccurrences: ['pattern:1:2026-04-15'] },
  ])('does not reintroduce controlled occurrences: %j', control => {
    const { day, simulation } = inject([pattern(control)]);
    expect(day.expectedInvestments).toBe(0);
    expect(day.predictions).toEqual([]);
    expect(simulation.entries).toEqual([]);
  });

  it('leaves recurring income and expense totals unchanged alongside investments', () => {
    const { day, simulation } = inject([
      pattern(),
      pattern({ id: 2, categoryDefinitionId: 2, direction: 'income', amount: 5000 }),
      pattern({ id: 3, categoryDefinitionId: 3, direction: 'expense', amount: 2000 }),
    ]);
    expect(day).toMatchObject({ expectedInvestments: 1000, expectedIncome: 5000,
      expectedExpenses: 2000, expectedCashFlow: 3000 });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = engine.simulateScenario([simulation], {});
    expect(result).toMatchObject({ totalInvestments: 1000, totalIncome: 5000,
      totalExpenses: 2000, totalCashFlow: 3000 });
  });

  it.each(['monthly', 'investment_schedule'])('nets contributions and withdrawals in %s simulations', patternType => {
    const entries = [
      { monthlyKey: 'deposit', patternType, categoryType: 'investment', investmentDirection: 1,
        probability: 1, avgAmount: 1000, stdDev: 0 },
      { monthlyKey: 'withdrawal', patternType, categoryType: 'investment', investmentDirection: -1,
        probability: 1, avgAmount: 300, stdDev: 0 },
      { monthlyKey: 'legacy', patternType, categoryType: 'investment', probability: 1, avgAmount: 50, stdDev: 0 },
    ];
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = engine.simulateScenario([{ date: '2026-04-15', monthKey: '2026-04', entries }], {});
    expect(result.totalInvestments).toBe(750);
    expect(result.dailyResults[0]).toMatchObject({ investments: 750, income: 0, expenses: 0 });
  });
});
