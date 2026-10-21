import { describe, expect, it } from 'vitest';
import { buildRollingCashflow } from '../rolling-cashflow';

describe('buildRollingCashflow', () => {
  it('includes 30 calendar days, fills gaps and drops activity exactly when it leaves the window', () => {
    const points = buildRollingCashflow([
      { date: '2026-08-02', income: 9999, expenses: 9999, investments: 9999 },
      { date: '2026-08-03', income: 100, expenses: 50, investments: 20 },
      { date: '2026-09-01', income: 200, expenses: 75, investments: 30 },
      { date: '2026-09-03', income: 0, expenses: -10, investments: -70 },
    ], '2026-09-01', '2026-09-03');
    expect(points).toEqual([
      { date: '2026-09-01', windowStart: '2026-08-03', income: 10, expenses: 125 / 30, investments: 50 / 30 },
      { date: '2026-09-02', windowStart: '2026-08-04', income: 200 / 30, expenses: 2.5, investments: 1 },
      { date: '2026-09-03', windowStart: '2026-08-05', income: 200 / 30, expenses: 65 / 30, investments: -40 / 30 },
    ]);
  });

  it('averages over all 30 days even when only one day has activity', () => {
    const [point] = buildRollingCashflow([
      { date: '2026-09-01', income: 9000, expenses: 3000, investments: 1500 },
    ], '2026-09-01', '2026-09-01');
    expect(point).toMatchObject({ income: 300, expenses: 100, investments: 50 });
  });

  it('excludes card repayments and capital returns while preserving net refunds and cents', () => {
    const points = buildRollingCashflow([
      { date: '2026-09-01', income: 0.1, expenses: 150, cardRepayments: 150, capitalReturns: 1000, investments: -0.1 },
      { date: '2026-09-02', income: 0.2, expenses: -20.25, investments: -0.2 },
      { date: '2026-09-03', income: null, expenses: null, investments: null },
    ], '2026-09-01', '2026-09-03');
    expect(points.at(-1)!.income).toBeCloseTo(0.01);
    expect(points.at(-1)!.expenses).toBeCloseTo(-0.675);
    expect(points.at(-1)!.investments).toBeCloseTo(-0.01);
  });

  it('handles leap days and year boundaries using calendar days', () => {
    expect(buildRollingCashflow([], '2024-03-01', '2024-03-01')[0].windowStart).toBe('2024-02-01');
    expect(buildRollingCashflow([], '2026-01-01', '2026-01-01')[0].windowStart).toBe('2025-12-03');
  });

  it('follows the chart options for capital returns and paired card repayments', () => {
    const history = [{ date: '2026-09-01', income: 100, capitalReturns: 50, expenses: 300,
      cardRepayments: 200, pairedCardExpenses: 100, pairedCardRepayments: 200, investments: -20 }];
    expect(buildRollingCashflow(history, '2026-09-01', '2026-09-01')[0])
      .toMatchObject({ income: 100 / 30, expenses: 100 / 30, investments: -20 / 30 });
    expect(buildRollingCashflow(history, '2026-09-01', '2026-09-01', { includeCardRepayments: true, includeCapitalReturns: true })[0])
      .toMatchObject({ income: 5, expenses: 400 / 30, investments: -20 / 30 });
  });
});
