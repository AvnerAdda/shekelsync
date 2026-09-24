import { describe, expect, it } from 'vitest';

const engine = require('../forecast.js')._internal;

const history = (names: Array<string | null>, vendors: Array<string | null>) => names.map((name, index) => {
  const date = new Date(2026, index, 7, 12);
  return { date: engine.formatDate(date), month: engine.formatDate(date).slice(0, 7),
    name, vendor: vendors[index], price: -500, category_type: 'expense', category_definition_id: 10,
    category_name: 'Bills', category_name_en: 'Bills', parent_category_name: 'Home',
    day_of_month: 7, day_of_week: date.getDay() };
});
const predict = (rows: any[]) => {
  const patterns = engine.analyzeCategoryPatterns(rows);
  const day = engine.forecastDay(new Date(2026, 3, 7, 12), patterns, {});
  expect(day.predictions).toHaveLength(1);
  return { prediction: day.predictions[0], patterns };
};

describe('forecast source metadata', () => {
  it('shows the merchant and bank when all category evidence has one source', () => {
    const { prediction, patterns } = predict(history(['Electric Co', 'Electric Co', 'Electric Co'], ['bank', 'bank', 'bank']));
    expect(prediction).toMatchObject({ transactionName: 'Electric Co', vendor: 'bank',
      categoryDefinitionId: 10, category: 'Bills', parentCategory: 'Home' });
    // Display metadata does not split or change the category-level inference model.
    expect(Object.values(patterns)[0]).toMatchObject({ transactionName: null, avgAmount: 500 });
  });

  it('does not attribute combined category spending to an arbitrary merchant or bank', () => {
    const { prediction } = predict(history(['Electric Co', 'Water Co', 'Internet Co'], ['bank-a', 'bank-b', 'bank-c']));
    expect(prediction).toMatchObject({ transactionName: null, vendor: null, categoryDefinitionId: 10 });
  });

  it('shows an unambiguous bank even when the category combines multiple merchants', () => {
    const { prediction } = predict(history(['Electric Co', 'Water Co', 'Internet Co'], ['bank', 'bank', 'bank']));
    expect(prediction).toMatchObject({ transactionName: null, vendor: 'bank' });
  });

  it('treats unknown source evidence as ambiguous rather than filling it from other rows', () => {
    const { prediction } = predict(history(['Electric Co', null, 'Electric Co'], ['bank', null, 'bank']));
    expect(prediction).toMatchObject({ transactionName: null, vendor: null });
  });

  it('preserves source metadata when the expense forecast is generated from a monthly baseline', () => {
    const { patterns } = predict(history(['Electric Co', 'Electric Co', 'Electric Co'], ['bank', 'bank', 'bank']));
    const patternKey = Object.keys(patterns)[0];
    const forecasts: any[] = [{ date: '2026-04-07', predictions: [], expectedIncome: 0, expectedExpenses: 0 }];
    const simulations = [{ date: '2026-04-07', monthKey: '2026-04', entries: [] }];
    engine.reconcileVariableExpenseForecasts(forecasts, simulations, {
      [patternKey]: { patternKey, category: 'Bills', categoryDefinitionId: 10, parentCategory: 'Home',
        monthlyBaseline: 500, monthlyStdDev: 0 },
    }, [], new Date(2026, 2, 31, 12), patterns);
    expect(forecasts[0].predictions).toEqual([
      expect.objectContaining({ transactionName: 'Electric Co', vendor: 'bank', isBaselineForecast: true }),
    ]);
  });

  it('forwards resolved pattern vendors only when the snapshot explicitly supplies them', () => {
    const patterns = [
      { id: 1, vendor: 'bank-a' }, { id: 2 },
    ].map(extra => ({ categoryDefinitionId: 10, displayName: 'Utility payment', direction: 'expense',
      source: 'manual', state: 'active', frequency: 'monthly', nextExpectedDate: '2026-04-07',
      amount: 500, amountTolerance: 0, confidence: 1, skippedOccurrences: [], ...extra }));
    const forecasts: any[] = [{ date: '2026-04-07', predictions: [], expectedIncome: 0, expectedExpenses: 0 }];
    engine.injectResolvedRecurringPredictions(forecasts, [], { patterns });
    expect(forecasts[0].predictions).toEqual([
      expect.objectContaining({ transactionName: 'Utility payment', vendor: 'bank-a' }),
      expect.objectContaining({ transactionName: 'Utility payment', vendor: null }),
    ]);
  });
});
