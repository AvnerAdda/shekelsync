import { describe, expect, it } from 'vitest';
import type { InvestmentPerformanceTimelinePoint } from '@renderer/types/investments';
import { calculateModifiedDietzSeries } from '../PortfolioValuePanel';

function point(
  date: string,
  currentValue: number,
  contributions = 0,
): InvestmentPerformanceTimelinePoint {
  return {
    date,
    currentValue,
    costBasis: 0,
    contributions,
    withdrawals: 0,
    capitalReturns: 0,
    income: 0,
    fees: 0,
    taxes: 0,
    valueChange: 0,
    marketMove: 0,
    netFlow: contributions,
  };
}

describe('calculateModifiedDietzSeries', () => {
  it('plots the same time-weighted cash-flow estimate used by the sparse-history return', () => {
    const result = calculateModifiedDietzSeries([
      point('2026-01-01', 1_000),
      point('2026-01-06', 1_100, 100),
      point('2026-01-11', 1_150),
    ]);

    expect(result[0]).toBe(0);
    expect(result[2]).toBeCloseTo(4.76190476, 6);
  });

  it('returns no estimate when the weighted capital base is not positive', () => {
    const result = calculateModifiedDietzSeries([
      { ...point('2026-01-01', 100), withdrawals: 200, netFlow: -200 },
      point('2026-01-11', 0),
    ]);

    expect(result[1]).toBeNull();
  });
});
