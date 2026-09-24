import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestmentBalanceSheetResponse, InvestmentLiability, PortfolioSummary } from '@renderer/types/investments';
import type { HistoryTimeRangeOption, PortfolioChartScopeOption } from '../../InvestmentsFiltersContext';
import InvestmentsPage from '../InvestmentsPage';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  refreshBalanceSheet: vi.fn(async () => undefined),
  setIsRefreshing: vi.fn(),
  balanceSheetData: null as InvestmentBalanceSheetResponse | null,
  historyTimeRange: '1m' as HistoryTimeRangeOption,
  chartScope: 'exclude_real_estate' as PortfolioChartScopeOption,
  refreshTrigger: 0,
  shouldBlockPageData: false,
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: mocks.get,
  },
}));

vi.mock('@app/contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    getPageAccessStatus: vi.fn(),
    status: 'complete',
  }),
}));

vi.mock('@renderer/features/layout/components/onboarding-gate', () => ({
  resolveOnboardingGate: () => ({
    isLocked: false,
    isResolved: true,
    shouldBlockPageData: mocks.shouldBlockPageData,
    showLoading: false,
  }),
}));

vi.mock('../../InvestmentsFiltersContext', () => ({
  InvestmentsFiltersProvider: ({ children }: { children: React.ReactNode }) => children,
  useInvestmentsFilters: () => ({
    historyTimeRange: mocks.historyTimeRange,
    setHistoryTimeRange: vi.fn(),
    chartScope: mocks.chartScope,
    setChartScope: vi.fn(),
    refreshTrigger: mocks.refreshTrigger,
    isRefreshing: false,
    setIsRefreshing: mocks.setIsRefreshing,
  }),
}));

vi.mock('../../hooks/useBalanceSheet', () => ({
  useInvestmentBalanceSheet: () => ({
    data: mocks.balanceSheetData,
    loading: false,
    error: null,
    refresh: mocks.refreshBalanceSheet,
  }),
}));

vi.mock('../../components/PortfolioValuePanel', () => ({
  default: ({ portfolioData }: { portfolioData: PortfolioSummary }) => (
    <div data-testid="portfolio-value">{portfolioData.summary.totalPortfolioValue}</div>
  ),
}));
vi.mock('../../components/AllocationDonutChart', () => ({ default: () => <div /> }));
vi.mock('../../components/PerformanceCardsSection', () => ({ default: () => <div /> }));
vi.mock('../../components/BalanceSheetSection', () => ({ default: () => <div /> }));
vi.mock('../../components/LiabilitiesManager', () => ({
  default: ({ onChanged }: { onChanged: () => Promise<void> }) => <button onClick={() => void onChanged()}>Save a liability</button>,
}));
vi.mock('../../components/DebtRepaymentPlanner', () => ({
  default: ({ liabilities }: { liabilities?: InvestmentLiability[] }) => <div data-testid="debt-planner">{liabilities?.map((debt) => debt.liability_name).join(', ')}</div>,
}));
vi.mock('../../components/PortfolioHistorySection', () => ({ default: () => <div /> }));
vi.mock('../../components/PortfolioBreakdownSection', () => ({ default: () => <div /> }));
vi.mock('../../components/PerformanceBreakdownPanel', () => ({ default: () => <div /> }));
vi.mock('../../components/PortfolioCoveragePanel', () => ({
  default: ({
    onManageAccounts,
  }: {
    onManageAccounts?: (itemId: string, accountId?: number) => void;
  }) => (
    <div>
      <button onClick={() => onManageAccounts?.('missingValuations', 1)}>Review missing valuation</button>
      <button onClick={() => onManageAccounts?.('missingCurrency', 1)}>Review missing currency</button>
      <button onClick={() => onManageAccounts?.('unlinkedTransactions')}>Review unlinked transactions</button>
    </div>
  ),
}));
vi.mock('../../components/HoldingsPositionsSection', () => ({ default: () => <div /> }));
vi.mock('../../components/PikadonAccountDetailsDialog', () => ({ default: () => null }));
vi.mock('../../components/RealEstateSimulatorDialog', () => ({ default: () => null }));
vi.mock('../../components/RealEstateOverviewSection', () => ({ default: () => <div /> }));
vi.mock('../../components/AllocationTargetsPanel', () => ({
  default: ({ baseCurrency }: { baseCurrency?: string }) => (
    <div data-testid="allocation-target-currency">{baseCurrency}</div>
  ),
}));
vi.mock('../../components/BenchmarkComparisonPanel', () => ({ default: () => <div /> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: string | Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'header.title': 'Investments Dashboard',
        'header.subtitle': 'Portfolio',
        'errors.retry': 'Retry',
        'errors.loadFailed': 'Could not load {{resource}}.',
        'errors.showingPrevious': 'Could not refresh {{resource}}. Showing previously loaded data.',
        'errors.resources.portfolio': 'the portfolio',
      };
      const fallback = typeof values === 'string' ? values : undefined;
      let result = translations[key] || fallback || key;
      if (values && typeof values === 'object') {
        Object.entries(values).forEach(([name, value]) => {
          result = result.replace(`{{${name}}}`, String(value));
        });
      }
      return result;
    },
  }),
}));

