import { describe, expect, it } from 'vitest';

const { parseOptions, summarize, summarizeCategories, categoryErrors } = require('../../../../scripts/replay-forecast-estimators.js');
const argumentsForReplay = ['--from', '2026-03-01', '--through', '2026-09-30', '--actual-through', '2026-10-04'];

describe('forecast replay diagnostics', () => {
  it('supports separately evaluating bill cadence and rejects unknown comparisons', () => {
    expect(parseOptions([...argumentsForReplay, '--compare', 'infrequent']).compare).toBe('infrequent');
    expect(() => parseOptions([...argumentsForReplay, '--compare', 'unknown'])).toThrow(/compare/);
  });
  it('keeps opposing errors from cancelling out in MAE', () => {
    const result = summarize([
      { actual: 100, incumbent: 120, selected: 80, calendarAverage: 100, incumbentDailyMae: 3, selectedDailyMae: 4 },
      { actual: 100, incumbent: 80, selected: 120, calendarAverage: 100, incumbentDailyMae: 5, selectedDailyMae: 2 },
    ]);
    expect(result).toMatchObject({ windows: 2, incumbentMae: 20, selectedMae: 20,
      calendarAverageMae: 0, incumbentDailyMae: 4, selectedDailyMae: 3 });
  });

  it('includes unpredicted expenses and all predictions when attributing category errors', () => {
    const observations = categoryErrors([
      { date: '2026-04-01', category_type: 'expense', category_definition_id: 1, category_name: 'Bills', price: -100 },
      { date: '2026-04-01', category_type: 'expense', category_definition_id: 2, category_name: 'Repairs', price: -200 },
      { date: '2026-04-01', category_type: 'expense', category_definition_id: 1, price: 25 },
      { date: '2026-04-01', category_type: 'investment', category_definition_id: 3, price: -9999 },
      { date: '2026-04-02', category_type: 'expense', category_definition_id: 2, price: -9999 },
    ], [{ date: '2026-04-01', topPredictions: [], predictions: [
      { categoryType: 'expense', categoryDefinitionId: '1', category: 'Bills', probabilityWeightedAmount: 200 },
      { categoryType: 'expense', categoryDefinitionId: 1, category: 'Bills', probabilityWeightedAmount: 100, isBaselineForecast: true },
      { categoryType: 'income', categoryDefinitionId: 4, probabilityWeightedAmount: 5000 },
    ] }], '2026-03-31', 7);
    expect(observations).toHaveLength(2);
    const totals = observations.reduce((sum: { actual: number; predicted: number }, row: any) => ({
      actual: sum.actual + row.actual, predicted: sum.predicted + row.predicted,
    }), { actual: 0, predicted: 0 });
    expect(totals).toEqual({ actual: 300, predicted: 300 });
    const categories = summarizeCategories(observations, 2, 10);
    // Aggregate error is zero, but one category overshoots by 200 and the other
    // is missed by 200. An absent second window counts as zero for both.
    expect(categories.map((category: any) => category.mae)).toEqual([100, 100]);
    expect(categories.map((category: any) => category.bias).sort()).toEqual([-100, 100]);
    expect(categories[0]).toMatchObject({ windows: 2, affectedWindows: 1,
      predictionKinds: { category_pattern: 200, daily_average: 100 } });
    expect(summarizeCategories(observations, 2, 1)).toHaveLength(1);
  });

  it.each(['0', '101', '1.5', 'NaN'])('rejects invalid category limit %s', limit => {
    expect(() => parseOptions([...argumentsForReplay, '--category-limit', limit])).toThrow(/category-limit/);
  });

  it('accepts a bounded category report while preserving the date validation', () => {
    expect(parseOptions([...argumentsForReplay, '--category-limit', '10']))
      .toMatchObject({ 'category-limit': 10, 'actual-through': '2026-10-04' });
    expect(() => parseOptions([...argumentsForReplay, '--from', '2026-02-30'])).toThrow();
    expect(() => parseOptions([...argumentsForReplay, '--through', '2026-10-05'])).toThrow();
  });
});
