import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '../HomePage';

const mockRefreshDashboard = vi.fn();
const mockRefreshFallbackDashboard = vi.fn();
const mockRefreshPortfolio = vi.fn();
const mockRefreshWaterfall = vi.fn();
const mockRefreshFallbackWaterfall = vi.fn();
const mockRefreshBreakdowns = vi.fn();
const mockRefreshFallbackBreakdowns = vi.fn();
const mockFetchBreakdown = vi.fn();
const mockFetchFallbackBreakdown = vi.fn();
const mockRefreshAccountSignals = vi.fn();
const mockRefreshPairingGap = vi.fn();
const mockRefreshInsights = vi.fn();
const mockSetHoveredDate = vi.fn();
const mockFetchTransactionsByDate = vi.fn();

const selectedStartDate = new Date(2026, 4, 1);
const selectedEndDate = new Date(2026, 4, 31);

let mockPrimaryLoading = false;
let mockFallbackLoading = false;
let mockPrimaryData: any = null;
let mockFallbackData: any = null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.defaultValue === 'string') {
        return options.defaultValue;
      }

      switch (key) {
        case 'empty.selectedRangeDescription':
          return `You have transaction history, but none for ${options?.selectedRange}.`;
        case 'empty.checkingPreviousRange':
          return `No transactions found for ${options?.selectedRange}. Checking your most recent activity.`;
        case 'empty.showPreviousRange':
          return `Show ${options?.fallbackRange}`;
        case 'empty.returnToSelectedRange':
          return `Back to ${options?.selectedRange}`;
        case 'empty.showingPreviousRange':
          return `Showing ${options?.fallbackRange} because ${options?.selectedRange} has no transactions.`;
        default:
          return key;
      }
    },
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

vi.mock('@app/contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    status: {
      stats: {
        transactionCount: 12,
      },
    },
  }),
}));

vi.mock('@renderer/features/dashboard/DashboardFiltersContext', () => ({
  DashboardFiltersProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDashboardFilters: () => ({
    startDate: selectedStartDate,
    endDate: selectedEndDate,
    aggregationPeriod: 'daily',
    hoveredDate: null,
    setHoveredDate: mockSetHoveredDate,
    periodDays: 31,
  }),
}));

vi.mock('@renderer/features/dashboard/hooks/useDashboardData', () => ({
  useDashboardData: ({ startDate, enabled = true }: { startDate: Date; enabled?: boolean }) => {
    const isFallbackRequest = startDate.getMonth() === 3;

    if (isFallbackRequest) {
      return {
        data: enabled ? mockFallbackData : null,
        loading: enabled ? mockFallbackLoading : false,
        error: null,
        cumulativeData: [],
        refresh: mockRefreshFallbackDashboard,
      };
    }

    return {
      data: mockPrimaryData,
      loading: mockPrimaryLoading,
      error: null,
      cumulativeData: [],
      refresh: mockRefreshDashboard,
    };
  },
}));

vi.mock('@renderer/features/dashboard/hooks/usePortfolioSummary', () => ({
  usePortfolioSummary: () => ({
    portfolioValue: 0,
    liquidPortfolio: 0,
    restrictedPortfolio: 0,
    refresh: mockRefreshPortfolio,
  }),
}));

vi.mock('@renderer/features/dashboard/hooks/useWaterfallData', () => ({
  useWaterfallData: ({ startDate, enabled = true }: { startDate: Date; enabled?: boolean }) => ({
    data: enabled && startDate.getMonth() === 3 ? { marker: 'fallback-waterfall' } : { marker: 'primary-waterfall' },
    loading: false,
    refresh: startDate.getMonth() === 3 ? mockRefreshFallbackWaterfall : mockRefreshWaterfall,
  }),
}));

vi.mock('@renderer/features/dashboard/hooks/useBreakdownData', () => ({
  useBreakdownData: ({ startDate, enabled = true }: { startDate: Date; enabled?: boolean }) => ({
    breakdownData: enabled && startDate.getMonth() === 3 ? { marker: 'fallback-breakdown' } : { marker: 'primary-breakdown' },
    breakdownLoading: {},
    breakdownErrors: {},
    fetchBreakdown: startDate.getMonth() === 3 ? mockFetchFallbackBreakdown : mockFetchBreakdown,
    refreshBreakdowns: startDate.getMonth() === 3 ? mockRefreshFallbackBreakdowns : mockRefreshBreakdowns,
  }),
}));

