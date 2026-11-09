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
    t: (key: string, options?: unknown) =>
      (options && typeof options === 'object' ? `${key} ${JSON.stringify(options)}` : key),
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

  it('shows estimated payroll contributions in shekels since the last statement', () => {
    const account: InvestmentAccountSummary = {
      id: 7,
      account_name: 'Harel Pension',
      account_type: 'pension',
      investment_category: 'restricted',
      currency: 'ILS',
      current_value: 103_700,
      cost_basis: 83_700,
      as_of_date: '2026-09-15',
      estimated_contribution_adjustment: 3_700,
      estimated_contribution_since: '2026-09-15',
    };

    render(<InvestmentPerformanceCard account={account} history={[]} color="#2563eb" />);

    const line = screen.getByTestId('estimated-contributions');
    expect(line.textContent).toContain('estimatedContributions');
    expect(line.textContent).toContain('"amount":"₪3,700"');
    expect(line.textContent).toContain('"date":"Sep 15"');
  });

  it('hides the estimate line when nothing was estimated', () => {
    const account: InvestmentAccountSummary = {
      id: 8,
      account_name: 'Clal',
      account_type: 'provident',
      currency: 'ILS',
      current_value: 50_000,
      cost_basis: 40_000,
    };
    render(<InvestmentPerformanceCard account={account} history={[]} color="#2563eb" />);
    expect(screen.queryByTestId('estimated-contributions')).not.toBeInTheDocument();
  });

  it('shows when a keren hishtalmut becomes withdrawable', () => {
    const base: InvestmentAccountSummary = {
      id: 6, account_name: 'Clal', account_type: 'provident', currency: 'ILS', current_value: 125_507, cost_basis: 113_178,
    };
    const { unmount } = render(
      <InvestmentPerformanceCard account={{ ...base, keren_hishtalmut_withdrawable_from: '2099-02-01' }} history={[]} color="#2563eb" />,
    );
    expect(screen.getByTestId('keren-hishtalmut-withdrawable').textContent).toMatch(/^withdrawableFrom .*2099/);
    unmount();
    render(<InvestmentPerformanceCard account={{ ...base, keren_hishtalmut_withdrawable_from: '2020-02-01' }} history={[]} color="#2563eb" />);
    expect(screen.getByTestId('keren-hishtalmut-withdrawable').textContent).toMatch(/^withdrawableSince .*2020/);
  });
});
