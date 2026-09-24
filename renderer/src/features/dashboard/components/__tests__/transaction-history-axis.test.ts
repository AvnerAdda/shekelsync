import { describe, expect, it } from 'vitest';
import { getIncomeExpenseYAxisConfig } from '../transaction-history-axis';

describe('income and expense Y-axis configuration', () => {
  it('anchors the linear chart at zero without expanding for negative points', () => {
    expect(getIncomeExpenseYAxisConfig('linear')).toEqual({
      domain: [0, 'auto'],
      allowDataOverflow: true,
    });
  });

  it('preserves the existing logarithmic configuration', () => {
    expect(getIncomeExpenseYAxisConfig('log')).toEqual({
      domain: [0, 'dataMax'],
      allowDataOverflow: false,
    });
  });

  it.each(['linear', 'log'] as const)('allows net withdrawals below zero on the %s chart', (scale) => {
    expect(getIncomeExpenseYAxisConfig(scale, true)).toEqual({
      domain: ['dataMin', 'auto'],
      allowDataOverflow: false,
    });
  });
});
