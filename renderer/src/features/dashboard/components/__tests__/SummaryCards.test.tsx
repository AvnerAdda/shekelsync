import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SummaryCards from '../SummaryCards';
import {
  computeEffectiveNetInvestments,
  computeNetSavings,
  computePendingExpenseImpact,
  computeSummaryHealthMetrics,
} from '../summary-cards-helpers';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number | null | undefined) =>
      `₪${Math.round(Math.abs(value ?? 0)).toLocaleString('en-US')}`,
  }),
}));

vi.mock('@renderer/features/budgets/hooks/useSpendingCategories', () => ({
  useSpendingCategories: () => ({
    breakdown: null,
    fetchBreakdown: () => undefined,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'summary.categories.essential': 'Essential',
        'summary.categories.growth': 'Growth',
        'summary.categories.stability': 'Stability',
        'summary.categories.reward': 'Reward',
        'summary.health.subtitle': 'Financial Health Score',
        'summary.health.savings': 'Savings',
        'summary.health.diversity': 'Diversity',
        'summary.health.impulse': 'Impulse',
        'summary.health.runway': 'Runway',
        'summary.cards.finance.title': 'Current Month',
        'summary.cards.finance.subtitle': 'Bank: {{amount}}',
        'summary.cards.finance.income': 'Income',
        'summary.cards.finance.expenses': 'Expenses',
        'summary.cards.finance.expensesIncludingPending': 'Expenses (incl. pending settlement)',
        'summary.cards.finance.pendingLabel': 'Pending settlement ({{count}})',
        'summary.cards.finance.pendingBreakdownTitle': 'Future settlement dates',
        'summary.cards.finance.pendingBreakdownLine': '{{amount}} ({{count}} tx)',
        'summary.cards.finance.pendingBreakdownFallback': 'No future settlement date breakdown available',
        'summary.cards.finance.pendingIncludedNote': 'Already included in Expenses above; shown separately by settlement date.',
        'summary.cards.portfolio.title': 'Investment Portfolio',
        'summary.cards.analysis.title': 'Financial Health',
        'summary.budgets.utilization': 'Budget Utilization ({{count}} categories)',
        'summary.allocation.actual': 'Actual Allocation',
        'summary.allocation.target': 'Target: {{targets}}%',
      };

      return Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        translations[key] ?? key,
      );
    },
  }),
}));

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

describe('SummaryCards component', () => {
  it('shows pending expenses grouped by processed date on hover', async () => {
    const user = userEvent.setup();

    render(
      <SummaryCards
        totalIncome={5000}
        totalExpenses={1000}
        currentBankBalance={8000}
        pendingExpenses={750}
        pendingCount={3}
        pendingByProcessedDate={[
          { date: '2026-07-18', amount: 500, count: 2 },
          { date: '2026-07-25', amount: 250, count: 1 },
        ]}
        portfolioValue={0}
      />,
    );

    expect(screen.getByText('Expenses (incl. pending settlement)')).toBeInTheDocument();
    expect(screen.getByText('Already included in Expenses above; shown separately by settlement date.')).toBeInTheDocument();

    await user.hover(screen.getByText('Pending settlement (3)'));

    expect(await screen.findByText('Future settlement dates')).toBeInTheDocument();
    expect(screen.getByText('Jul 18')).toBeInTheDocument();
    expect(screen.getByText('₪500 (2 tx)')).toBeInTheDocument();
    expect(screen.getByText('Jul 25')).toBeInTheDocument();
    expect(screen.getByText('₪250 (1 tx)')).toBeInTheDocument();
  });
});
