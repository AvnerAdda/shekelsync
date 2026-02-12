import { describe, expect, it } from 'vitest';
import {
  formatSignedCurrencyValue,
  formatSignedPercent,
  hasPortfolioAccounts,
} from '../investments-summary-helpers';

describe('InvestmentsSummarySection helpers', () => {
  it('detects when portfolio summary has accounts to render', () => {
    expect(hasPortfolioAccounts(null)).toBe(false);
    expect(hasPortfolioAccounts({ summary: { totalAccounts: 0 } } as any)).toBe(false);
    expect(hasPortfolioAccounts({ summary: { totalAccounts: 2 } } as any)).toBe(true);
  });

  it('formats signed percentages and currency values', () => {
    expect(formatSignedPercent(10.256)).toBe('+10.26%');
    expect(formatSignedPercent(-3.1)).toBe('-3.10%');

    const mockFormatter = (amount: number) => `₪${Math.abs(amount).toFixed(0)}`;
    expect(formatSignedCurrencyValue(500, mockFormatter)).toBe('+₪500');
    expect(formatSignedCurrencyValue(-125, mockFormatter)).toBe('-₪125');
  });
});
