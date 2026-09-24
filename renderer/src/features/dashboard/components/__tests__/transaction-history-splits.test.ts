import { describe, expect, it } from 'vitest';
import { buildSplitBarData } from '../transaction-history-splits';

const options = { includeCapitalReturns: false, includeCardRepayments: false, showForecast: true,
  scale: 'linear' as const, uncategorizedLabel: 'Uncategorized', unknownVendorLabel: 'Unknown vendor' };
const segment = (categoryId: number | null, categoryName: string | null, vendor: string | null, amounts: Record<string, number>) => ({
  categoryId, categoryName, vendor, income: 0, expenses: 0, investments: 0, ...amounts,
});

describe('stacked income, expense, and investment breakdowns', () => {
  it('preserves signed investment contributions and withdrawals in three distinct stacks', () => {
    const { data, series } = buildSplitBarData([{ date: '2026-09-01', income: 1000, expenses: 30, investments: 750,
      chartBreakdown: [segment(1, 'Salary', 'bank', { income: 1000 }),
        segment(2, 'Groceries', 'card', { expenses: 30 }),
        segment(3, 'Pension', 'bank', { investments: 1000 }),
        segment(4, 'Brokerage', 'bank', { investments: -250 })],
    }], 'subcategory', options);
    expect(new Set(series.map(item => item.flow))).toEqual(new Set(['income', 'expenses', 'investments']));
    expect(data[0].splitDetails.filter(item => item.flow === 'investments').map(item => item.amount)).toEqual([1000, -250]);
    expect(data[0].splitDetails.reduce((sum, item) => sum + (item.flow === 'investments' ? item.amount : 0), 0)).toBe(750);
  });

  it('uses each full stack total once on log scale and keeps currency amounts in tooltips', () => {
    const { data } = buildSplitBarData([{ date: '2026-09-01', income: 3, expenses: 0, investments: -3,
      originalIncome: 1000, originalExpenses: 0, originalInvestments: -1000,
      chartBreakdown: [segment(1, 'Salary', 'bank', { income: 800 }), segment(2, 'Benefits', 'bank', { income: 200 }),
        segment(3, 'Brokerage', 'bank', { investments: -750 }), segment(4, 'Pension', 'bank', { investments: -250 })],
    }], 'subcategory', { ...options, scale: 'log' });
    for (const [flow, total] of [['income', 3], ['investments', -3]] as const) {
      expect(data[0].splitDetails.filter(item => item.flow === flow)
        .reduce((sum, item) => sum + data[0][item.dataKey], 0)).toBeCloseTo(total);
    }
    expect(data[0].splitDetails.find(item => item.label === 'Salary')?.amount).toBe(800);
    expect(data[0].splitDetails.find(item => item.label === 'Brokerage')?.amount).toBe(-750);
  });

  it('fills missing breakdown amounts without attributing them to a known source', () => {
    const { data } = buildSplitBarData([{ date: '2026-09-02', isForecast: true,
      forecastIncome: 100, forecastExpenses: 300, forecastInvestments: 0,
      chartBreakdown: [segment(2, 'Groceries', 'card', { expenses: 125 })],
    }], 'vendor', options);
    expect(data[0].splitDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ flow: 'income', label: 'Unknown vendor', amount: 100 }),
      expect.objectContaining({ flow: 'expenses', label: 'card', amount: 125 }),
      expect.objectContaining({ flow: 'expenses', label: 'Unknown vendor', amount: 175 }),
    ]));
  });

  it('omits gap values and hidden forecasts while keeping the three bar positions', () => {
    const { data, series } = buildSplitBarData([
      { date: '2026-09-01', isInGap: true, income: 100, expenses: 20, investments: 10 },
      { date: '2026-09-02', isForecast: true, forecastIncome: 100, forecastExpenses: 20, forecastInvestments: 10 },
    ], 'subcategory', { ...options, showForecast: false });
    expect(data.every(row => row.splitDetails.length === 0)).toBe(true);
    expect(series.map(item => item.flow)).toEqual(['income', 'expenses', 'investments']);
    expect(series.every(item => !item.isForecast)).toBe(true);
  });

  it('moves paired card expense spending to the repayment source when enabled', () => {
    const breakdown = [segment(1, 'Groceries', 'card', { expenses: 300, pairedCardExpenses: 300 }),
      segment(2, 'Card repayment', 'bank', { pairedCardRepayments: 250 })];
    const defaultView = buildSplitBarData([{ date: '2026-09-01', income: 0, expenses: 300, investments: 0,
      chartBreakdown: breakdown }], 'vendor', options);
    expect(defaultView.data[0].splitDetails).toEqual([expect.objectContaining({ label: 'card', amount: 300 })]);
    const repaymentView = buildSplitBarData([{ date: '2026-09-01', income: 0, expenses: 250, investments: 0,
      chartBreakdown: breakdown }], 'vendor', { ...options, includeCardRepayments: true });
    expect(repaymentView.data[0].splitDetails).toEqual([expect.objectContaining({ label: 'bank', amount: 250 })]);
  });
});
