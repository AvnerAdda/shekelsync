import { describe, expect, it } from 'vitest';
const { recentSpendingEstimate } = require('../planning-history.js');
const today = '2026-09-08';
const row = (date, price, kind = 'expense', category_definition_id = 1) => ({ date, price, kind, category_definition_id });
const estimate = (rows, days = []) => recentSpendingEstimate({ query: async (_, params) => {
  expect(params).toEqual(['2026-06-11', '2026-09-09']);
  return { rows };
} }, today, 30, days);

describe('automatic recent-spending fallback', () => {
  it('uses the observed calendar span, nets refunds and preserves cents over a month', async () => {
    const result = await estimate([row('2026-06-11', 5000, 'income'), row(today, -1000), row(today, 100), row(today, -0.01)]);
    expect(result.historyDays).toBe(90);
    expect(result.days).toHaveLength(30);
    expect(result.days.reduce((sum, day) => sum + Math.round(day.expectedOperatingExpenses * 100), 0)).toBe(30000);
    expect(result.days.every((day) => day.expectedOperatingIncome === 0)).toBe(true);
  });

  it('works with a short import and does not treat excess refunds as future income', async () => {
    const result = await estimate([row(today, -300), row(today, 900, 'expense', 2)]);
    expect(result.historyDays).toBe(1);
    expect(result.days.every((day) => day.expectedOperatingExpenses === 10)).toBe(true);
  });

  it('keeps higher known bills and fills gaps or invalid forecast amounts', async () => {
    const result = await estimate([row(today, -300)], [
      { date: '2026-09-09', expectedOperatingExpenses: 100, expectedOperatingIncome: 200 },
      { date: '2026-09-10', expectedOperatingExpenses: null, expectedOperatingIncome: NaN },
      { date: '2026-09-11', expectedOperatingExpenses: -10 },
    ]);
    expect(result.days.slice(0, 3).map((day) => day.expectedOperatingExpenses)).toEqual([100, 10, 10]);
    expect(result.days.slice(0, 3).map((day) => day.expectedOperatingIncome)).toEqual([200, 0, 0]);
  });

  it('does not invent transaction history when none was imported', async () => {
    expect(await estimate([])).toBeNull();
  });
});
