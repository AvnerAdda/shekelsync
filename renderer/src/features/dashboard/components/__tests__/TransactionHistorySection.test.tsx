import React from 'react';
import { alpha, createTheme, ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    aggregationPeriod: 'daily',
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
    Area: ({ dataKey }: { dataKey: string }) => (
      <div data-testid="area-series" data-key={dataKey} />
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
      content: (props: { active: boolean; payload: { payload: ChartRow }[] }) => React.ReactNode;
    }) => {
      const data = useContext(ChartDataContext);
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(within(merchantDetails).getByText('80% probability')).toBeInTheDocument();
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
    expect(within(details).getByText('50% probability')).toBeInTheDocument();
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
    expect(within(expenses).getByText('97% probability')).toBeInTheDocument();
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
          { transactionName: 'Salary', categoryType: 'income', amount: 1000, probability: 0.5, probabilityWeightedAmount: 500 },
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
});
