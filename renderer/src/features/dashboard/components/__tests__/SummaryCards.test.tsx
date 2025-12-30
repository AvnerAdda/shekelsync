import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@renderer/i18n/I18nProvider';
import SummaryCards from '../SummaryCards';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number | null | undefined) => `₪${Math.round(value ?? 0).toLocaleString()}`,
  }),
}));

vi.mock('@renderer/features/budgets/hooks/useSpendingCategories', () => ({
  useSpendingCategories: () => ({
    breakdown: {
      breakdown: [
        { spending_category: 'essential', actual_percentage: 50 },
        { spending_category: 'growth', actual_percentage: 20 },
        { spending_category: 'stability', actual_percentage: 15 },
        { spending_category: 'reward', actual_percentage: 15 },
      ],
      targets: { essential: 50, growth: 20, stability: 15, reward: 15 },
    },
    fetchBreakdown: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(async () => ({
      ok: true,
      data: { overallHealthScore: 80, healthBreakdown: {} },
    })),
  },
}));

describe('SummaryCards', () => {
  const baseProps = {
    totalIncome: 1000,
    totalExpenses: 400,
    netInvestments: 100,
    currentBankBalance: 2000,
    portfolioValue: 5000,
    portfolioGains: 250,
    assetBreakdown: [
      { name: 'Stocks', value: 3000, percentage: 60 },
      { name: 'Bonds', value: 2000, percentage: 40 },
    ],
    topCategories: [
      { name: 'Housing', amount: 200 },
      { name: 'Food', amount: 100 },
    ],
    categoryCount: 5,
  };

  const renderWithProviders = () =>
    render(
      <I18nProvider>
        <SummaryCards {...baseProps} />
      </I18nProvider>,
    );

  it('shows current bank balance subtitle and savings score', () => {
    renderWithProviders();

    expect(screen.getByText('Bank: ₪2,000')).toBeInTheDocument();
    expect(screen.getByText('Financial Health Score')).toBeInTheDocument();
  });

  it('renders portfolio breakdown entries', () => {
    renderWithProviders();

    expect(screen.getByText('Stocks')).toBeInTheDocument();
    expect(screen.getByText('Bonds')).toBeInTheDocument();
  });

  it('displays diversity metric when category data is provided', () => {
    renderWithProviders();

    expect(screen.getByText('Financial Health')).toBeInTheDocument();
  });
});