function makePortfolio(): PortfolioSummary {
  const account = {
    id: 1,
    account_name: 'Brokerage',
    account_type: 'brokerage',
    investment_category: 'liquid' as const,
    currency: 'ILS',
    current_value: 1_000,
    cost_basis: 900,
    as_of_date: '2026-08-12',
  };

  return {
    summary: {
      totalPortfolioValue: 1_000,
      totalCostBasis: 900,
      unrealizedGainLoss: 100,
      roi: 11.1,
      totalAccounts: 1,
      accountsWithValues: 1,
      newestUpdateDate: '2026-08-12',
      liquid: { totalValue: 1_000, totalCost: 900, unrealizedGainLoss: 100, roi: 11.1, accountsCount: 1 },
      illiquid: { totalValue: 0, totalCost: 0, unrealizedGainLoss: 0, roi: 0, accountsCount: 0 },
      restricted: { totalValue: 0, totalCost: 0, unrealizedGainLoss: 0, roi: 0, accountsCount: 0 },
    },
    categoryBuckets: {} as PortfolioSummary['categoryBuckets'],
    breakdown: [],
    timeline: [],
    accounts: [account],
    liquidAccounts: [account],
    illiquidAccounts: [],
    restrictedAccounts: [],
    fx: {
      baseCurrency: 'USD',
      complete: true,
      valuationComplete: true,
      costBasisComplete: true,
      missingCount: 0,
      nativeTotals: [],
      convertedSubtotal: 1_000,
    },
  };
}

function successfulResponseFor(url: string) {
  if (url.startsWith('/api/investments/summary')) return { ok: true, data: makePortfolio() };
  if (url.startsWith('/api/investments/history')) return { ok: true, data: { history: [], accounts: [] } };
  if (url.startsWith('/api/investments/performance')) return { ok: true, data: null };
  if (url === '/api/investments/positions') return { ok: true, data: { positions: [] } };
  if (url === '/api/analytics/investments') {
    return { ok: true, data: { summary: {}, byCategory: [], timeline: [], transactions: [] } };
  }
  return { ok: true, data: {} };
}

function callsFor(path: string): string[] {
  return mocks.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.split('?')[0] === path);
}

const PAGE_RESOURCES = [
  '/api/investments/summary',
  '/api/investments/history',
  '/api/investments/performance',
  '/api/investments/positions',
  '/api/analytics/investments',
  '/api/investments/coverage',
];

