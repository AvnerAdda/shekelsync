import { beforeAll, describe, expect, it, vi } from 'vitest';

let computeEnhancedScores: any;
let computeEnhancedHealthScore: any;

beforeAll(async () => {
  const mod: any = await import('../analytics/health-score-enhanced.js');
  const resolved = mod?._internal ? mod : mod?.default;
  computeEnhancedScores = resolved._internal.computeEnhancedScores;
  computeEnhancedHealthScore = resolved.computeEnhancedHealthScore;
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

  it('applies runway volatility penalty when monthly expense variance is high', () => {
    const result = computeEnhancedScores({
      months: 3,
      monthlyCashFlow: [
        { month: '2025-11', income: 10_000, expense: 100, txnCount: 20 },
        { month: '2025-12', income: 10_000, expense: 900, txnCount: 20 },
        { month: '2026-01', income: 10_000, expense: 300, txnCount: 10 },
      ],
      expenses: Array.from({ length: 40 }, (_v, idx) => ({
        date: new Date(2025, 10, 1 + idx),
        amount: idx % 2 === 0 ? 20 : 200,
        parentCategory: idx % 2 === 0 ? 'Food' : 'Transport',
      })),
      currentBalance: 6_000,
      // Mid-month end date excludes the current month from volatility sample.
      dateRange: { startDate: new Date('2025-11-01'), endDate: new Date('2026-01-15') },
    });

    expect(result.notes).toContain('Runway penalized: high month-to-month expense volatility.');
  });

  it('uses provided client and inferred balance when currentBalance is omitted', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ month: '2026-01', income: '2000', expense: '1200', txn_count: '10' }],
      })
      .mockResolvedValueOnce({
        rows: [{ date: '2026-01-05', amount: '100', category_name: 'Food', parent_category: 'Needs' }],
      })
      .mockResolvedValueOnce({
        rows: [{ total_income: '5000', total_expenses: '3200' }],
      });

    const result = await computeEnhancedHealthScore({
      months: 1,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      client: { query: clientQueryMock },
    });

    expect(clientQueryMock).toHaveBeenCalledTimes(3);
    expect(result.meta.currentBalance).toBe(1800);
  });

  it('uses provided client and skips balance query when currentBalance is supplied', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ month: '2026-01', income: '3000', expense: '1000', txn_count: '20' }],
      })
      .mockResolvedValueOnce({
        rows: [{ date: '2026-01-10', amount: '80', category_name: 'Food', parent_category: 'Needs' }],
      });

    const result = await computeEnhancedHealthScore({
      months: 1,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-31'),
      currentBalance: 4200,
      client: { query: clientQueryMock },
    });

    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    expect(result.meta.currentBalance).toBe(4200);
  });
});
