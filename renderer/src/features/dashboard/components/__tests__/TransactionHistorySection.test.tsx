import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionHistorySection from '../TransactionHistorySection';

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

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="composed-chart" data-chart-data={JSON.stringify(data)}>{children}</div>
  ),
  Bar: ({ dataKey }: { dataKey: string }) => (
    <div data-testid="bar-series" data-key={dataKey} />
  ),
  Area: ({ dataKey }: { dataKey: string }) => (
    <div data-testid="area-series" data-key={dataKey} />
  ),
  Line: ({ dataKey }: { dataKey: string }) => (
    <div data-testid="line-series" data-key={dataKey} />
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  ReferenceArea: () => null,
}));

vi.mock('../IncomeExpenseCalendar', () => ({ default: () => null }));
vi.mock('@renderer/shared/modals/TransactionDetailModal', () => ({ default: () => null }));
vi.mock('@renderer/features/financial-truth/FinancialCorrectionDialog', () => ({ default: () => null }));

describe('TransactionHistorySection income and expense chart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the selected chart type for both historical and forecast series', () => {
    render(
      <TransactionHistorySection
        data={{
          history: [
            {
              date: '2026-09-03',
              income: 1_000,
              expenses: 250,
              salaryIncome: 1_000,
              capitalReturns: 0,
              cardRepayments: 0,
              pairedCardExpenses: 0,
              pairedCardRepayments: 0,
            },
          ],
        }}
        yAxisScale="linear"
        setYAxisScale={vi.fn()}
        shouldUseLogScale={() => false}
        formatCurrencyValue={(value) => String(value)}
        formatXAxis={(value) => value}
        formatYAxisLog={(value) => String(value)}
        getLogScaleData={(history) => history}
        handleChartAreaClick={vi.fn()}
        detectAnomalies={() => []}
        hoveredDate={null}
        setHoveredDate={vi.fn()}
        fetchTransactionsByDate={vi.fn()}
        dateTransactions={[]}
        loadingTransactions={false}
        parseLocalDate={(value) => new Date(`${value}T12:00:00`)}
        formatCurrency={(value) => String(value)}
        forecastData={{
          dailyForecasts: [
            { date: '2026-09-04', income: 300, expenses: 100, cashFlow: 200 },
            { date: '2026-09-05', income: 0, expenses: 75, cashFlow: -75 },
          ],
        }}
      />,
    );

    const historyChart = screen.getByTestId('composed-chart');
    const bars = within(historyChart).getAllByTestId('bar-series');

    expect(bars.map((bar) => bar.getAttribute('data-key'))).toEqual([
      'income',
      'expenses',
      'forecastIncome',
      'forecastExpenses',
    ]);
    expect(within(historyChart).queryByTestId('area-series')).not.toBeInTheDocument();
    expect(within(historyChart).queryByTestId('line-series')).not.toBeInTheDocument();

    const chartData = JSON.parse(historyChart.getAttribute('data-chart-data') || '[]');
    expect(chartData).toEqual([
      expect.objectContaining({
        date: '2026-09-03',
        income: 1_000,
        expenses: 250,
        isForecast: false,
      }),
      expect.objectContaining({
        date: '2026-09-04',
        forecastIncome: 300,
        forecastExpenses: 100,
        isForecast: true,
      }),
      expect.objectContaining({
        date: '2026-09-05',
        forecastIncome: 0,
        forecastExpenses: 75,
        isForecast: true,
      }),
    ]);
    expect(chartData[0]).not.toHaveProperty('forecastIncome');
    expect(chartData[0]).not.toHaveProperty('forecastExpenses');
    expect(chartData[1]).not.toHaveProperty('income');
    expect(chartData[1]).not.toHaveProperty('expenses');

    fireEvent.click(screen.getByRole('button', { name: 'Chart options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Line' }));

    const lines = within(historyChart).getAllByTestId('line-series');
    expect(lines.map((line) => line.getAttribute('data-key'))).toEqual([
      'income',
      'expenses',
      'forecastIncome',
      'forecastExpenses',
    ]);
    expect(within(historyChart).queryByTestId('bar-series')).not.toBeInTheDocument();
  });
});
