import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  InvestmentAccountSummary,
  InvestmentBalanceSheetResponse,
  PortfolioSummary,
} from '@renderer/types/investments';
import PortfolioCoveragePanel, { getPortfolioCoverageItems } from '../PortfolioCoveragePanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        title: 'Portfolio Coverage',
        subtitle: 'Shows what is missing and which accounts need review.',
        complete: 'Complete',
        issues: '{{count}} issues',
        affected: 'Accounts: {{names}}',
        affectedCount: '{{count}} accounts need review',
        affectedWithMore: 'Accounts: {{names}} and {{count}} more',
        transactionsAffected: '{{count}} investment transactions need account links',
        'actions.reviewAccounts': 'Review accounts',
        'actions.reviewTransactions': 'Review transactions',
        'items.missingValuations.label': 'Missing valuations',
        'items.missingValuations.hint': 'Accounts without a recorded valuation.',
        'items.staleValuations.label': 'Stale valuations',
        'items.staleValuations.hint': 'Accounts older than 30 days.',
        'items.missingCurrency.label': 'Missing currency metadata',
        'items.missingCurrency.hint': 'Accounts without a base currency.',
        'items.unlinkedTransactions.label': 'Unlinked investment transactions',
        'items.unlinkedTransactions.hint': 'Link recent investment cash flows.',
      };
      let result = translations[key] || key;
      Object.entries(values || {}).forEach(([name, value]) => {
        result = result.replace(`{{${name}}}`, String(value));
      });
      return result;
    },
  }),
}));

function makeAccount(overrides: Partial<InvestmentAccountSummary>): InvestmentAccountSummary {
  return {
    id: 1,
    account_name: 'Account',
    account_type: 'brokerage',
    investment_category: 'liquid',
    currency: 'ILS',
    current_value: 100,
    cost_basis: 90,
    as_of_date: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

function makePortfolio(accounts: InvestmentAccountSummary[]): PortfolioSummary {
  return {
    summary: {
      totalPortfolioValue: 300,
      totalCostBasis: 270,
      unrealizedGainLoss: 30,
      roi: 10,
      totalAccounts: accounts.length,
      accountsWithValues: accounts.length - 1,
      newestUpdateDate: new Date().toISOString().slice(0, 10),
      liquid: { totalValue: 300, totalCost: 270, unrealizedGainLoss: 30, roi: 10, accountsCount: accounts.length },
      illiquid: { totalValue: 0, totalCost: 0, unrealizedGainLoss: 0, roi: 0, accountsCount: 0 },
      restricted: { totalValue: 0, totalCost: 0, unrealizedGainLoss: 0, roi: 0, accountsCount: 0 },
    },
    categoryBuckets: {} as PortfolioSummary['categoryBuckets'],
    breakdown: [],
    timeline: [],
    accounts,
    liquidAccounts: accounts,
    illiquidAccounts: [],
    restrictedAccounts: [],
  };
}

function makeBalanceSheet(): InvestmentBalanceSheetResponse {
  const emptyBucket = {
    totalValue: 0,
    accountsCount: 0,
    accountsWithValue: 0,
    missingValueCount: 0,
    newestUpdateDate: null,
  };

  return {
    generatedAt: new Date().toISOString(),
    assets: {
      total: 300,
      newestUpdateDate: new Date().toISOString().slice(0, 10),
      buckets: {
        cash: { ...emptyBucket },
        liquid: { ...emptyBucket },
        illiquid: { ...emptyBucket },
        restricted: { ...emptyBucket },
        stability: { ...emptyBucket },
        other: { ...emptyBucket },
      },
      currencies: { distinct: ['ILS'], hasMultiple: false },
    },
    liabilities: {
      pendingCreditCardDebt: 0,
      pendingCreditCardDebtStatus: 'ok',
      lastCreditCardRepaymentDate: null,
      creditCardVendorCount: 1,
    },
    netWorth: 300,
    netWorthStatus: 'ok',
    missingValuationsCount: 1,
  };
}

describe('PortfolioCoveragePanel', () => {
  const accounts = [
    makeAccount({
      id: 1,
      account_name: 'Missing account',
      current_value: null as unknown as number,
      as_of_date: null,
    }),
    makeAccount({ id: 2, account_name: 'Stale account', as_of_date: '2000-01-01' }),
    makeAccount({ id: 3, account_name: 'Currency account', currency: '' }),
    makeAccount({ id: 4, account_name: 'Healthy account' }),
  ];

  it('reports concrete issue lists without an arbitrary percentage score', () => {
    const items = getPortfolioCoverageItems(makePortfolio(accounts), makeBalanceSheet());

    expect(items.map(({ id, count }) => ({ id, count }))).toEqual([
      { id: 'missingValuations', count: 1 },
      { id: 'staleValuations', count: 1 },
      { id: 'missingCurrency', count: 1 },
      { id: 'unlinkedTransactions', count: 0 },
    ]);
  });

  it('does not call a native valuation missing when only its FX conversion is unavailable', () => {
    const normalizedAccount = makeAccount({
      current_value: null as unknown as number,
      native_current_value: 250,
      native_currency: 'USD',
      fx_status: 'missing',
    });

    const items = getPortfolioCoverageItems(makePortfolio([normalizedAccount]), {
      ...makeBalanceSheet(),
      missingValuationsCount: 0,
    });

    expect(items.find((item) => item.id === 'missingValuations')).toMatchObject({ count: 0 });
  });

  it('does not call a native valuation missing when only its FX rate is unavailable', () => {
    const foreignAccount = makeAccount({
      id: 5,
      account_name: 'Foreign account',
      currency: 'USD',
      current_value: null as unknown as number,
      native_current_value: 250,
      fx_status: 'missing',
    });
    const balanceSheet = makeBalanceSheet();
    balanceSheet.missingValuationsCount = 0;

    const items = getPortfolioCoverageItems(makePortfolio([foreignAccount]), balanceSheet);

    expect(items.find((item) => item.id === 'missingValuations')?.count).toBe(0);
  });

  it('flags unlinked investment transactions and opens their review workflow', () => {
    const onManageAccounts = vi.fn();
    render(
      <PortfolioCoveragePanel
        portfolioData={makePortfolio(accounts)}
        balanceSheet={makeBalanceSheet()}
        unlinkedTransactionCount={2}
        loading={false}
        onManageAccounts={onManageAccounts}
      />,
    );

    expect(screen.getByText('2 investment transactions need account links')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review transactions' }));
    expect(onManageAccounts).toHaveBeenCalledWith('unlinkedTransactions', undefined);
  });

  it('shows affected account names and provides account-review actions', () => {
    const onManageAccounts = vi.fn();

    render(
      <PortfolioCoveragePanel
        portfolioData={makePortfolio(accounts)}
        balanceSheet={makeBalanceSheet()}
        loading={false}
        onManageAccounts={onManageAccounts}
      />,
    );

    expect(screen.getByText('Accounts: Missing account')).toBeInTheDocument();
    expect(screen.getByText('Accounts: Stale account')).toBeInTheDocument();
    expect(screen.getByText('Accounts: Currency account')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();

    const reviewButtons = screen.getAllByRole('button', { name: 'Review accounts' });
    expect(reviewButtons).toHaveLength(3);
    fireEvent.click(reviewButtons[0]);
    expect(onManageAccounts).toHaveBeenCalledTimes(1);
  });
});
