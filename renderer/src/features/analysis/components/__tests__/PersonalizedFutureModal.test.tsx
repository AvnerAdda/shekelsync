import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format, subMonths } from 'date-fns';
import translations from '../../../../i18n/locales/en.json';
import PersonalizedFutureModal from '../PersonalizedFutureModal';

const { get, overlayGet } = vi.hoisted(() => ({ get: vi.fn(), overlayGet: vi.fn() }));
const t = (key: string, options?: Record<string, string>) => {
  let value: any = translations.analysisPage.modals.future;
  for (const part of key.split('.')) value = value?.[part];
  return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name) => options?.[name] ?? name);
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: {
  get: (url: string, options?: unknown) => (url === '/api/planning/forecast-overlay' ? overlayGet(url, options) : get(url, options)),
} }));
vi.mock('@app/contexts/FinancePrivacyContext', () => ({ useFinancePrivacy: () => ({ formatCurrency: (value: number) => `ILS ${value}` }) }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  ComposedChart: ({ children, data }: any) => <div data-testid="chart" data-chart-data={JSON.stringify(data)}>{children}</div>,
  Area: ({ dataKey }: any) => <div data-testid="range" data-key={dataKey} />,
  Line: ({ dataKey }: any) => <div data-testid="line" data-key={dataKey} />,
  XAxis: () => null, YAxis: () => null, CartesianGrid: () => null,
  Tooltip: () => null, Legend: () => null, ReferenceLine: () => null,
}));
const payload = () => ({
  hasCurrentBalance: true, startingBalance: 1000, forecastPeriod: { end: '2027-04-01' },
  combinedData: [
    { date: '2026-10-01', historicalCumulative: 1000, expectedCumulative: 1000, p10Cumulative: 1000, p90Cumulative: 1000 },
    { date: '2027-04-01', historicalCumulative: null, expectedCumulative: 1020, p10Cumulative: 940, p90Cumulative: 1090 },
  ],
  summaries: { base: { income: 100, expenses: 80, netCashFlow: 20, endingBalance: 1020 }, pessimistic: { netCashFlow: -60, endingBalance: 940 }, optimistic: { netCashFlow: 90, endingBalance: 1090 } },
  expenseDrivers: [{ categoryDefinitionId: 2, category: 'Repairs', categoryNameEn: 'Repairs', amount: 80, scheduled: 0, typical: 0, occasional: 80 }],
  incomeDrivers: [{ source: 'Example Employer payroll', amount: 100, nextDate: '2026-10-07', expectedPaymentDate: '2026-10-06', awaitingReceipt: true }],
});
const overlayPayload = (overrides: Record<string, unknown> = {}) => ({
  as_of_date: '2026-10-01', status: 'ready', spending_period_end: '2026-10-10',
  available_spend: 400, available_spend_baseline: 400, shortfall: 0, cash_buffer: 200, reserved_cash: 300,
  include_goals: true, starting_floor: 500, goals: [], scenarios: [], daily: [], ...overrides,
});
const plannedOverlay = (options: any) => {
  const withCar = String(options?.params?.scenario_ids || '').split(',').includes('7');
  const goals = options?.params?.goals !== '0';
  return { ok: true, data: overlayPayload({
    available_spend: withCar ? 100 : 400,
    goals: [{ id: 3, name: 'Holiday', reserve_location: 'external', monthly_contribution: 100, remaining_amount: 1000 }],
    scenarios: [{ id: 7, name: 'New car', selected: withCar }],
    daily: [
      { date: '2026-12-01', scenario_change: withCar ? -300 : 0, external_contributions: 0, reserved_floor: 500 },
      { date: '2027-01-01', scenario_change: 0, external_contributions: goals ? 100 : 0, reserved_floor: 600 },
    ],
  }) };
};
const show = (open = true) => render(<MemoryRouter><PersonalizedFutureModal open={open} onClose={vi.fn()} /></MemoryRouter>);
beforeEach(() => {
  get.mockReset().mockResolvedValue({ ok: true, data: payload() });
  overlayGet.mockReset().mockResolvedValue({ ok: true, data: overlayPayload() });
  try { localStorage.removeItem('shekelsync.cashFlowOutlook.plans'); } catch { /* unavailable */ }
});

