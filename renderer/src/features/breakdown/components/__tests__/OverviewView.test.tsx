import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import OverviewView from '../OverviewView';
import { OverviewDataItem } from '../../../types';

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

const formatCurrencyValue = (value: number) => `₪${value.toFixed(0)}`;

describe('OverviewView', () => {
  const baseData: OverviewDataItem[] = [
    {
      id: 1,
      name: 'Dining',
      color: '#ff0000',
      icon: 'restaurant',
      description: '',
      value: 1200,
      previousValue: 1000,
      count: 6,
      history: [
        { month: '2025-01', total: 1000 },
        { month: '2025-02', total: 1100 },
        { month: '2025-03', total: 1200 },
      ],
      subcategories: [],
    },
  ];

  const noop = vi.fn();
  const getCounts = vi.fn(() => ({ processedCount: 4, pendingCount: 1, total: 5 }));

  it('renders delta chip and sparkline for categories with trend data', () => {
    renderWithTheme(
      <OverviewView
        data={baseData}
        currentLevel={null}
        isZooming={false}
        categoryType="expense"
        chartTitle="Expenses"
        parentTitle={(name) => `${name} Breakdown`}
        subcategoryTitle={(name) => `${name} Details`}
        pendingBreakdownLabel={(processed, pending) => `${processed} + ${pending} pending`}
        formatCurrencyValue={formatCurrencyValue}
        onDrillDown={noop}
        onSubcategoryClick={noop}
        onLeafClick={noop as any}
        getCategoryTransactionCounts={getCounts}
      />,
    );

    expect(screen.getByText('+20.0%')).toBeInTheDocument();
    expect(screen.getByText('₪1200')).toBeInTheDocument();
  });
});
