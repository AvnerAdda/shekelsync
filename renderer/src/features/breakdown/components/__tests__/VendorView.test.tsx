import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import VendorView from '../VendorView';
import { VendorBreakdownItem } from '../../../types';

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

const formatCurrencyValue = (value: number) => `₪${value.toFixed(0)}`;

describe('VendorView', () => {
  const baseVendor: VendorBreakdownItem = {
    vendor: 'Cafe XYZ',
    total: 1200,
    count: 5,
    previousTotal: 1000,
    previousCount: 4,
    history: [
      { month: '2025-01', total: 1000 },
      { month: '2025-02', total: 1200 },
    ],
  };

  it('shows delta chip and sparkline when previous totals and history exist', () => {
    renderWithTheme(
      <VendorView
        vendors={[baseVendor]}
        categoryType="expense"
        formatCurrencyValue={formatCurrencyValue}
      />,
    );

    expect(screen.getByText('+20.0%')).toBeInTheDocument();
    expect(screen.getByLabelText('Trend for Cafe XYZ')).toBeInTheDocument();
    expect(screen.getByText('₪1200')).toBeInTheDocument();
  });

  it('omits delta chip when no previous totals are provided', () => {
    const vendor: VendorBreakdownItem = {
      ...baseVendor,
      previousTotal: undefined,
      history: undefined,
    };

    renderWithTheme(
      <VendorView
        vendors={[vendor]}
        categoryType="expense"
        formatCurrencyValue={formatCurrencyValue}
      />,
    );

    expect(screen.queryByText(/\%/)).toBeNull();
  });
});

