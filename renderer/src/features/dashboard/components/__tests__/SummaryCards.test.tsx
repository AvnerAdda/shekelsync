import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SummaryCards from '../SummaryCards';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number | null | undefined) => `₪${Math.round(value ?? 0).toLocaleString()}`,
  }),
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

  it('shows current bank balance subtitle and savings score', () => {
    render(<SummaryCards {...baseProps} />);

    expect(screen.getByText('Bank: ₪2,000')).toBeInTheDocument();
    expect(screen.getByText('Savings Score')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders portfolio breakdown entries', () => {
    render(<SummaryCards {...baseProps} />);

    expect(screen.getByText('Stocks')).toBeInTheDocument();
    expect(screen.getByText('Bonds')).toBeInTheDocument();
  });

  it('displays diversity metric when category data is provided', () => {
    render(<SummaryCards {...baseProps} />);

    expect(screen.getByText(/Diversity/i)).toBeInTheDocument();
  });
});