describe('cash-flow outlook', () => {
  it('shows closing balances, cash-flow changes, assumptions and the server horizon consistently', async () => {
    show();
    expect(await screen.findByTestId('forecast-closing-base')).toHaveTextContent('ILS 1020');
    expect(screen.getByTestId('forecast-closing-pessimistic')).toHaveTextContent('ILS 940');
    expect(screen.getByTestId('forecast-closing-optimistic')).toHaveTextContent('ILS 1090');
    expect(screen.getByText('Projected change: ILS 20')).toBeVisible();
    expect(screen.getByText('Through Apr 1, 2027')).toBeVisible();
    expect(screen.getByText('Allowance for occasional costs')).toBeVisible();
    expect(screen.getByText('Example Employer payroll')).toBeVisible();
    expect(screen.getByText('Awaiting receipt · Oct 6')).toBeVisible();
    expect(screen.getByText(/not money already received/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review assumptions' })).toHaveAttribute('href', '/review');
    const rows = JSON.parse(screen.getByTestId('chart').getAttribute('data-chart-data')!);
    expect(rows.at(-1).forecastRange).toEqual([940, 1090]);
    expect(rows.at(-1).expectedCumulative).toBe(1020);
    expect(screen.queryByText(/only 10%|most likely|experimental/i)).not.toBeInTheDocument();
  });

  it('refreshes both API caches when requested or saved assumptions change', async () => {
    show();
    await screen.findByTestId('forecast-closing-base');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh outlook' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith('/api/analytics/forecast-extended', { params: { noCache: 'true' }, cacheMode: 'reload' });
    await screen.findByTestId('forecast-closing-base');
    act(() => window.dispatchEvent(new Event('financialTruthChanged')));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(get).toHaveBeenLastCalledWith('/api/analytics/forecast-extended', { params: { noCache: 'true' }, cacheMode: 'reload' });
  });

  it('prevents an older response from replacing an updated correction', async () => {
    let resolveOld!: (value: any) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const updated = payload(); updated.summaries.base.endingBalance = 1500;
    get.mockResolvedValueOnce({ ok: true, data: updated });
    show();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event('financialTruthChanged')));
    expect(await screen.findByTestId('forecast-closing-base')).toHaveTextContent('ILS 1500');
    await act(async () => resolveOld({ ok: true, data: payload() }));
    expect(screen.getByTestId('forecast-closing-base')).toHaveTextContent('ILS 1500');
  });

  it('does not fabricate balances or intervals when data is missing', async () => {
    const input: any = payload(); input.hasCurrentBalance = false;
    input.combinedData[1].p10Cumulative = null; input.combinedData[1].p90Cumulative = null;
    input.summaries.pessimistic = { endingBalance: null, netCashFlow: null };
    get.mockResolvedValue({ ok: true, data: input });
    show();
    expect(await screen.findByTestId('forecast-closing-pessimistic')).toHaveTextContent('Not available');
    expect(screen.getByTestId('forecast-closing-base')).toHaveTextContent('ILS 20');
    expect(screen.getByText(/No current bank balance/)).toBeVisible();
    expect(screen.queryByTestId('range')).not.toBeInTheDocument();
  });

  it.each([
    ['incomplete', /Some bank accounts are missing a balance or currency/],
    ['missing_exchange_rate', /A current exchange rate is missing/],
  ])('explains why the starting balance is unavailable (%s)', async (balanceStatus, warning) => {
    get.mockResolvedValue({ ok: true, data: { ...payload(), hasCurrentBalance: false, balanceStatus } });
    show();
    expect(await screen.findByText(warning)).toBeVisible();
    expect(screen.getByTestId('forecast-closing-base')).toHaveTextContent('ILS 20');
    expect(screen.getByText(`${t('startingPosition')}:`)).toHaveTextContent('Not available');
  });

  it('switches the chart and scenarios between after- and before-investing views', async () => {
    const after = payload();
    after.summaries.base.endingBalance = 970;
    after.combinedData[1].expectedCumulative = 970;
    const before = payload();
    get.mockResolvedValue({ ok: true, data: { ...after, hasInvestments: true, investmentBases: {
      after: { combinedData: after.combinedData, summaries: after.summaries },
      before: { combinedData: before.combinedData, summaries: before.summaries },
    } } });
    show();
    expect(await screen.findByTestId('forecast-closing-base')).toHaveTextContent('ILS 970');
    const basis = screen.getByRole('group', { name: 'Investments' });
    expect(screen.getByRole('button', { name: 'After investing' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(screen.getByTestId('chart').getAttribute('data-chart-data')!).at(-1).expectedCumulative).toBe(970);

    fireEvent.click(screen.getByRole('button', { name: 'Before investing' }));
    expect(screen.getByTestId('forecast-closing-base')).toHaveTextContent('ILS 1020');
    expect(JSON.parse(screen.getByTestId('chart').getAttribute('data-chart-data')!).at(-1).expectedCumulative).toBe(1020);
    expect(basis).toBeVisible();
  });

  it('shows the last three months of history by default, with 6 months and whole history on request', async () => {
    const monthsAgo = (months: number) => format(subMonths(new Date(), months), 'yyyy-MM-dd');
    const input: any = payload();
    input.combinedData = [
      { date: monthsAgo(8), historicalCumulative: 700, expectedCumulative: null },
      { date: monthsAgo(5), historicalCumulative: 800, expectedCumulative: null },
      { date: monthsAgo(1), historicalCumulative: 900, expectedCumulative: null },
      { ...input.combinedData[0], date: monthsAgo(0) },
      input.combinedData[1],
    ];
    get.mockResolvedValue({ ok: true, data: input });
    show();
    await screen.findByTestId('forecast-closing-base');
    const historyValues = () => JSON.parse(screen.getByTestId('chart').getAttribute('data-chart-data')!)
      .map((day: any) => day.historicalCumulative).filter((value: any) => value !== null);
    expect(screen.getByRole('button', { name: '3M' })).toHaveAttribute('aria-pressed', 'true');
    expect(historyValues()).toEqual([900, 1000]);
    fireEvent.click(screen.getByRole('button', { name: '6M' }));
    expect(historyValues()).toEqual([800, 900, 1000]);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(historyValues()).toEqual([700, 800, 900, 1000]);
    // Forecast rows are never trimmed.
    expect(JSON.parse(screen.getByTestId('chart').getAttribute('data-chart-data')!).at(-1).expectedCumulative).toBe(1020);
  });

  it('omits the investment switch without investment activity', async () => {
    show();
    await screen.findByTestId('forecast-closing-base');
    expect(screen.queryByRole('group', { name: 'Investments' })).not.toBeInTheDocument();
  });

  it('adds a "with my plans" line, the reserved floor and Available to spend', async () => {
    overlayGet.mockImplementation((_url: string, options: any) => Promise.resolve(plannedOverlay(options)));
    show();
    expect(await screen.findByTestId('plans-closing')).toHaveTextContent('ILS 920');
    const rows = () => JSON.parse(screen.getByTestId('chart').getAttribute('data-chart-data')!);
    expect(rows().at(-1)).toMatchObject({ expectedCumulative: 1020, plannedCumulative: 920, reservedFloor: 600 });
    expect(rows()[0]).toMatchObject({ plannedCumulative: 1000, reservedFloor: 500 });
    expect(screen.getAllByTestId('line').map(line => line.getAttribute('data-key'))).toEqual(
      expect.arrayContaining(['plannedCumulative', 'reservedFloor']));
    expect(screen.getByText('ILS -100 vs expected')).toBeVisible();
    expect(screen.getByTestId('plans-available')).toHaveTextContent('ILS 400 until Oct 10');
    expect(overlayGet).toHaveBeenLastCalledWith('/api/planning/forecast-overlay', expect.objectContaining({
      params: expect.objectContaining({ goals: '1' }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Plans (1)' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New car' }));
    await waitFor(() => expect(screen.getByTestId('plans-closing')).toHaveTextContent('ILS 620'));
    expect(overlayGet).toHaveBeenLastCalledWith('/api/planning/forecast-overlay', expect.objectContaining({
      params: expect.objectContaining({ scenario_ids: '7' }),
    }));
    expect(screen.getByText('ILS -300 with selected scenarios')).toBeVisible();
    // Plans never change the plain forecast.
    expect(screen.getByTestId('forecast-closing-base')).toHaveTextContent('ILS 1020');
  });

  it('warns when the plans dip into reserved money and refetches after plan edits', async () => {
    overlayGet.mockImplementation((_url: string, options: any) => Promise.resolve({
      ...plannedOverlay(options), data: { ...plannedOverlay(options).data, starting_floor: 900,
        daily: plannedOverlay(options).data.daily.map((day: any) => ({ ...day, reserved_floor: 950 })) },
    }));
    show();
    expect(await screen.findByText('Your plans dip into reserved money on Apr 1, 2027.')).toBeVisible();
    const calls = overlayGet.mock.calls.length;
    act(() => window.dispatchEvent(new Event('planningChanged')));
    await waitFor(() => expect(overlayGet.mock.calls.length).toBe(calls + 1));
  });

  it('keeps the chart unchanged without goals or scenarios', async () => {
    show();
    await screen.findByTestId('outlook-plans');
    expect(screen.getByText(/Add savings goals or What if\? scenarios/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Plans/ })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('line').map(line => line.getAttribute('data-key'))).not.toContain('plannedCumulative');
    expect(screen.getByTestId('plans-available')).toHaveTextContent('ILS 400');
  });

  it('provides a retry after a failed request', async () => {
    get.mockRejectedValueOnce(new Error('Connection unavailable'));
    show();
    expect(await screen.findByText('Connection unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('forecast-closing-base')).toHaveTextContent('ILS 1020');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