describe('InvestmentsPage loading resilience', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.get.mockReset();
    mocks.refreshBalanceSheet.mockClear();
    mocks.setIsRefreshing.mockClear();
    mocks.balanceSheetData = null;
    mocks.historyTimeRange = '1m';
    mocks.chartScope = 'exclude_real_estate';
    mocks.refreshTrigger = 0;
    mocks.shouldBlockPageData = false;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('waits for the portfolio before chart requests and loads each resource once', async () => {
    const summary = Promise.withResolvers<ReturnType<typeof successfulResponseFor>>();
    mocks.get.mockImplementation((url: string) => url.startsWith('/api/investments/summary')
      ? summary.promise
      : Promise.resolve(successfulResponseFor(url)));

    render(<InvestmentsPage />);
    await waitFor(() => expect(callsFor('/api/investments/coverage')).toHaveLength(1));
    expect(callsFor('/api/investments/history')).toHaveLength(0);
    expect(callsFor('/api/investments/performance')).toHaveLength(0);

    await act(async () => summary.resolve(successfulResponseFor('/api/investments/summary')));

    for (const path of PAGE_RESOURCES) expect(callsFor(path)).toHaveLength(1);
    const performanceUrl = new URL(callsFor('/api/investments/performance')[0], 'http://localhost');
    expect(performanceUrl.searchParams.getAll('accountIds')).toEqual(['1']);
  });

  it('only reloads date-dependent data when the chart range changes', async () => {
    mocks.get.mockImplementation(async (url: string) => successfulResponseFor(url));
    const { rerender } = render(<InvestmentsPage />);
    await screen.findByTestId('portfolio-value');
    mocks.get.mockClear();

    mocks.historyTimeRange = '1y';
    await act(async () => rerender(<InvestmentsPage />));

    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(callsFor('/api/analytics/investments')).toHaveLength(1);
    expect(callsFor('/api/investments/history')).toHaveLength(1);
    expect(callsFor('/api/investments/performance')).toHaveLength(1);
    expect(new URL(callsFor('/api/investments/history')[0], 'http://localhost')
      .searchParams.get('timeRange')).toBe('1y');
  });

  it('only reloads the portfolio charts when the chart scope changes', async () => {
    mocks.get.mockImplementation(async (url: string) => successfulResponseFor(url));
    const { rerender } = render(<InvestmentsPage />);
    await screen.findByTestId('portfolio-value');
    mocks.get.mockClear();

    mocks.chartScope = 'liquid';
    await act(async () => rerender(<InvestmentsPage />));

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(callsFor('/api/investments/history')).toHaveLength(1);
    expect(callsFor('/api/investments/performance')).toHaveLength(1);
    expect(new URL(callsFor('/api/investments/performance')[0], 'http://localhost')
      .searchParams.get('assetScope')).toBe('liquid');
  });

  it('refreshes every resource once and waits for the chart requests to finish', async () => {
    mocks.get.mockImplementation(async (url: string) => successfulResponseFor(url));
    render(<InvestmentsPage />);
    await screen.findByTestId('portfolio-value');
    mocks.get.mockClear();
    const history = Promise.withResolvers<ReturnType<typeof successfulResponseFor>>();
    const refreshedPortfolio = makePortfolio();
    refreshedPortfolio.accounts[0].id = 2;
    mocks.get.mockImplementation((url: string) => {
      if (url.startsWith('/api/investments/history')) return history.promise;
      if (url.startsWith('/api/investments/summary')) return Promise.resolve({ ok: true, data: refreshedPortfolio });
      return Promise.resolve(successfulResponseFor(url));
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('dataRefresh'));
    });

    for (const path of PAGE_RESOURCES) expect(callsFor(path)).toHaveLength(1);
    for (const path of ['/api/investments/history', '/api/investments/performance']) {
      expect(new URL(callsFor(path)[0], 'http://localhost').searchParams.getAll('accountIds')).toEqual(['2']);
    }
    expect(mocks.refreshBalanceSheet).toHaveBeenCalledTimes(1);
    expect(mocks.setIsRefreshing).toHaveBeenLastCalledWith(true);

    await act(async () => history.resolve(successfulResponseFor('/api/investments/history')));
    expect(mocks.setIsRefreshing).toHaveBeenLastCalledWith(false);
    for (const path of PAGE_RESOURCES) expect(callsFor(path)).toHaveLength(1);
  });

  it('refreshes each page resource once when the shared refresh trigger changes', async () => {
    mocks.get.mockImplementation(async (url: string) => successfulResponseFor(url));
    const { rerender } = render(<InvestmentsPage />);
    await screen.findByTestId('portfolio-value');
    mocks.get.mockClear();

    mocks.refreshTrigger += 1;
    await act(async () => rerender(<InvestmentsPage />));

    for (const path of PAGE_RESOURCES) expect(callsFor(path)).toHaveLength(1);
  });

  it('does not fetch page resources while onboarding blocks data access', async () => {
    mocks.shouldBlockPageData = true;
    mocks.get.mockImplementation(async (url: string) => successfulResponseFor(url));
    render(<InvestmentsPage />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('dataRefresh'));
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('shows a load error instead of portfolio setup and retries successfully', async () => {
    let summaryFails = true;
    mocks.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/investments/summary') && summaryFails) {
        return { ok: false, statusText: 'Offline' };
      }
      return successfulResponseFor(url);
    });

    render(<InvestmentsPage />);

    expect(await screen.findByText('Could not load the portfolio.')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/api/investments/summary?normalizeCurrencies=true');
    summaryFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('portfolio-value')).toHaveTextContent('1000');
  }, 15_000);

  it('keeps the last portfolio visible when a refresh fails', async () => {
    let summaryCalls = 0;
    mocks.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/investments/summary')) {
        summaryCalls += 1;
        if (summaryCalls > 1) return { ok: false, statusText: 'Offline' };
      }
      return successfulResponseFor(url);
    });

    render(<InvestmentsPage />);
    expect(await screen.findByTestId('portfolio-value')).toHaveTextContent('1000');

    act(() => {
      window.dispatchEvent(new CustomEvent('dataRefresh'));
    });

    await waitFor(() => {
      expect(screen.getByText(
        'Could not refresh the portfolio. Showing previously loaded data.',
      )).toBeInTheDocument();
    });
    expect(screen.getByTestId('portfolio-value')).toHaveTextContent('1000');
    for (const path of PAGE_RESOURCES) expect(callsFor(path)).toHaveLength(2);
  });

  it('fetches live coverage and maps its review actions to the account workflows', async () => {
    mocks.get.mockImplementation(async (url: string) => successfulResponseFor(url));
    const openAccounts = vi.fn();
    window.addEventListener('openAccountsModal', openAccounts);

    render(<InvestmentsPage />);

    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith(
        '/api/investments/coverage?thresholdDays=90',
        { cacheMode: 'no-store' },
      );
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Performance Analytics' }));
    expect(screen.getByTestId('allocation-target-currency')).toHaveTextContent('USD');
    fireEvent.click(screen.getByRole('button', { name: 'Review missing valuation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review missing currency' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review unlinked transactions' }));

    expect(openAccounts).toHaveBeenNthCalledWith(1, expect.objectContaining({
      detail: expect.objectContaining({ tab: 'investments', valuationAccountId: 1 }),
    }));
    expect(openAccounts).toHaveBeenNthCalledWith(2, expect.objectContaining({
      detail: expect.objectContaining({ tab: 'investments', editInvestmentAccountId: 1 }),
    }));
    expect(openAccounts).toHaveBeenNthCalledWith(3, expect.objectContaining({
      detail: expect.objectContaining({ tab: 'investments' }),
    }));

    window.removeEventListener('openAccountsModal', openAccounts);
  });

  it('offers debt planning even when a user has no investment accounts', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/investments/summary')) {
        const portfolio = makePortfolio();
        return { ok: true, data: { ...portfolio, summary: { ...portfolio.summary, totalAccounts: 0 } } };
      }
      return successfulResponseFor(url);
    });
    render(<InvestmentsPage />);
    expect(await screen.findByTestId('debt-planner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save a liability' }));
    await waitFor(() => expect(mocks.refreshBalanceSheet).toHaveBeenCalled());
  });
});
