import { describe, expect, it } from 'vitest';
import {
  computeEffectiveNetInvestments,
  computeNetSavings,
  computePendingExpenseImpact,
  computeSummaryHealthMetrics,
} from '../summary-cards-helpers';

describe('SummaryCards helpers', () => {
  it('computes effective investments and net savings', () => {
    expect(computeEffectiveNetInvestments(1000, 200)).toBe(800);
    expect(computeEffectiveNetInvestments(100, 200)).toBe(0);
    expect(computeNetSavings(5000, 3000, 800)).toBe(1200);
  });

  it('derives pending expense risk states', () => {
    const overdraft = computePendingExpenseImpact({
      netSavings: 300,
      pendingExpenses: 700,
      currentBankBalance: 200,
    });
    expect(overdraft.hasPendingExpenses).toBe(true);
    expect(overdraft.showPendingDeficitWarning).toBe(true);
    expect(overdraft.showPendingDeficitCovered).toBe(false);
    expect(overdraft.pendingDeficitAmount).toBe(400);
    expect(overdraft.pendingOverdraftAmount).toBe(500);

    const covered = computePendingExpenseImpact({
      netSavings: 300,
      pendingExpenses: 700,
      currentBankBalance: 2000,
    });
    expect(covered.showPendingDeficitWarning).toBe(false);
    expect(covered.showPendingDeficitCovered).toBe(true);
    expect(covered.pendingOverdraftAmount).toBe(0);
  });

  it('computes savings/diversity/impulse/runway health metrics', () => {
    const withRealBreakdown = computeSummaryHealthMetrics({
      totalIncome: 10000,
      totalExpenses: 5000,
      currentBankBalance: 6000,
      topCategories: [{ name: 'Rent', amount: 2000 }],
      categoryCount: 3,
    });

    expect(withRealBreakdown.savingsScore).toBe(100);
    expect(withRealBreakdown.diversityScore).toBe(60);
    expect(withRealBreakdown.impulseControl).toBe(60);
    expect(withRealBreakdown.runwayDays).toBeCloseTo(36, 6);
    expect(withRealBreakdown.runwayScore).toBeCloseTo(60, 6);

    const fallbackOnly = computeSummaryHealthMetrics({
      totalIncome: 10000,
      totalExpenses: 5000,
      currentBankBalance: 6000,
      topCategories: [{ name: 'Total Expenses', amount: 5000 }],
      categoryCount: 1,
    });
    expect(fallbackOnly.diversityScore).toBeUndefined();
    expect(fallbackOnly.impulseControl).toBeUndefined();
  });
});
