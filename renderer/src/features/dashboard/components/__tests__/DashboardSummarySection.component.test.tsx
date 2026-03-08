import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardSummarySection from '../DashboardSummarySection';

vi.mock('../SummaryCards', () => ({
  __esModule: true,
  default: () => <div data-testid="summary-cards">summary-cards</div>,
}));

vi.mock('../../DashboardFiltersContext', () => ({
  useDashboardFilters: () => ({
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    endDate: new Date('2026-03-31T00:00:00.000Z'),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'pairingGap.title') return 'Missing credit card transactions detected';
      if (key === 'pairingGap.action') return 'Open Accounts';
      if (key === 'pairingGap.description') {
        return `Missing ${options?.amount} this month (${options?.percent}% of expenses).`;
      }
      if (key === 'fallbackCategory') return 'Total Expenses';
      if (key === 'noIncomeTitle') return 'No Income';
      if (key === 'noIncomeAddAccounts') return 'Add accounts';
      if (key === 'noIncomeDetected') return 'No income detected';
      return key;
    },
  }),
}));

function buildProps(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      summary: {
        totalIncome: 5000,
        totalCapitalReturns: 0,
        totalExpenses: 2000,
        netInvestments: 0,
        currentBankBalance: 10000,
        monthStartBankBalance: 9000,
        pendingExpenses: 0,
        pendingCount: 0,
      },
    },
    portfolioValue: 0,
    liquidPortfolio: [],
    restrictedPortfolio: [],
    budgetUsage: undefined,
    breakdownData: {},
    hasBankAccounts: true,
    compareToLastMonth: false,
    onToggleCompare: vi.fn(),
    pairingGap: {
      windowDays: 30,
      windowStartDate: '2026-02-08',
      windowEndDate: '2026-03-08',
      tolerance: 2,
      totals: {
        bankAmount: 1000,
        cardAmount: 900,
        missingAmount: 100,
        affectedPairingsCount: 1,
        affectedCyclesCount: 1,
      },
      pairings: [],
      generatedAt: '2026-03-08T00:00:00.000Z',
    },
    pairingGapLoading: false,
    isCurrentMonthWindow: true,
    ...overrides,
  };
}

describe('DashboardSummarySection component', () => {
  it('shows pairing-gap warning for 30-day current window and opens accounts modal from CTA', () => {
    const openAccountsListener = vi.fn();
    window.addEventListener('openAccountsModal', openAccountsListener);

    render(<DashboardSummarySection {...buildProps()} />);

    expect(screen.getByText('Missing credit card transactions detected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Accounts' }));
    expect(openAccountsListener).toHaveBeenCalledTimes(1);

    window.removeEventListener('openAccountsModal', openAccountsListener);
  });

  it('hides pairing-gap warning outside 30-day view', () => {
    render(
      <DashboardSummarySection
        {...buildProps({
          isCurrentMonthWindow: false,
        })}
      />,
    );

    expect(screen.queryByText('Missing credit card transactions detected')).not.toBeInTheDocument();
  });
});
