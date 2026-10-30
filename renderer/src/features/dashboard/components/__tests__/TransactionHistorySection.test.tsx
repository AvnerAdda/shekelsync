import React from 'react';
import { alpha, createTheme, ThemeProvider } from '@mui/material/styles';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionHistorySection from '../TransactionHistorySection';
import { getLogScaleData } from '../transaction-history-axis';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../DashboardFiltersContext', () => ({
  useDashboardFilters: () => ({
    aggregationPeriod: rollingResult.aggregation,
    setAggregationPeriod: vi.fn(),
    startDate: new Date(2026, 8, 1),
    endDate: new Date(2026, 8, 3),
    periodPreset: 'mtd',
  }),
}));

vi.mock('recharts', async () => {
  const { createContext, useContext } = await import('react');
  type ChartRow = Record<string, unknown>;
  const ChartDataContext = createContext<ChartRow[]>([]);

  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ComposedChart: ({ children, data }: { children: React.ReactNode; data: ChartRow[] }) => (
      <ChartDataContext.Provider value={data}>
        <div data-testid="composed-chart" data-chart-data={JSON.stringify(data)}>{children}</div>
      </ChartDataContext.Provider>
    ),
    Bar: ({ dataKey, fill, name, stackId, stroke, strokeDasharray }: {
      dataKey: string; fill: string; name: string; stackId?: string; stroke?: string; strokeDasharray?: string;
    }) => (
      <div
        data-testid="bar-series"
        data-key={dataKey}
        data-color={fill}
        data-name={name}
        data-stack={stackId}
        data-stroke={stroke}
        data-dash={strokeDasharray}
      />
    ),
    Area: ({ dataKey, stroke, strokeOpacity, fillOpacity, legendType, isAnimationActive }: {
      dataKey: string; stroke?: string; strokeOpacity?: number; fillOpacity?: number;
      legendType?: string; isAnimationActive?: boolean;
    }) => (
      <div data-testid="area-series" data-key={dataKey} data-stroke={stroke}
        data-stroke-opacity={strokeOpacity} data-fill-opacity={fillOpacity}
        data-legend-type={legendType} data-animated={isAnimationActive} />
    ),
    Line: ({ dataKey, stroke, name, strokeDasharray }: {
      dataKey: string; stroke: string; name: string; strokeDasharray?: string;
    }) => (
      <div data-testid="line-series" data-key={dataKey} data-color={stroke} data-name={name} data-dash={strokeDasharray} />
    ),
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: ({ content }: {
      content?: (props: { active: boolean; payload: { payload: ChartRow }[] }) => React.ReactNode;
    }) => {
      const data = useContext(ChartDataContext);
      if (!content) return null;
      return data.map((row) => (
        <div key={String(row.date)} data-testid={`chart-tooltip-${row.date}`}>
          {content({ active: true, payload: [{ payload: row }] })}
        </div>
      ));
    },
    Legend: () => null,
    ReferenceLine: () => null,
    ReferenceArea: () => null,
  };
});

vi.mock('../IncomeExpenseCalendar', () => ({ default: () => null }));
vi.mock('../RollingAllocationPanel', () => ({ default: () => <div>Rolling allocation panel</div> }));
const { rollingResult } = vi.hoisted(() => ({ rollingResult: { history: [] as Record<string, unknown>[], aggregation: 'daily', loading: false, error: false, refresh: vi.fn(), end: '2026-09-03' } }));
vi.mock('../../hooks/useRollingCashflow', () => ({ useRollingCashflow: () => rollingResult }));
vi.mock('@renderer/shared/modals/TransactionDetailModal', () => ({ default: () => null }));
vi.mock('@renderer/features/financial-truth/FinancialCorrectionDialog', () => ({ default: () => null }));

const chartTheme = createTheme({ palette: { info: { main: '#1678d2' } } });
const forecastData = {
  dailyForecasts: [
    { date: '2026-09-04', income: 300, expenses: 100, investments: 10_000, cashFlow: -9_800 },
    { date: '2026-09-05', income: 0, expenses: 75, investments: 0, cashFlow: -75 },
  ],
};

