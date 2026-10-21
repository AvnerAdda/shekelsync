import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useBreakdownDrilldown from '../../hooks/useBreakdownDrilldown';
import CategoryView from '../CategoryView';
import OverviewView from '../OverviewView';
import VendorView from '../VendorView';

vi.mock('@renderer/i18n/I18nProvider', () => ({ useLocaleSettings: () => ({ locale: 'en' }) }));
vi.mock('../TrendSparkline', () => ({ default: () => null }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  PieChart: ({ children }: any) => <div>{children}</div>,
  Pie: ({ data, dataKey }: any) => <output data-testid="pie">{JSON.stringify({ data, dataKey })}</output>,
  SunburstChart: ({ data }: any) => <output data-testid="sunburst">{JSON.stringify(data)}</output>,
  Cell: () => null,
  Tooltip: () => null,
}));

afterEach(cleanup);

const category = {
  parentId: 1, category: 'Shopping', total: -100, previousTotal: -50, count: 2,
  subcategories: [{ id: 2, name: 'Clothing', total: -100, count: 2 }],
};
const formatCurrencyValue = (value: number) => `ILS ${value}`;

describe('signed breakdown presentation', () => {
  it.each([
    { refund: 50, net: 50, percentages: ['66.7%', '33.3%'] },
    { refund: 100, net: 0, percentages: ['50.0%', '50.0%'] },
  ])('matches category percentages to slice magnitudes with a refund of $refund', ({ refund, net, percentages }) => {
    render(<OverviewView data={[
      { id: 1, name: 'Purchases', value: 100, count: 1 },
      { id: 2, name: 'Refunds', value: -refund, count: 1 },
    ]} currentLevel={null} isZooming={false} categoryType="expense" chartTitle="Expenses"
      parentTitle={(name) => name} subcategoryTitle={(name) => name}
      pendingBreakdownLabel={() => ''} formatCurrencyValue={formatCurrencyValue}
      onDrillDown={vi.fn()} onSubcategoryClick={vi.fn()} onLeafClick={vi.fn()}
      getCategoryTransactionCounts={() => ({ processedCount: 1, pendingCount: 0, total: 1 })}
    />);

    expect(screen.getByText(`ILS ${net}`)).toBeInTheDocument();
    expect(screen.getByText(`ILS -${refund}`)).toBeInTheDocument();
    for (const percentage of new Set(percentages)) {
      expect(screen.getAllByText(percentage)).toHaveLength(percentages.filter(value => value === percentage).length);
    }
  });

  it('preserves refund signs while drilling from parent totals to child totals', () => {
    const { result } = renderHook(() => useBreakdownDrilldown({
      startDate: new Date('2026-02-01'), endDate: new Date('2026-02-28'),
      categoryType: 'expense', categoryBreakdown: [category], transactions: [],
    }));
    expect(result.current.currentData).toMatchObject([{ value: -100, previousValue: -50 }]);
    act(() => result.current.handleDrillDown(1, 'Shopping'));
    expect(result.current.currentData).toMatchObject([{ id: 2, value: -100 }]);
  });

  it('shows net refunds in category totals and supplies valid pie and sunburst sizes', () => {
    render(<CategoryView categoryType="expense" formatCurrencyValue={formatCurrencyValue} data={[
      { id: 1, name: 'Shopping', value: -100, count: 2, subcategories: [
        { id: 2, name: 'Clothing', total: 500, count: 1 },
        { id: 3, name: 'Refunds', total: -600, count: 1 },
      ] },
    ]} />);
    expect(screen.getByText('ILS -100')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('pie').textContent!)).toMatchObject({
      dataKey: 'chartValue', data: [{ value: -100, chartValue: 100 }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'sunburst chart' }));
    expect(JSON.parse(screen.getByTestId('sunburst').textContent!)).toMatchObject({
      value: 1100, displayValue: -100,
      children: [{ value: 1100, displayValue: -100, children: [
        { value: 500, displayValue: 500 }, { value: 600, displayValue: -600 },
      ] }],
    });
  });

  it('shows a vendor net refund as a negative amount', () => {
    render(<VendorView categoryType="expense" formatCurrencyValue={formatCurrencyValue}
      vendorTrendLabel={(vendor) => vendor} vendors={[{ vendor: 'bank-a', total: -100, count: 2 }]} />);
    expect(screen.getByText('ILS -100')).toBeInTheDocument();
  });
});
