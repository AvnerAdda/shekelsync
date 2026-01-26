import { beforeAll, describe, expect, it } from 'vitest';

let forecastModule: any;

beforeAll(async () => {
  forecastModule = await import('../forecast.js');
});

describe('forecast service internals', () => {
  it('treats forecastDays=0 as an empty window (no fallback to months)', () => {
    const { resolveForecastWindow, formatDate } = forecastModule._internal;
    const now = new Date(2025, 11, 31, 12, 0, 0);

    const { startDate, endDate } = resolveForecastWindow(now, {
      includeToday: false,
      forecastDays: 0,
      forecastMonths: 6,
    });

    expect(formatDate(startDate)).toBe('2026-01-01');
    expect(formatDate(endDate)).toBe('2025-12-31');
    expect(endDate.getTime()).toBeLessThan(startDate.getTime());
  });

  it('clamps monthly patterns to the last day when the target day does not exist', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const feb28 = new Date(2026, 1, 28);

    const dayOfWeekProb: Record<string, number> = {
      0: 1,
      1: 1,
      2: 1,
      3: 1,
      4: 1,
      5: 1,
      6: 1,
    };

    const incomePattern = {
      categoryType: 'income',
      patternType: 'monthly',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb,
      dayOfMonthProb: { 31: 1 },
      mostLikelyDaysOfMonth: [{ day: 31, probability: 1 }],
    };

    const expensePattern = {
      categoryType: 'expense',
      patternType: 'monthly',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb,
      dayOfMonthProb: { 31: 1 },
      mostLikelyDaysOfMonth: [{ day: 31, probability: 1 }],
    };

    expect(calculateDayProbability(incomePattern, feb28, {}, 'salary')).toBeGreaterThan(0);
    expect(calculateDayProbability(expensePattern, feb28, {}, 'rent')).toBeGreaterThan(0);
  });

  it('suppresses monthly patterns when the last occurrence was very recent (even across a month boundary)', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const jan1 = new Date(2026, 0, 1);

    const basePattern = {
      categoryType: 'income',
      patternType: 'monthly',
      avgOccurrencesPerMonth: 1,
      dayOfWeekProb: { [jan1.getDay()]: 0.01 },
      dayOfMonthProb: { 1: 0.01 },
      mostLikelyDaysOfMonth: [{ day: 1, probability: 1 }],
    };

    const tooSoonAcrossMonth = calculateDayProbability(
      { ...basePattern, lastOccurrence: '2025-12-25' }, // 7 days gap
      jan1,
      {},
      'salary',
    );
    const okAcrossMonth = calculateDayProbability(
      { ...basePattern, lastOccurrence: '2025-12-01' }, // 31 days gap
      jan1,
      {},
      'salary',
    );

    expect(tooSoonAcrossMonth).toBe(0);
    expect(okAcrossMonth).toBeGreaterThan(0);
  });

  it('suppresses low-frequency expense patterns until enough spacing has passed', () => {
    const { calculateDayProbability } = forecastModule._internal;
    const jan30 = new Date(2026, 0, 30);

    const lowFrequencyExpense = {
      categoryType: 'expense',
      patternType: 'sporadic',
      avgOccurrencesPerMonth: 0.1,
      dayOfWeekProb: { [jan30.getDay()]: 1 },
      dayOfMonthProb: { 30: 1 },
      mostLikelyDaysOfMonth: [{ day: 30, probability: 1 }],
      lastOccurrence: '2025-12-30',
    };

    const probability = calculateDayProbability(lowFrequencyExpense, jan30, {}, 'rent');
    expect(probability).toBe(0);
  });

  it('suppresses monthly expense patterns late in the current month when nothing has occurred', () => {
    const { adjustProbabilitiesForCurrentMonth } = forecastModule._internal;
    const patterns = {
      rent: {
        categoryType: 'expense',
        patternType: 'monthly',
        avgOccurrencesPerMonth: 1,
        mostLikelyDaysOfMonth: [{ day: 6, probability: 1 }],
      },
    };

    const adjustments = adjustProbabilitiesForCurrentMonth(patterns, [], 25);
    expect(adjustments.rent.probabilityMultiplier).toBe(0);
  });
});
