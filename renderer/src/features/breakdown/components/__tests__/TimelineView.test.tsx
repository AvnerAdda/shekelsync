import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TimelineView from '../TimelineView';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data, onClick }: any) => (
    <div>
      <output data-testid="chart-data">{JSON.stringify(data)}</output>
      <button onClick={() => onClick({ activeLabel: '2026-02-28' })}>Open final day</button>
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Line: () => null,
  Area: () => null,
  Bar: () => null,
}));

vi.mock('@renderer/shared/components/InstitutionBadge', () => ({ default: () => null }));

afterEach(cleanup);

const props = {
  monthlyData: [{ month: '2026-02', total: 900 }],
  currentData: [{ id: 1, name: 'Shopping', value: 400, count: 2 }],
  startDate: new Date(2026, 1, 27),
  endDate: new Date(2026, 1, 28),
  categoryType: 'expense' as const,
  title: 'Expenses',
  formatCurrencyValue: (value: number) => `ILS ${value}`,
};

describe('expense timeline refunds', () => {
  it('reduces cumulative spending on the refund date and shows the refund sign in the details', () => {
    render(<TimelineView {...props} transactions={[
      { identifier: 'purchase', vendor: 'bank-a', date: '2026-02-27', price: -500, parent_id: 1 },
      { identifier: 'refund', vendor: 'bank-a', date: '2026-02-28T23:59:59.999Z', price: 100, parent_id: 1 },
    ]} />);

    expect(JSON.parse(screen.getByTestId('chart-data').textContent!)).toMatchObject([
      { label: '2026-02-27', series_1_simple: 500, total_cumulative: 500 },
      { label: '2026-02-28', series_1_simple: -100, total_cumulative: 400 },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Open final day' }));
    expect(screen.getByText('ILS -100')).toBeInTheDocument();
  });

  it('retains a refund-only category series instead of falling back to the full breakdown', () => {
    render(<TimelineView {...props} transactions={[
      { identifier: 'refund', vendor: 'bank-a', date: '2026-02-28', price: 100, parent_id: 1 },
    ]} />);

    expect(JSON.parse(screen.getByTestId('chart-data').textContent!)).toMatchObject([
      { label: '2026-02-27', total_cumulative: 0 },
      { label: '2026-02-28', series_1_cumulative: -100, total_cumulative: -100 },
    ]);
  });
});
