import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InvestmentAccountSummary, PortfolioHistoryPoint } from '@renderer/types/investments';
import InvestmentPerformanceCard from '../InvestmentPerformanceCard';

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    maskAmounts: false,
    formatCurrency: (value: number, options?: { currencySymbol?: string }) =>
      `${options?.currencySymbol || '₪'}${Number(value).toLocaleString('en-US')}`,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

describe('InvestmentPerformanceCard currency display', () => {
  it('uses the normalized portfolio base currency for the value and range', () => {
    const account: InvestmentAccountSummary = {
      id: 1,
      account_name: 'Global brokerage',
      account_type: 'brokerage',
      investment_category: 'liquid',
      currency: 'EUR',
      native_currency: 'EUR',
      base_currency: 'USD',
      current_value: 2_000,
      cost_basis: 1_500,
    };
    const history: PortfolioHistoryPoint[] = [
      { date: '2026-01-01', currentValue: 1_000, costBasis: 900 },
      { date: '2026-02-01', currentValue: 2_000, costBasis: 1_500 },
    ];

    render(
      <InvestmentPerformanceCard
        account={account}
        history={history}
        color="#2563eb"
      />,
    );

    expect(screen.getByText('USD 2,000')).toBeInTheDocument();
    expect(screen.getByText('USD 2k')).toBeInTheDocument();
    expect(screen.getByText('USD 1k')).toBeInTheDocument();
    expect(screen.queryByText(/₪/)).not.toBeInTheDocument();
  });
});