function renderHistory(overrides: Partial<React.ComponentProps<typeof TransactionHistorySection>> = {}) {
  return render(
    <ThemeProvider theme={chartTheme}>
      <TransactionHistorySection
        data={{ history: [] }}
        yAxisScale="linear"
        setYAxisScale={vi.fn()}
        shouldUseLogScale={() => false}
        formatCurrencyValue={(value) => `₪${value}`}
        formatXAxis={(value) => value}
        formatYAxisLog={(value) => String(value)}
        getLogScaleData={getLogScaleData}
        handleChartAreaClick={vi.fn()}
        detectAnomalies={() => []}
        hoveredDate={null}
        setHoveredDate={vi.fn()}
        fetchTransactionsByDate={vi.fn()}
        dateTransactions={[]}
        loadingTransactions={false}
        parseLocalDate={(value) => new Date(`${value}T12:00:00`)}
        formatCurrency={(value) => `₪${value}`}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

function getChartData() {
  return JSON.parse(screen.getByTestId('composed-chart').getAttribute('data-chart-data') || '[]');
}

function getVisibleSegments(row: Record<string, unknown>, stack: string) {
  return screen.getAllByTestId('bar-series')
    .filter((bar) => bar.getAttribute('data-stack') === stack)
    .map((bar) => ({
      bar,
      name: bar.getAttribute('data-name') || '',
      value: Number(row[bar.getAttribute('data-key') || ''] || 0),
    }))
    .filter(({ value }) => value !== 0);
}

function getStackTotal(row: Record<string, unknown>, stack: string) {
  return getVisibleSegments(row, stack).reduce((sum, segment) => sum + segment.value, 0);
}

function formatForecastCurrency(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat('en-IL', { style: 'currency', currency: 'ILS', ...options }).format(value);
}

const splitHistory = [{
  date: '2026-09-03', income: 1000, expenses: 250, investments: 150,
  chartBreakdown: [
    { categoryId: 1, categoryName: 'Salary', vendor: 'discount', income: 1000, expenses: 0, investments: 0 },
    { categoryId: 2, categoryName: 'Groceries', vendor: 'isracard', income: 0, expenses: 60, investments: 0 },
    { categoryId: 2, categoryName: 'Groceries', vendor: 'max', income: 0, expenses: 40, investments: 0 },
    { categoryId: 3, categoryName: 'Transport', vendor: 'isracard', income: 0, expenses: 150, investments: 0 },
    { categoryId: 4, categoryName: 'Funds', vendor: 'discount', income: 0, expenses: 0, investments: 150 },
  ],
}];

describe('TransactionHistorySection income, expense, and investment chart', () => {
  beforeEach(() => {
    rollingResult.history = [];
    rollingResult.aggregation = 'daily';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([false, true])('adds the after-investing line only in Net Position (paired cards: %s)', paired => {
    renderHistory({
      data: { history: [{
        date: '2026-09-03', income: 1500, expenses: 500,
        operatingIncome: 1500, operatingExpenses: 250,
        pairedCardRepayments: paired ? 250 : 0,
      }] },
      forecastData: { dailyForecasts: [
        { date: '2026-09-04', income: 20000, expenses: 12000, cashFlow: 8000, operatingCashFlow: 9000, investments: 5000 },
        { date: '2026-09-05', income: 0, expenses: 0, cashFlow: 0, operatingCashFlow: 0, investments: -2000 },
        { date: '2026-10-04', cashFlow: 99999, investments: 0 },
      ] },
      hoveredDate: '2026-09-04',
    });
    expect(screen.queryByRole('region', { name: '30 day forecast' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Forecast cash summary' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cash remaining after investing')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('line-series').some(line => line.getAttribute('data-key') === 'forecastAfterInvesting')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'tabs.netPosition' }));
    const rows = getChartData();
    const start = paired ? 1250 : 1000;
    const surplus = paired ? 9000 : 8000;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ forecastCumulative: start, forecastAfterInvesting: start });
    expect(rows[1]).toMatchObject({ forecastCumulative: start + surplus, forecastAfterInvesting: start + surplus - 5000 });
    expect(rows[2]).toMatchObject({ forecastCumulative: start + surplus, forecastAfterInvesting: start + surplus - 3000 });
    const lines = screen.getAllByTestId('line-series');
    expect(lines.find(line => line.getAttribute('data-key') === 'forecastAfterInvesting'))
      .toHaveAttribute('data-name', 'Forecast after investing');
    expect(lines.find(line => line.getAttribute('data-key') === 'forecastCumulative'))
      .toHaveAttribute('data-name', 'Forecast before investing');
    fireEvent.click(screen.getByRole('button', { name: 'tabs.history' }));
    expect(screen.queryAllByTestId('line-series').some(line => line.getAttribute('data-key') === 'forecastAfterInvesting')).toBe(false);
  });

  it('stops the cumulative investment line at missing investment data', () => {
    renderHistory({ data: { history: [{ date: '2026-09-03', income: 1000, expenses: 200 }] },
      forecastData: { dailyForecasts: [
        { date: '2026-09-04', cashFlow: 0, investments: 0 },
        { date: '2026-09-05', cashFlow: 0, investments: 1200 },
        { date: '2026-09-06', cashFlow: 100 },
        { date: '2026-09-07', cashFlow: 100, investments: -300 },
      ] } });
    fireEvent.click(screen.getByRole('button', { name: 'tabs.netPosition' }));
    const rows = getChartData();
    expect(rows.map((row: any) => row.forecastAfterInvesting)).toEqual([800, 800, -400, undefined, undefined]);
    expect(rows.map((row: any) => row.forecastCumulative)).toEqual([800, 800, 800, 900, 1000]);
  });

  it.each([false, true])('uses cumulative quantiles and shades their actual range (operating: %s)', operating => {
    renderHistory({
      data: { history: [{ date: '2026-09-03', income: 1000, expenses: 250, operatingIncome: 1000,
        operatingExpenses: 200, pairedCardRepayments: operating ? 50 : 0 }] },
      forecastData: {
        dailyForecasts: [{ date: '2026-09-04', cashFlow: -100, operatingCashFlow: -80 }],
        predictionIntervals: { level: 0.8, daily: [{ date: '2026-09-04',
          cumulativeCashFlow: { p10: -300, p50: -80, p90: 200 },
          cumulativeOperatingCashFlow: { p10: -200, p50: -60, p90: 250 },
        }] },
        scenarios: { p10: { daily: [{ date: '2026-09-04', cashFlow: 9999 }] } },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'tabs.netPosition' }));
    const start = operating ? 800 : 750;
    expect(getChartData()[0].forecastRange).toEqual([start, start]);
    expect(getChartData()[1]).toMatchObject(operating
      ? { p10Cumulative: 600, p50Cumulative: 740, p90Cumulative: 1050, forecastRange: [600, 1050] }
      : { p10Cumulative: 450, p50Cumulative: 670, p90Cumulative: 950, forecastRange: [450, 950] });
    const area = screen.getAllByTestId('area-series').find(area => area.getAttribute('data-key') === 'forecastRange')!;
    expect(area).toBeTruthy();
    expect(area).not.toHaveAttribute('data-stroke', 'transparent');
    expect(area).toHaveAttribute('data-stroke-opacity', '0');
    expect(area).toHaveAttribute('data-fill-opacity', '0.16');
    expect(area).toHaveAttribute('data-legend-type', 'rect');
    expect(area).toHaveAttribute('data-animated', 'false');
  });

  it('does not imply an uncertainty band for legacy scenario-only responses', () => {
    renderHistory({ data: { history: [{ date: '2026-09-03', income: 1000, expenses: 200 }] }, forecastData });
    fireEvent.click(screen.getByRole('button', { name: 'tabs.netPosition' }));
    expect(getChartData().some((row: any) => row.forecastRange)).toBe(false);
    expect(screen.getAllByTestId('area-series').some(area => area.getAttribute('data-key') === 'forecastRange')).toBe(false);
  });

  it('distinguishes everyday spending from scheduled and inferred payments', () => {
    renderHistory({ data: { history: [{ date: '2026-09-03', income: 1, expenses: 0 }] },
      forecastData: { dailyForecasts: [{ date: '2026-09-04', expenses: 50, income: 1000,
        predictions: [
          { category: 'Groceries', categoryType: 'expense', timingBasis: 'daily_average', amount: 200, probability: 0.25, probabilityWeightedAmount: 50 },
          { category: 'Salary', categoryType: 'income', timingBasis: 'scheduled', amount: 1000, probability: 1, probabilityWeightedAmount: 1000 },
        ],
      }] }, hoveredDate: '2026-09-04', formatCurrency: formatForecastCurrency,
    });
    expect(screen.getByText('Typical daily spending')).toBeInTheDocument();
    expect(screen.getByText('Scheduled payment')).toBeInTheDocument();
    expect(screen.getByText('Daily estimate: ₪50.00')).toBeInTheDocument();
    expect(screen.queryByText('100% probability')).not.toBeInTheDocument();
  });

  it('omits the additional line when investment forecasts are unavailable', () => {
    renderHistory({ data: { history: [{ date: '2026-09-03', income: 1000, expenses: 200 }] },
      forecastData: { dailyForecasts: [{ date: '2026-09-04', cashFlow: 100 }] } });
    fireEvent.click(screen.getByRole('button', { name: 'tabs.netPosition' }));
    expect(screen.getAllByTestId('line-series').some(line => line.getAttribute('data-key') === 'forecastAfterInvesting')).toBe(false);
  });

  it('opens rolling allocation as the fourth view', () => {
    renderHistory();
    expect(screen.queryByText('Rolling allocation panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tabs.allocation' }));
    expect(screen.getByText('Rolling allocation panel')).toBeInTheDocument();
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
  });

  it('replaces flat averages with three trailing daily averages in the first view, with a visibility toggle', () => {
    rollingResult.history = [
      { date: '2026-08-03', income: 100, expenses: 20, investments: 30 },
      { date: '2026-09-01', income: 200, expenses: 40, investments: -50 },
    ];
    renderHistory({ data: { history: [
      { date: '2026-09-01', income: 200, expenses: 40, investments: -50 },
      { date: '2026-09-02', income: 0, expenses: 0, investments: 0 },
      { date: '2026-09-03', income: 0, expenses: 0, investments: 0 },
    ] }, forecastData });
    expect(screen.queryByRole('button', { name: 'tabs.rollingCashflow' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('line-series').map(line => line.getAttribute('data-key')))
      .toEqual(['rollingIncome', 'rollingExpenses', 'rollingInvestments']);
    expect(getChartData()[0]).toMatchObject({ rollingIncome: 10, rollingExpenses: 2, rollingInvestments: -20 / 30 });
    expect(getChartData()[1]).toMatchObject({ rollingIncome: 200 / 30, rollingExpenses: 40 / 30, rollingInvestments: -50 / 30 });
    expect(getChartData()[3]).not.toHaveProperty('rollingIncome');
    expect(within(screen.getByTestId('chart-tooltip-2026-09-01')).getByText('legend.income: ₪10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chart options' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show 30-day daily averages' }));
    expect(screen.queryByTestId('line-series')).not.toBeInTheDocument();
    expect(getChartData()[0]).not.toHaveProperty('rollingIncome');
  });

  it('transforms rolling averages on log scale while keeping signed currency in the tooltip', () => {
    rollingResult.history = [{ date: '2026-08-03', income: 1000, expenses: 100, investments: -100 }];
    renderHistory({ data: { history: [{ date: '2026-09-01', income: 0, expenses: 0, investments: 0 }] }, yAxisScale: 'log' });
    expect(getChartData()[0]).toMatchObject({ rollingIncome: Math.log10(1000 / 30), rollingExpenses: Math.log10(100 / 30), rollingInvestments: -Math.log10(100 / 30) });
    expect(within(screen.getByTestId('chart-tooltip-2026-09-01')).getByText(`legend.investments: -₪${100 / 30}`)).toBeInTheDocument();
  });

  it.each(['weekly', 'monthly'])('uses the clipped period end for rolling averages in %s view', (aggregation) => {
    rollingResult.aggregation = aggregation;
    rollingResult.history = [
      { date: '2026-08-03', income: 1000, expenses: 100, investments: 50 },
      { date: '2026-09-01', income: 200, expenses: 30, investments: -20 },
      { date: '2026-09-03', income: 100, expenses: 20, investments: -10 },
    ];
    renderHistory({ data: { history: [{ date: aggregation === 'weekly' ? '2026-08-31' : '2026-09-01', income: 300, expenses: 50, investments: -30 }] } });
    expect(getChartData()[0]).toMatchObject({ rollingIncome: 10, rollingExpenses: 50 / 30, rollingInvestments: -1,
      rolling: { windowStart: '2026-08-05', date: '2026-09-03' } });
  });

  it('includes signed net investments in the average badge and tooltip, excluding forecasts', async () => {
    renderHistory({
      data: { history: [
        { date: '2026-09-01', expenses: 30, income: 90, investments: 60 },
        { date: '2026-09-02', expenses: 0, income: 0, investments: -120 },
        { date: '2026-09-03', expenses: 0, income: 0 },
      ] },
      forecastData,
    });
    const summary = screen.getByText('patterns.avgByPeriod').parentElement!;
    expect(within(summary).getByLabelText('legend.investments')).toHaveTextContent('◇ -₪20');
    fireEvent.mouseOver(summary);
    await act(async () => { vi.advanceTimersByTime(250); });
    const tooltip = screen.getByRole('tooltip');
    const last7 = within(tooltip).getByText('avgTooltip.last7').parentElement!;
    expect(within(last7).getByLabelText('legend.investments')).toHaveTextContent('◇ -₪20');
    const weekly = within(tooltip).getByText('avgTooltip.thisWeek').parentElement!;
    expect(within(weekly).getByLabelText('legend.investments')).toHaveTextContent('◇ -₪60');
    const median = within(tooltip).getByText('avgTooltip.median30').parentElement!;
    expect(within(median).getByLabelText('legend.investments')).toHaveTextContent('◇ ₪0');
  });

  it('shows dated transactions for an aggregated period even when its anchor also has a forecast', () => {
    renderHistory({
      hoveredDate: '2026-09-04',
      transactionPeriod: { startDate: '2026-09-04', endDate: '2026-09-06' },
      forecastData,
      dateTransactions: [
        { identifier: 'first', vendor: 'max', description: 'First day purchase', price: -20, date: '2026-09-04' },
        { identifier: 'last', vendor: 'max', description: 'Last day purchase', price: -30, date: '2026-09-06' },
      ],
    });
    expect(screen.getByText('transactionsInPeriod')).toBeInTheDocument();
    expect(screen.getByText('First day purchase')).toBeInTheDocument();
    expect(screen.getByText('Last day purchase')).toBeInTheDocument();
    expect(screen.getByText('Sep 04, 2026 · 12:00')).toBeInTheDocument();
    expect(screen.getByText('Sep 06, 2026 · 12:00')).toBeInTheDocument();
    expect(screen.queryByText('predictedTransactionsOn')).not.toBeInTheDocument();
  });

  it('splits each of the three bars by leaf category or vendor while preserving its total', () => {
    renderHistory({ data: { history: splitHistory } });

    fireEvent.click(screen.getByRole('button', { name: 'Chart options' }));
    const splitOptions = screen.getByRole('group', { name: 'Split by' });
    expect(within(splitOptions).getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(splitOptions).getByRole('button', { name: 'Subcategories' }));

    const [categoryRow] = getChartData();
    expect(new Set(screen.getAllByTestId('bar-series').map((bar) => bar.getAttribute('data-stack'))))
      .toEqual(new Set(['income', 'expenses', 'investments']));
    const categoryExpenses = getVisibleSegments(categoryRow, 'expenses');
    expect(categoryExpenses).toHaveLength(2);
    expect(categoryExpenses.find(({ name }) => name.includes('Groceries'))?.value).toBe(100);
    expect(categoryExpenses.find(({ name }) => name.includes('Transport'))?.value).toBe(150);
    expect(getStackTotal(categoryRow, 'income')).toBe(1000);
    expect(getStackTotal(categoryRow, 'expenses')).toBe(250);
    expect(getStackTotal(categoryRow, 'investments')).toBe(150);

    fireEvent.click(within(splitOptions).getByRole('button', { name: 'Vendor' }));
    const [vendorRow] = getChartData();
    const vendorExpenses = getVisibleSegments(vendorRow, 'expenses');
    expect(vendorExpenses).toHaveLength(2);
    expect(vendorExpenses.find(({ name }) => name.includes('isracard'))?.value).toBe(210);
    expect(vendorExpenses.find(({ name }) => name.includes('max'))?.value).toBe(40);
    expect(getStackTotal(vendorRow, 'income')).toBe(1000);
    expect(getStackTotal(vendorRow, 'expenses')).toBe(250);
    expect(getStackTotal(vendorRow, 'investments')).toBe(150);
    expect(within(splitOptions).getByRole('button', { name: 'Subcategories' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(splitOptions).getByRole('button', { name: 'Vendor' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(splitOptions).getByRole('button', { name: 'None' }));
    expect(screen.getAllByTestId('bar-series').map((bar) => bar.getAttribute('data-key')))
      .toEqual(['income', 'expenses', 'investments']);
  });

  it('splits forecasts within the same three stacks and shows segment amounts with the totals', () => {
    renderHistory({
      data: { history: splitHistory },
      forecastData: {
        dailyForecasts: [{
          date: '2026-09-04', income: 300, expenses: 120, investments: 75,
          chartBreakdown: [
            { categoryId: 1, categoryName: 'Salary', vendor: 'discount', income: 300, expenses: 0, investments: 0 },
            { categoryId: 2, categoryName: 'Groceries', vendor: 'isracard', income: 0, expenses: 80, investments: 0 },
            { categoryId: 3, categoryName: 'Transport', vendor: 'max', income: 0, expenses: 40, investments: 0 },
            { categoryId: 4, categoryName: 'Funds', vendor: 'discount', income: 0, expenses: 0, investments: 75 },
          ],
        }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chart options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Subcategories' }));

    const [historicalRow, forecastRow] = getChartData();
    expect(new Set(screen.getAllByTestId('bar-series').map((bar) => bar.getAttribute('data-stack'))))
      .toEqual(new Set(['income', 'expenses', 'investments']));
    expect(getStackTotal(forecastRow, 'income')).toBe(300);
    expect(getStackTotal(forecastRow, 'expenses')).toBe(120);
    expect(getStackTotal(forecastRow, 'investments')).toBe(75);
    const predictedGroceries = getVisibleSegments(forecastRow, 'expenses').find(({ name }) => name.includes('Groceries'))!;
    expect(predictedGroceries.value).toBe(80);
    expect(predictedGroceries.bar.getAttribute('data-dash')).toBeTruthy();
    const actualGroceries = getVisibleSegments(historicalRow, 'expenses').find(({ name }) => name.includes('Groceries'))!;
    expect(predictedGroceries.bar.getAttribute('data-color')).not.toBe(actualGroceries.bar.getAttribute('data-color'));
    const tooltip = screen.getByTestId('chart-tooltip-2026-09-04');
    expect(tooltip).toHaveTextContent('Groceries');
    expect(tooltip).toHaveTextContent('₪80');
    expect(tooltip).toHaveTextContent('Transport');
    expect(tooltip).toHaveTextContent('₪40');
    expect(within(tooltip).getByText('legend.expenses: ₪120')).toBeInTheDocument();
    expect(within(tooltip).getByText('legend.income: ₪300')).toBeInTheDocument();
    expect(within(tooltip).getByText('legend.investments: ₪75')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Show forecast' }));
    expect(screen.getAllByTestId('bar-series').every((bar) => !bar.getAttribute('data-dash'))).toBe(true);
    expect(getStackTotal(getChartData()[0], 'expenses')).toBe(250);
  });

  it('retains the selected split through line mode and reconciles the existing display options', () => {
    renderHistory({
      data: {
        history: [{
          ...splitHistory[0], expenses: 350, capitalReturns: 200, cardRepayments: 100,
          chartBreakdown: [
            ...splitHistory[0].chartBreakdown,
            { categoryId: 5, categoryName: 'Capital return', vendor: 'discount', income: 0, expenses: 0, investments: 0, capitalReturns: 200 },
            { categoryId: 6, categoryName: 'Card repayment', vendor: 'discount', income: 0, expenses: 100, investments: 0, cardRepayments: 100 },
          ],
        }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chart options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vendor' }));
    expect(getStackTotal(getChartData()[0], 'income')).toBe(1000);
    expect(getStackTotal(getChartData()[0], 'expenses')).toBe(250);

    fireEvent.click(screen.getByRole('switch', { name: 'Include capital returns' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Include card repayments' }));
    const [adjustedRow] = getChartData();
    expect(getStackTotal(adjustedRow, 'income')).toBe(1200);
    expect(getStackTotal(adjustedRow, 'expenses')).toBe(350);
    expect(getVisibleSegments(adjustedRow, 'expenses').find(({ name }) => name.includes('discount'))?.value).toBe(100);

    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    expect(screen.queryByRole('group', { name: 'Split by' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('bar-series')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('line-series').map((line) => line.getAttribute('data-key')))
      .toEqual(['income', 'expenses', 'investments']);
    fireEvent.click(screen.getByRole('button', { name: 'Bar' }));
    expect(screen.getByRole('button', { name: 'Vendor' })).toHaveAttribute('aria-pressed', 'true');
    expect(getStackTotal(getChartData()[0], 'income')).toBe(1200);
    expect(getStackTotal(getChartData()[0], 'expenses')).toBe(350);
  });

  it('shows predicted merchant names, category paths, and vendors like recorded transactions', () => {
    renderHistory({
      hoveredDate: '2026-09-04',
      forecastData: {
        dailyForecasts: [{
          date: '2026-09-04', income: 3000, expenses: 200,
          topPredictions: [
            { category: 'שוק הרצל בת ים', transactionName: 'שוק הרצל בת ים',
              category_name: 'מזון', parent_name: 'הוצאות', category_icon: 'shopping_cart',
              category_color: '#b84f47', vendor: 'isracard', amount: 200, probability: 0.8 },
            { category: 'Salary', transactionName: 'בנק לאומי משכורת',
              category_name: 'משכורת', parent_name: 'הכנסות', vendor: 'discount',
              amount: 3000, probability: 1 },
          ],
        }],
      },
    });

    const merchantDetails = screen.getByText('שוק הרצל בת ים').parentElement!;
    expect(within(merchantDetails).getByText('הוצאות > מזון')).toBeInTheDocument();
    expect(within(merchantDetails).getByText('isracard')).toBeInTheDocument();
    expect(within(merchantDetails).getByText('Estimated date')).toBeInTheDocument();
    const salaryDetails = screen.getByText('בנק לאומי משכורת').parentElement!;
    expect(within(salaryDetails).getByText('הכנסות > משכורת')).toBeInTheDocument();
    expect(within(salaryDetails).getByText('discount')).toBeInTheDocument();
    expect(within(salaryDetails).queryByText('isracard')).not.toBeInTheDocument();
  });

  it('keeps the prediction title when category or vendor metadata is unavailable', () => {
    renderHistory({
      hoveredDate: '2026-09-04',
      forecastData: {
        dailyForecasts: [{ date: '2026-09-04', income: 0, expenses: 200,
          topPredictions: [{ category: 'Unmapped prediction', amount: 200, probability: 0.5 }],
        }],
      },
    });
    const details = screen.getByText('Unmapped prediction').parentElement!;
    expect(within(details).getByText('Estimated date')).toBeInTheDocument();
    expect(within(details).queryByText('•')).not.toBeInTheDocument();
    expect(within(details).queryByText('Unknown institution')).not.toBeInTheDocument();
    expect(within(details).queryByText('00:00')).not.toBeInTheDocument();
  });

  it('uses the selected chart type for both historical and forecast series', () => {
    renderHistory({
      data: {
        history: [{
          date: '2026-09-03',
          income: 1_000,
          expenses: 250,
          investments: 150,
          salaryIncome: 1_000,
          capitalReturns: 0,
          cardRepayments: 0,
          pairedCardExpenses: 0,
          pairedCardRepayments: 0,
        }],
      },
      forecastData,
    });

    const historyChart = screen.getByTestId('composed-chart');
    const bars = within(historyChart).getAllByTestId('bar-series');

    expect(bars.map((bar) => bar.getAttribute('data-key'))).toEqual([
      'income',
      'expenses',
      'investments',
      'forecastIncome',
      'forecastExpenses',
      'forecastInvestments',
    ]);
    const investmentBar = bars.find((bar) => bar.getAttribute('data-key') === 'investments');
    expect(investmentBar).toHaveAttribute('data-color', chartTheme.palette.info.main);
    expect(investmentBar).toHaveAttribute('data-name', 'legend.investments');
    const forecastInvestmentBar = bars.find((bar) => bar.getAttribute('data-key') === 'forecastInvestments');
    expect(forecastInvestmentBar).toHaveAttribute('data-color', alpha(chartTheme.palette.info.main, 0.38));
    expect(forecastInvestmentBar).toHaveAttribute('data-stroke', chartTheme.palette.info.main);
    expect(forecastInvestmentBar).toHaveAttribute('data-dash', '4 2');
    expect(forecastInvestmentBar).toHaveAttribute('data-stack', 'investments');
    expect(forecastInvestmentBar).toHaveAttribute('data-name', 'forecast.investments (forecast.expected)');
    expect(within(historyChart).queryByTestId('area-series')).not.toBeInTheDocument();
    expect(within(historyChart).queryByTestId('line-series')).not.toBeInTheDocument();

    const chartData = getChartData();
    expect(chartData).toEqual([
      expect.objectContaining({
        date: '2026-09-03',
        income: 1_000,
        expenses: 250,
        investments: 150,
        isForecast: false,
      }),
      expect.objectContaining({
        date: '2026-09-04',
        forecastIncome: 300,
        forecastExpenses: 100,
        forecastInvestments: 10_000,
        isForecast: true,
      }),
      expect.objectContaining({
        date: '2026-09-05',
        forecastIncome: 0,
        forecastExpenses: 75,
        forecastInvestments: 0,
        isForecast: true,
      }),
    ]);
    expect(chartData[0]).not.toHaveProperty('forecastIncome');
    expect(chartData[0]).not.toHaveProperty('forecastExpenses');
    expect(chartData[0]).not.toHaveProperty('forecastInvestments');
    expect(chartData[1]).not.toHaveProperty('income');
    expect(chartData[1]).not.toHaveProperty('expenses');
    for (const forecastRow of chartData.slice(1)) {
      expect(forecastRow).not.toHaveProperty('investments');
      expect(within(screen.getByTestId(`chart-tooltip-${forecastRow.date}`))
        .getByText(`legend.investments: ₪${forecastRow.forecastInvestments}`)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId('chart-tooltip-2026-09-03'))
      .getByText('legend.investments: ₪150')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Chart options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));

    const lines = within(historyChart).getAllByTestId('line-series');
    expect(lines.map((line) => line.getAttribute('data-key'))).toEqual([
      'income',
      'expenses',
      'investments',
      'forecastIncome',
      'forecastExpenses',
      'forecastInvestments',
    ]);
    const investmentLine = lines.find((line) => line.getAttribute('data-key') === 'investments');
    expect(investmentLine).toHaveAttribute('data-color', chartTheme.palette.info.main);
    expect(investmentLine).toHaveAttribute('data-name', 'legend.investments');
    const forecastInvestmentLine = lines.find((line) => line.getAttribute('data-key') === 'forecastInvestments');
    expect(forecastInvestmentLine).toHaveAttribute('data-color', chartTheme.palette.info.light);
    expect(forecastInvestmentLine).toHaveAttribute('data-dash', '5 5');
    expect(forecastInvestmentLine).toHaveAttribute('data-name', 'forecast.investments (forecast.expected)');
    expect(within(historyChart).queryByTestId('bar-series')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Show forecast' }));
    expect(within(historyChart).getAllByTestId('line-series').map((line) => line.getAttribute('data-key')))
      .toEqual(['income', 'expenses', 'investments']);
    fireEvent.click(screen.getByRole('button', { name: 'Bar' }));
    expect(within(historyChart).getAllByTestId('bar-series').map((bar) => bar.getAttribute('data-key')))
      .toEqual(['income', 'expenses', 'investments']);
    fireEvent.click(screen.getByRole('switch', { name: 'Show forecast' }));
    expect(within(historyChart).getAllByTestId('bar-series').map((bar) => bar.getAttribute('data-key')))
      .toContain('forecastInvestments');
  });

  it.each([false, true])('plots investments on log scale with original amounts in tooltips (forecast: %s)', (withForecast) => {
    renderHistory({
      data: {
        history: [
          { date: '2026-09-01', income: 1_000, expenses: 250, investments: 10_000 },
          { date: '2026-09-02', income: 0, expenses: 50, investments: -1_000 },
          { date: '2026-09-03', income: 0, expenses: 25 },
        ],
      },
      yAxisScale: 'log',
      forecastData: withForecast ? forecastData : null,
    });

    const chartData = getChartData();
    expect(chartData[0]).toEqual(expect.objectContaining({
      investments: 4,
      originalInvestments: 10_000,
    }));
    expect(chartData[1]).toEqual(expect.objectContaining({
      investments: -3,
      originalInvestments: -1_000,
    }));
    expect(chartData[2].investments).toBe(0);
    expect(within(screen.getByTestId('chart-tooltip-2026-09-01'))
      .getByText('legend.investments: ₪10000')).toBeInTheDocument();
    expect(within(screen.getByTestId('chart-tooltip-2026-09-02'))
      .getByText('legend.investments: -₪1000')).toBeInTheDocument();
    expect(within(screen.getByTestId('chart-tooltip-2026-09-03'))
      .getByText('legend.investments: ₪0')).toBeInTheDocument();
    if (withForecast) {
      expect(chartData[3]).not.toHaveProperty('investments');
      expect(chartData[3].forecastIncome).toBeCloseTo(Math.log10(300));
      expect(chartData[3]).toEqual(expect.objectContaining({
        forecastInvestments: 4,
        originalForecastInvestments: 10_000,
      }));
      expect(within(screen.getByTestId('chart-tooltip-2026-09-04'))
        .getByText('legend.investments: ₪10000')).toBeInTheDocument();
      expect(chartData[4].forecastInvestments).toBe(0);
      expect(within(screen.getByTestId('chart-tooltip-2026-09-05'))
        .getByText('legend.investments: ₪0')).toBeInTheDocument();
    }
  });

  it.each([150, -150, 0])('recognizes an investment-only forecast (investments: %s)', (investments) => {
    renderHistory({
      forecastData: { dailyForecasts: [{ date: '2026-09-04', investments }] },
      yAxisScale: 'log',
    });

    expect(getChartData()).toEqual([
      expect.objectContaining({
        date: '2026-09-04',
        forecastInvestments: investments === 0 ? 0 : Math.sign(investments) * Math.log10(Math.abs(investments)),
        originalForecastInvestments: investments,
        isForecast: true,
      }),
    ]);
    expect(screen.getAllByTestId('bar-series').map((bar) => bar.getAttribute('data-key')))
      .toContain('forecastInvestments');
    expect(within(screen.getByTestId('chart-tooltip-2026-09-04'))
      .getByText(`legend.investments: ${investments < 0 ? '-' : ''}₪${Math.abs(investments)}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Chart options' }));
    expect(screen.getByRole('switch', { name: 'Show forecast' })).toBeEnabled();
  });

  it.each([undefined, null])('omits unavailable investment forecasts from the chart and tooltip (%s)', (investments) => {
    renderHistory({
      forecastData: {
        dailyForecasts: [{ date: '2026-09-04', income: 300, expenses: 100, investments }],
      },
      yAxisScale: 'log',
    });

    const [forecastRow] = getChartData();
    expect(forecastRow).not.toHaveProperty('investments');
    expect(forecastRow).not.toHaveProperty('forecastInvestments');
    expect(forecastRow).not.toHaveProperty('originalForecastInvestments');
    expect(forecastRow.forecastIncome).toBeCloseTo(Math.log10(300));
    expect(within(screen.getByTestId('chart-tooltip-2026-09-04'))
      .queryByText(/legend.investments/)).not.toBeInTheDocument();
  });

  it('shows every forecast contribution beyond the top five and reconciles the September 24 expense total', () => {
    const predictions = [
      { transactionName: 'Public transport', categoryType: 'expense', amount: 106, probability: 1 },
      { transactionName: 'Partner communications', categoryType: 'expense', amount: 204, probability: 0.97 },
      { transactionName: 'PAYBOX', categoryType: 'expense', amount: 80, probability: 0.86 },
      { transactionName: 'Hairdresser', categoryType: 'expense', amount: 110, probability: 0.83 },
      { transactionName: 'Pango Moovit', categoryType: 'expense', amount: 126, probability: 0.56 },
      { transactionName: 'Additional spending', categoryType: 'expense', amount: 2261.15, probability: 0.4, probabilityWeightedAmount: 904.46 },
    ];
    renderHistory({
      forecastData: { dailyForecasts: [{
        date: '2026-09-24', income: 0, expenses: 1439,
        predictions,
        topPredictions: predictions.slice(0, 5),
      }] },
      hoveredDate: '2026-09-24',
      formatCurrency: formatForecastCurrency,
    });

    const expenses = screen.getByRole('region', { name: 'legend.expenses' });
    predictions.forEach(prediction => expect(within(expenses).getByText(prediction.transactionName)).toBeInTheDocument());
    expect(within(expenses).getAllByText('Included in forecast')).toHaveLength(6);
    for (const amount of ['₪106.00', '₪197.88', '₪68.80', '₪91.30', '₪70.56', '₪904.46']) {
      expect(within(expenses).getByText(amount)).toBeInTheDocument();
    }
    expect(within(expenses).getByText('Estimated transaction: ₪204.00')).toBeInTheDocument();
    expect(within(expenses).getAllByText('Estimated date')).toHaveLength(6);
    expect(within(expenses).getByText('₪1,439.00')).toBeInTheDocument();
    expect(within(expenses).queryByText('Other forecast contributions')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('chart-tooltip-2026-09-24'))
      .getByText('legend.expenses: ₪1,439.00')).toBeInTheDocument();
  });

  it('separates each flow and uses supplied forecast contributions including zero and negative amounts', () => {
    renderHistory({
      forecastData: { dailyForecasts: [{
        date: '2026-09-04', income: 500, expenses: 80, investments: -60,
        predictions: [
          { transactionName: 'Groceries', categoryType: 'expense', amount: 200, probability: 0.5, probabilityWeightedAmount: 80 },
          { transactionName: 'Suppressed payment', categoryType: 'expense', amount: 999, probability: 1, probabilityWeightedAmount: 0 },
          { transactionName: 'Salary', categoryType: 'income', amount: 1000, probability: 0.5, probabilityWeightedAmount: 500, awaitingReceipt: true },
          { transactionName: 'Investment withdrawal', categoryType: 'investment', amount: -120, probability: 0.5, probabilityWeightedAmount: -60 },
        ],
      }] },
      hoveredDate: '2026-09-04',
      formatCurrency: formatForecastCurrency,
    });

    const expenses = screen.getByRole('region', { name: 'legend.expenses' });
    expect(within(expenses).getByText('Groceries')).toBeInTheDocument();
    expect(within(expenses).getByText('Suppressed payment')).toBeInTheDocument();
    expect(within(expenses).getAllByText('₪80.00')).toHaveLength(2);
    expect(within(expenses).getByText('₪0.00')).toBeInTheDocument();
    expect(within(expenses).getByText('Estimated transaction: ₪200.00')).toBeInTheDocument();
    expect(within(expenses).queryByText('₪100.00')).not.toBeInTheDocument();
    expect(within(expenses).queryByText('Salary')).not.toBeInTheDocument();

    const income = screen.getByRole('region', { name: 'legend.income' });
    expect(within(income).getByText('Salary')).toBeInTheDocument();
    expect(within(income).getByText('analysisPage.modals.future.incomeSources.awaiting')).toBeInTheDocument();
    expect(within(income).getAllByText('₪500.00')).toHaveLength(2);
    expect(within(income).getByText('Estimated transaction: ₪1,000.00')).toBeInTheDocument();

    const investments = screen.getByRole('region', { name: 'legend.investments' });
    expect(within(investments).getByText('Investment withdrawal')).toBeInTheDocument();
    expect(within(investments).getAllByText('-₪60.00')).toHaveLength(2);
    expect(within(investments).getByText('Estimated transaction: -₪120.00')).toBeInTheDocument();
    expect(screen.queryByText('Other forecast contributions')).not.toBeInTheDocument();

    const tooltip = screen.getByTestId('chart-tooltip-2026-09-04');
    for (const [flow, amount] of [['expenses', '₪80.00'], ['income', '₪500.00'], ['investments', '-₪60.00']]) {
      expect(within(tooltip).getByText(`legend.${flow}: ${amount}`)).toBeInTheDocument();
    }
  });

  it('accounts explicitly for missing contributions in older forecasts containing only top predictions', () => {
    renderHistory({
      forecastData: { dailyForecasts: [{
        date: '2026-09-04', income: 0, expenses: 250,
        topPredictions: [{ transactionName: 'Utilities', categoryType: 'expense', amount: 200, probability: 0.5 }],
      }] },
      hoveredDate: '2026-09-04',
      formatCurrency: formatForecastCurrency,
    });

    const expenses = screen.getByRole('region', { name: 'legend.expenses' });
    expect(within(expenses).getByText('Utilities')).toBeInTheDocument();
    expect(within(expenses).getByText('₪100.00')).toBeInTheDocument();
    expect(within(expenses).getByText('Other forecast contributions')).toBeInTheDocument();
    expect(within(expenses).getByText('₪150.00')).toBeInTheDocument();
    expect(within(expenses).getByText('₪250.00')).toBeInTheDocument();
    expect(within(screen.getByTestId('chart-tooltip-2026-09-04'))
      .getByText('legend.expenses: ₪250.00')).toBeInTheDocument();
  });

  it('respects an explicitly empty full prediction list instead of showing stale top predictions', () => {
    renderHistory({
      forecastData: { dailyForecasts: [{
        date: '2026-09-04', income: 0, expenses: 0, predictions: [],
        topPredictions: [{ transactionName: 'Stale payment', categoryType: 'expense', amount: 100, probability: 1 }],
      }] },
      hoveredDate: '2026-09-04',
    });

    expect(screen.queryByText('Stale payment')).not.toBeInTheDocument();
    expect(screen.getByText('No predictions for this date')).toBeInTheDocument();
  });

  it('shows the cents rounding adjustment so displayed contributions add up to the chart total', () => {
    renderHistory({
      forecastData: { dailyForecasts: [{
        date: '2026-09-04', income: 0, expenses: 1,
        predictions: ['Transport', 'Food', 'Shopping'].map(transactionName => ({
          transactionName, categoryType: 'expense', amount: 1, probability: 1 / 3,
        })),
      }] },
      hoveredDate: '2026-09-04',
      formatCurrency: formatForecastCurrency,
    });

    const expenses = screen.getByRole('region', { name: 'legend.expenses' });
    expect(within(expenses).getAllByText('₪0.33')).toHaveLength(3);
    expect(within(expenses).getByText('Rounding')).toBeInTheDocument();
    expect(within(expenses).getByText('₪0.01')).toBeInTheDocument();
    expect(within(expenses).getByText('₪1.00')).toBeInTheDocument();
    expect(within(expenses).queryByText('Other forecast contributions')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('chart-tooltip-2026-09-04'))
      .getByText('legend.expenses: ₪1.00')).toBeInTheDocument();
  });

  it.each([150, -150])('recognizes an investment-only last day as actual data (investments: %s)', (investments) => {
    renderHistory({
      data: {
        history: [
          { date: '2026-09-01', income: 1_000, expenses: 250, investments: 0 },
          { date: '2026-09-02', income: 0, expenses: 0, investments: 0 },
          { date: '2026-09-03', income: 0, expenses: 0, investments },
        ],
      },
      forecastData,
    });

    const lastHistoricalRow = getChartData()[2];
    expect(lastHistoricalRow.isInGap).toBeFalsy();
    expect(lastHistoricalRow.investments).toBe(investments);
    expect(within(screen.getByTestId('chart-tooltip-2026-09-03'))
      .queryByText(/legend.noData/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('chart-tooltip-2026-09-03'))
      .getByText(`legend.investments: ${investments < 0 ? '-' : ''}₪${Math.abs(investments)}`)).toBeInTheDocument();
  });

  it('summarizes tiny daily spending shares in one row while keeping them in the total', () => {
    const small = ['Repairs', 'Cash withdrawal', 'Books'].map((category, index) => ({ category, categoryType: 'expense',
      timingBasis: 'daily_average', amount: 60, probability: 0.04, probabilityWeightedAmount: [2, 1.5, 3][index] }));
    renderHistory({
      forecastData: { dailyForecasts: [{ date: '2026-09-04', income: 0, expenses: 1291.5, predictions: [
        { transactionName: 'Arnona', categoryType: 'expense', amount: 1190, probability: 1, probabilityWeightedAmount: 1190 },
        { category: 'Groceries', categoryType: 'expense', timingBasis: 'daily_average', amount: 95, probability: 1, probabilityWeightedAmount: 95 },
        ...small,
      ] }] },
      hoveredDate: '2026-09-04',
      formatCurrency: formatForecastCurrency,
    });
    const expenses = screen.getByRole('region', { name: 'legend.expenses' });
    expect(within(expenses).getByText('Groceries')).toBeInTheDocument();
    for (const { category } of small) expect(within(expenses).queryByText(category)).not.toBeInTheDocument();
    const other = within(expenses).getByText('Other typical daily spending (3)').closest('div')!.parentElement!;
    expect(within(other).getByText('₪6.50')).toBeInTheDocument();
    expect(within(expenses).getByText('₪1,291.50')).toBeInTheDocument();
    expect(within(expenses).queryByText('Rounding')).not.toBeInTheDocument();
    expect(within(expenses).queryByText('Other forecast contributions')).not.toBeInTheDocument();
  });

  describe('forecast confidence tiers', () => {
    const tieredForecast = { dailyForecasts: [{
      date: '2026-09-04', income: 0, expenses: 1430, investments: 0,
      confidenceBreakdown: {
        income: { sure: 0, likely: 0, uncertain: 0 },
        expenses: { sure: 500, likely: 600, uncertain: 330 },
        investments: { sure: 0, likely: 0, uncertain: 0 },
      },
      predictions: [
        { category: 'Groceries', categoryType: 'expense', amount: 300, probability: 1, probabilityWeightedAmount: 300,
          timingBasis: 'daily_average', confidenceTier: 'uncertain', amountRange: { low: 200, high: 400 } },
        { transactionName: 'Electricity', categoryType: 'expense', amount: 600, probability: 1, probabilityWeightedAmount: 600,
          timingBasis: 'estimated', confidenceTier: 'likely', amountRange: { low: 450, high: 750 } },
        { transactionName: 'Sofa installment', categoryType: 'expense', amount: 500, probability: 1, probabilityWeightedAmount: 500,
          timingBasis: 'scheduled', confidenceTier: 'sure', amountRange: { low: 500, high: 500 } },
      ],
    }] };

    it('stacks sure, likely and uncertain segments to the unchanged forecast total', () => {
      renderHistory({ forecastData: tieredForecast });
      const expenseKeys = screen.getAllByTestId('bar-series')
        .filter(bar => bar.getAttribute('data-stack') === 'expenses')
        .map(bar => bar.getAttribute('data-key'));
      expect(expenseKeys).toEqual(['expenses', 'forecastExpensesSure', 'forecastExpensesLikely', 'forecastExpensesUncertain']);
      const forecastRow = getChartData().find((row: Record<string, unknown>) => row.date === '2026-09-04');
      expect(getStackTotal(forecastRow, 'expenses')).toBe(1430);
      const opacities = ['Sure', 'Likely', 'Uncertain'].map(tier => screen.getAllByTestId('bar-series')
        .find(bar => bar.getAttribute('data-key') === `forecastExpenses${tier}`)!.getAttribute('data-color'));
      expect(opacities).toEqual([0.75, 0.45, 0.18].map(opacity => alpha(chartTheme.palette.error.main, opacity)));
      expect(within(screen.getByTestId('chart-tooltip-2026-09-04')).getByText(
        'forecast.confidenceTier.sure ₪500 · forecast.confidenceTier.likely ₪600 · forecast.confidenceTier.uncertain ₪330',
      )).toBeInTheDocument();
    });

    it('splits the log-scale bar height by tier share and keeps original amounts in the tooltip', () => {
      renderHistory({ forecastData: tieredForecast, yAxisScale: 'log' });
      const keys = screen.getAllByTestId('bar-series').map(bar => bar.getAttribute('data-key'));
      expect(keys).toEqual(expect.arrayContaining(['forecastExpensesSure', 'forecastExpensesLikely', 'forecastExpensesUncertain']));
      expect(keys).not.toContain('forecastExpenses');
      const forecastRow = getChartData().find((row: Record<string, unknown>) => row.date === '2026-09-04');
      expect(getStackTotal(forecastRow, 'expenses')).toBeCloseTo(Math.log10(1430));
      expect(forecastRow.forecastExpensesLikely / forecastRow.forecastExpensesSure).toBeCloseTo(600 / 500);
      expect(within(screen.getByTestId('chart-tooltip-2026-09-04')).getByText(
        'forecast.confidenceTier.sure ₪500 · forecast.confidenceTier.likely ₪600 · forecast.confidenceTier.uncertain ₪330',
      )).toBeInTheDocument();
    });

    it('keeps a single forecast bar for responses without a confidence split', () => {
      renderHistory({ forecastData });
      const keys = screen.getAllByTestId('bar-series').map(bar => bar.getAttribute('data-key'));
      expect(keys).toContain('forecastExpenses');
      expect(keys).not.toContain('forecastExpensesSure');
    });

    it('labels each predicted item with its tier, sorts certain items first and shows variable ranges', () => {
      renderHistory({ forecastData: tieredForecast, hoveredDate: '2026-09-04' });
      const expenses = screen.getByRole('region', { name: 'legend.expenses' });
      const names = within(expenses).getAllByText(/^(Groceries|Electricity|Sofa installment)$/).map(node => node.textContent);
      expect(names).toEqual(['Sofa installment', 'Electricity', 'Groceries']);
      const electricity = within(expenses).getByText('Electricity').parentElement!;
      expect(within(electricity).getByText('forecast.confidenceTier.likely')).toBeInTheDocument();
      expect(within(electricity).getByText(/forecast\.amountRange/)).toBeInTheDocument();
      const sofa = within(expenses).getByText('Sofa installment').parentElement!;
      expect(within(sofa).getByText('forecast.confidenceTier.sure')).toBeInTheDocument();
      expect(within(sofa).queryByText(/forecast\.amountRange/)).not.toBeInTheDocument();
    });
  });
});
