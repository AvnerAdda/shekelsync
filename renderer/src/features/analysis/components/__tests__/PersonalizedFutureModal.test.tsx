import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import translations from '../../../../i18n/locales/en.json';
import PersonalizedFutureModal from '../PersonalizedFutureModal';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const t = (key: string, options?: Record<string, string>) => {
  let value: any = translations.analysisPage.modals.future;
  for (const part of key.split('.')) value = value?.[part];
  return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name) => options?.[name] ?? name);
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('@renderer/lib/api-client', () => ({ apiClient: { get } }));
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
  incomeDrivers: [{ source: 'Deloitte payroll', amount: 100, nextDate: '2026-10-07', expectedPaymentDate: '2026-10-06', awaitingReceipt: true }],
});
const show = (open = true) => render(<MemoryRouter><PersonalizedFutureModal open={open} onClose={vi.fn()} /></MemoryRouter>);
beforeEach(() => { get.mockReset().mockResolvedValue({ ok: true, data: payload() }); });

describe('cash-flow outlook', () => {
  it('shows closing balances, cash-flow changes, assumptions and the server horizon consistently', async () => {
    show();
    expect(await screen.findByTestId('forecast-closing-base')).toHaveTextContent('ILS 1020');
    expect(screen.getByTestId('forecast-closing-pessimistic')).toHaveTextContent('ILS 940');
    expect(screen.getByTestId('forecast-closing-optimistic')).toHaveTextContent('ILS 1090');
    expect(screen.getByText('Projected change: ILS 20')).toBeVisible();
    expect(screen.getByText('Through Apr 1, 2027')).toBeVisible();
    expect(screen.getByText('Allowance for occasional costs')).toBeVisible();
    expect(screen.getByText('Deloitte payroll')).toBeVisible();
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

  it('provides a retry after a failed request', async () => {
    get.mockRejectedValueOnce(new Error('Connection unavailable'));
    show();
    expect(await screen.findByText('Connection unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('forecast-closing-base')).toHaveTextContent('ILS 1020');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
