import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import InvestmentsSummarySection from '../InvestmentsSummarySection';
import type { PortfolioSummary } from '@renderer/types/investments';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

const renderWithTheme = (ui: React.ReactNode) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

const samplePortfolio: PortfolioSummary = {
  summary: {
    totalPortfolioValue: 100000,
    totalCostBasis: 80000,
    unrealizedGainLoss: 20000,
    roi: 5,
    totalAccounts: 2,
    accountsWithValues: 2,
    newestUpdateDate: '2024-11-01',
    liquid: {
      totalValue: 60000,
      totalCost: 50000,
      unrealizedGainLoss: 10000,
      roi: 6,
      accountsCount: 1,
    },
    restricted: {
      totalValue: 40000,
      totalCost: 30000,
      unrealizedGainLoss: 10000,
      roi: 4,
      accountsCount: 1,
    },
  },
  breakdown: [],
  timeline: [],
  accounts: [],
  liquidAccounts: [],
  restrictedAccounts: [],
};

describe('InvestmentsSummarySection', () => {
  it('renders skeletons while loading', () => {
    const { container } = renderWithTheme(
      <InvestmentsSummarySection portfolioData={null} loading />
    );

    expect(container.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
  });

  it('returns null when no portfolio data', () => {
    const { container } = renderWithTheme(
      <InvestmentsSummarySection portfolioData={null} loading={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('shows formatted portfolio summary when data is available', () => {
    renderWithTheme(<InvestmentsSummarySection portfolioData={samplePortfolio} loading={false} />);

    expect(screen.getByText('Total Portfolio')).toBeInTheDocument();
    expect(screen.getByText('Liquid Investments')).toBeInTheDocument();
    expect(screen.getByText('Long-term Savings')).toBeInTheDocument();
    expect(screen.getAllByText('₪100000')[0]).toBeInTheDocument();
    expect(screen.getByText('+5.00%')).toBeInTheDocument();
  });
});
