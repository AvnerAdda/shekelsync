import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActivityPage from '../pages/ActivityPage';

const get = vi.fn();
const onboarding = vi.hoisted(() => ({
  status: null as any,
  getPageAccessStatus: vi.fn(),
}));

vi.mock('@renderer/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
  },
}));

vi.mock('@app/contexts/FinancePrivacyContext', () => ({
  useFinancePrivacy: () => ({
    formatCurrency: (value: number) => `₪${Math.round(Math.abs(value)).toLocaleString('en-US')}`,
  }),
}));

vi.mock('@app/contexts/OnboardingContext', () => ({
  useOnboarding: () => onboarding,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: Record<string, unknown> | string) => (
      typeof options === 'string' ? options : options?.defaultValue || key
    ),
  }),
}));

const response = {
  ok: true,
  data: {
    transactions: [
      {
        identifier: 'income-1',
        vendor: 'acme-payroll',
        name: 'Salary',
        category_name: 'Salary',
        category_type: 'income',
        price: 12_000,
        date: '2026-08-31T08:00:00.000Z',
      },
      {
        identifier: 'expense-1',
        vendor: 'corner-cafe',
        name: 'Corner Café',
        category_name: 'Dining',
        category_type: 'expense',
        price: -48,
        date: '2026-08-31T10:00:00.000Z',
      },
      {
        identifier: 'investment-return-1',
        vendor: 'brokerage',
        name: 'Investment return',
        category_name: 'Investments',
        category_type: 'investment',
        price: 10_000,
        date: '2026-08-30T10:00:00.000Z',
      },
    ],
  },
};

describe('ActivityPage', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue(response);
    onboarding.status = {
      isComplete: true,
      completedSteps: {
        profile: true,
        bankAccount: true,
        creditCard: true,
        firstScrape: true,
        explored: true,
      },
      stats: {
        accountCount: 2,
        bankAccountCount: 1,
        creditCardCount: 1,
        transactionCount: 3,
        lastScrapeDate: '2026-08-31T10:00:00.000Z',
        hasProfile: true,
      },
      suggestedAction: null,
    };
    onboarding.getPageAccessStatus.mockReset();
    onboarding.getPageAccessStatus.mockReturnValue({
      isLocked: false,
      requiredStep: '',
      reason: '',
    });
  });

  it('loads a ledger and opens an existing transaction detail flow', async () => {
    const onOpen = vi.fn();
    window.addEventListener('openTransactionDetail', onOpen);

    render(<ActivityPage />);

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect((await screen.findAllByText('Salary')).length).toBeGreaterThan(0);
    expect(screen.getByText('Corner Café')).toBeInTheDocument();
    expect(screen.getAllByText('₪12,000').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Corner Café'));

    expect(onOpen).toHaveBeenCalledOnce();
    expect((onOpen.mock.calls[0][0] as CustomEvent).detail).toEqual({
      identifier: 'expense-1',
      vendor: 'corner-cafe',
    });

    window.removeEventListener('openTransactionDetail', onOpen);
  });

  it('filters the visible ledger and sends text searches to the existing API', async () => {
    render(<ActivityPage />);

    expect(await screen.findByText('Corner Café')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Income'));
    expect(screen.queryByText('Corner Café')).not.toBeInTheDocument();
    expect(screen.getAllByText('Salary').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText('Search merchant, category, note…'), {
      target: { value: 'coffee' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(get).toHaveBeenLastCalledWith('/api/transactions/search', {
        params: { query: 'coffee', limit: 80 },
        cacheMode: 'no-store',
      });
    });
  });

  it('preserves the cash-flow direction of positive investment activity', async () => {
    render(<ActivityPage />);

    const investmentReturn = await screen.findByText('Investment return');
    expect(investmentReturn.closest('li')).toHaveTextContent('+₪10,000');

    fireEvent.click(screen.getByRole('button', { name: 'Investments' }));
    expect(screen.getByText('Investment return')).toBeInTheDocument();
    expect(screen.queryByText('Salary')).not.toBeInTheDocument();
    expect(screen.queryByText('Corner Café')).not.toBeInTheDocument();
  });

  it('keeps the newest search result when requests resolve out of order', async () => {
    let resolveInitial!: (value: typeof response) => void;
    const initialRequest = new Promise<typeof response>((resolve) => {
      resolveInitial = resolve;
    });
    const searchResponse = {
      ok: true,
      data: {
        transactions: [{
          identifier: 'search-1',
          vendor: 'coffee-shop',
          name: 'Newest coffee result',
          category_type: 'expense',
          price: -17,
          date: '2026-09-01T08:00:00.000Z',
        }],
      },
    };
    get.mockReset();
    get.mockReturnValueOnce(initialRequest).mockResolvedValueOnce(searchResponse);

    render(<ActivityPage />);
    fireEvent.change(screen.getByPlaceholderText('Search merchant, category, note…'), {
      target: { value: 'coffee' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Newest coffee result')).toBeInTheDocument();

    await act(async () => {
      resolveInitial(response);
      await initialRequest;
    });

    expect(screen.getByText('Newest coffee result')).toBeInTheDocument();
    expect(screen.queryByText('Salary')).not.toBeInTheDocument();
  });

  it('blocks direct navigation before the first account sync', async () => {
    onboarding.status = {
      ...onboarding.status,
      isComplete: false,
      completedSteps: {
        ...onboarding.status.completedSteps,
        firstScrape: false,
      },
    };
    onboarding.getPageAccessStatus.mockReturnValue({
      isLocked: true,
      requiredStep: 'firstScrape',
      reason: 'Complete your first transaction scrape to unlock this page',
    });

    render(<ActivityPage />);

    expect(await screen.findByText('Activity ledger')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