vi.mock('@renderer/features/dashboard/hooks/useAccountSignals', () => ({
  useAccountSignals: () => ({
    budgetUsage: null,
    hasBankAccounts: true,
    refresh: mockRefreshAccountSignals,
  }),
}));

vi.mock('@renderer/features/dashboard/hooks/useDashboardInsights', () => ({
  useDashboardInsights: () => ({
    forecastData: null,
    forecastLoading: false,
    forecastError: null,
    healthSnapshot: null,
    healthLoading: false,
    refresh: mockRefreshInsights,
  }),
}));

vi.mock('@renderer/features/dashboard/hooks/useTransactionsByDate', () => ({
  useTransactionsByDate: () => ({
    transactions: [],
    loading: false,
    fetchByDate: mockFetchTransactionsByDate,
  }),
}));

vi.mock('@renderer/shared/hooks/useCurrentMonthPairingGap', () => ({
  useCurrentMonthPairingGap: () => ({
    data: null,
    loading: false,
    refresh: mockRefreshPairingGap,
  }),
}));

vi.mock('@renderer/shared/empty-state', () => ({
  EmptyState: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  OnboardingChecklist: () => <div>onboarding-checklist</div>,
}));

vi.mock('@renderer/features/dashboard/components/DashboardSummarySection', () => ({
  default: ({ data }: { data: { marker?: string } }) => <div data-testid="summary-marker">{data?.marker}</div>,
}));

vi.mock('@renderer/features/dashboard/components/TransactionHistorySection', () => ({
  default: () => <div>transaction-history</div>,
}));

vi.mock('@renderer/features/dashboard/components/BreakdownTabsSection', () => ({
  default: () => <div>breakdown-tabs</div>,
}));

describe('HomePage dashboard fallback', () => {
  beforeEach(() => {
    mockPrimaryLoading = false;
    mockFallbackLoading = false;
    mockPrimaryData = {
      marker: 'primary',
      summary: {
        totalIncome: 0,
        totalExpenses: 0,
      },
      history: [],
    };
    mockFallbackData = {
      marker: 'fallback',
      summary: {
        totalIncome: 100,
        totalExpenses: 50,
      },
      history: [
        {
          date: '2026-04-10',
          income: 100,
          expenses: 50,
          capitalReturns: 0,
          cardRepayments: 0,
          pairedCardExpenses: 0,
          pairedCardRepayments: 0,
        },
      ],
    };

    mockRefreshDashboard.mockReset();
    mockRefreshFallbackDashboard.mockReset();
    mockRefreshPortfolio.mockReset();
    mockRefreshWaterfall.mockReset();
    mockRefreshFallbackWaterfall.mockReset();
    mockRefreshBreakdowns.mockReset();
    mockRefreshFallbackBreakdowns.mockReset();
    mockFetchBreakdown.mockReset();
    mockFetchFallbackBreakdown.mockReset();
    mockRefreshAccountSignals.mockReset();
    mockRefreshPairingGap.mockReset();
    mockRefreshInsights.mockReset();
    mockSetHoveredDate.mockReset();
    mockFetchTransactionsByDate.mockReset();
  });

  it('offers previous-period data without switching automatically, then lets the user toggle it on and off', async () => {
    render(<HomePage />);

    expect(screen.getByTestId('summary-marker').textContent).toBe('primary');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Show Apr 1, 2026 - Apr 30, 2026' })).toBeTruthy();
    });

    expect(screen.getByText('You have transaction history, but none for May 1, 2026 - May 31, 2026.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show Apr 1, 2026 - Apr 30, 2026' }));

    await waitFor(() => {
      expect(screen.getByTestId('summary-marker').textContent).toBe('fallback');
    });

    expect(screen.getByText('Showing Apr 1, 2026 - Apr 30, 2026 because May 1, 2026 - May 31, 2026 has no transactions.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to May 1, 2026 - May 31, 2026' }));

    await waitFor(() => {
      expect(screen.getByTestId('summary-marker').textContent).toBe('primary');
    });
  });
});
