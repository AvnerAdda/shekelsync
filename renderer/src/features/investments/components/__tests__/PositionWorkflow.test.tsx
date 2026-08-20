import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestmentPosition, PortfolioSummary } from '@renderer/types/investments';
import HoldingsPositionsSection from '../HoldingsPositionsSection';

const { mockPost, mockDelete } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: mockPost,
    put: vi.fn(),
    delete: mockDelete,
  },
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    maskAmounts: false,
    formatCurrency: (value: number, options?: { currencySymbol?: string }) =>
      `${options?.currencySymbol || '₪'}${value}`,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'investmentsPage.holdings.positionDialog.errors.saveFailed': 'Localized save failure',
        'investmentsPage.holdings.activityDialog.errors.recordFailed': 'Localized activity failure',
        'investmentsPage.holdings.closeDialog.errors.closeFailed': 'Localized close failure',
      };
      let result = translations[key] || (typeof fallback === 'string' ? fallback : key);
      const interpolation = typeof fallback === 'object' ? fallback : values;
      Object.entries(interpolation || {}).forEach(([name, value]) => {
        result = result.replace(`{{${name}}}`, String(value));
      });
      return result;
    },
    i18n: { language: 'en' },
  }),
}));

const position: InvestmentPosition = {
  id: 55,
  account_id: 7,
  account_name: 'US Brokerage',
  account_type: 'brokerage',
  investment_category: 'liquid',
  position_name: 'Global Fund',
  asset_symbol: 'VWRA',
  asset_type: 'etf',
  currency: 'USD',
  status: 'open',
  opened_at: '2026-01-01',
  units: 10,
  average_cost: 90,
  current_price: 110,
  valuation_date: '2026-08-10',
  original_cost_basis: 900,
  open_cost_basis: 900,
  current_value: 1100,
};

const portfolio: PortfolioSummary = {
  summary: {
    totalPortfolioValue: 1100,
    totalCostBasis: 900,
    unrealizedGainLoss: 200,
    roi: 22.2,
    totalAccounts: 1,
    accountsWithValues: 1,
    newestUpdateDate: '2026-08-10',
    liquid: { totalValue: 1100, totalCost: 900, unrealizedGainLoss: 200, roi: 22.2, accountsCount: 1 },
    illiquid: { totalValue: 0, totalCost: 0, unrealizedGainLoss: 0, roi: 0, accountsCount: 0 },
    restricted: { totalValue: 0, totalCost: 0, unrealizedGainLoss: 0, roi: 0, accountsCount: 0 },
  },
  categoryBuckets: {} as PortfolioSummary['categoryBuckets'],
  breakdown: [],
  timeline: [],
  accounts: [{
    id: 7,
    account_name: 'US Brokerage',
    account_type: 'brokerage',
    investment_category: 'liquid',
    currency: 'USD',
    current_value: 1100,
    cost_basis: 900,
    as_of_date: '2026-08-10',
    assets: [],
  }],
  liquidAccounts: [],
  illiquidAccounts: [],
  restrictedAccounts: [],
};

describe('position workflow', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      data: { position },
    });
    mockDelete.mockReset();
    mockDelete.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {},
    });
  });

  it('creates a holding in the account native currency and refreshes the parent', async () => {
    const onChanged = vi.fn();
    render(
      <HoldingsPositionsSection
        portfolioData={portfolio}
        positions={[]}
        loading={false}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add holding' }));
    fireEvent.change(screen.getByLabelText(/Holding name/), { target: { value: 'Global Fund' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/api/investments/positions',
      expect.objectContaining({
        account_id: 7,
        position_name: 'Global Fund',
        currency: 'USD',
        units: 0,
      }),
    ));
    expect(onChanged).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('records typed activity and refreshes the parent', async () => {
    const onChanged = vi.fn();
    render(
      <HoldingsPositionsSection
        portfolioData={portfolio}
        positions={[position]}
        loading={false}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));
    fireEvent.change(screen.getByLabelText(/Invested amount/), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record activity' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/api/investments/position-events',
      expect.objectContaining({
        position_id: 55,
        event_type: 'buy',
        principal_amount: 250,
      }),
    ));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows the localized editor fallback when a request rejects without an Error', async () => {
    mockPost.mockRejectedValueOnce(null);
    render(
      <HoldingsPositionsSection
        portfolioData={portfolio}
        positions={[]}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add holding' }));
    fireEvent.change(screen.getByLabelText(/Holding name/), { target: { value: 'Global Fund' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Localized save failure')).toBeInTheDocument();
  });

  it('shows the localized activity fallback when a request rejects without an Error', async () => {
    mockPost.mockRejectedValueOnce(null);
    render(
      <HoldingsPositionsSection
        portfolioData={portfolio}
        positions={[position]}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));
    fireEvent.change(screen.getByLabelText(/Invested amount/), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record activity' }));

    expect(await screen.findByText('Localized activity failure')).toBeInTheDocument();
  });

  it('shows the localized close fallback when a request rejects without an Error', async () => {
    mockDelete.mockRejectedValueOnce(null);
    render(
      <HoldingsPositionsSection
        portfolioData={portfolio}
        positions={[position]}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close holding' }));
    const dialog = screen.getByRole('dialog', { name: 'Close holding?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close holding' }));

    expect(await within(dialog).findByText('Localized close failure')).toBeInTheDocument();
  });
});
