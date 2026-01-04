import { beforeAll, describe, expect, it } from 'vitest';

let computeEnhancedScores: any;

beforeAll(async () => {
  const mod: any = await import('../analytics/health-score-enhanced.js');
  const resolved = mod?._internal ? mod : mod?.default;
  computeEnhancedScores = resolved._internal.computeEnhancedScores;
});

describe('health-score-enhanced', () => {
  it('uses time-window totals for savings score (not month buckets)', () => {
    const result = computeEnhancedScores({
      months: 3,
      monthlyCashFlow: [
        { month: '2025-11', income: 10_000, expense: 5_000, txnCount: 10 },
        { month: '2025-12', income: 10_000, expense: 4_000, txnCount: 10 },
        // Partial current month with no income yet should not tank the score
        { month: '2026-01', income: 0, expense: 100, txnCount: 2 },
      ],
      expenses: Array.from({ length: 40 }, (_v, idx) => ({
        date: new Date(2025, 10, 1 + idx),
        amount: idx % 2 === 0 ? 50 : 150,
        parentCategory: idx % 2 === 0 ? 'Food' : 'Transport',
      })),
      currentBalance: 50_000,
      dateRange: { startDate: new Date('2025-11-01'), endDate: new Date('2026-01-04') },
    });

    expect(result.breakdown.savingsScore).toBeGreaterThanOrEqual(80);
  });

  it('computes impulse score from time-window micro-spend share', () => {
    // microThreshold ~= 100 based on avgMonthlyIncome
    const result = computeEnhancedScores({
      months: 2,
      monthlyCashFlow: [{ month: '2025-12', income: 66_666, expense: 0, txnCount: 1 }],
      expenses: [
        ...Array.from({ length: 30 }, (_v, idx) => ({
          date: new Date(2025, 11, 1 + idx),
          amount: 50,
          parentCategory: 'Food',
        })),
        ...Array.from({ length: 10 }, (_v, idx) => ({
          date: new Date(2025, 11, 1 + idx),
          amount: 450,
          parentCategory: 'Transport',
        })),
      ],
      currentBalance: 10_000,
      dateRange: { startDate: new Date('2025-11-05'), endDate: new Date('2026-01-04') }, // ~60 days
    });

    // microShare = 1500 / 6000 = 0.25 -> ~66.7 -> rounds to 67
    expect(result.breakdown.impulseScore).toBe(67);
  });
});
