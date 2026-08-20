import { describe, expect, it } from 'vitest';
import {
  accountMatchesPortfolioScope,
  getPortfolioAccountsForScope,
  getPortfolioCategoryBucketsForScope,
  getPortfolioScopeTotal,
  INVESTMENT_CATEGORY_ORDER,
  normalizeInvestmentCategory,
} from '../portfolio-categories';
import type { PortfolioSummary } from '@renderer/types/investments';

describe('portfolio category utilities', () => {
  it('includes illiquid in the display order', () => {
    expect(INVESTMENT_CATEGORY_ORDER).toEqual([
      'cash',
      'liquid',
      'illiquid',
      'restricted',
      'stability',
      'other',
    ]);
  });

  it('does not turn a missing converted account value into a partial allocation total', () => {
    const portfolio = {
      accounts: [
        { id: 1, account_name: 'Cash', account_type: 'cash', investment_category: 'cash', current_value: 100 },
        {
          id: 2,
          account_name: 'USD brokerage',
          account_type: 'brokerage',
          investment_category: 'liquid',
          native_current_value: 50,
          current_value: null,
        },
      ],
    } as PortfolioSummary;

    expect(getPortfolioScopeTotal(portfolio, 'all')).toBeNull();
    const liquid = getPortfolioCategoryBucketsForScope(portfolio, 'all')
      .find(({ key }) => key === 'liquid');
    expect(liquid?.bucket.totalValue).toBeNull();
  });

  it('normalizes real estate account types to illiquid', () => {
    expect(normalizeInvestmentCategory('liquid', 'real_estate')).toBe('illiquid');
    expect(normalizeInvestmentCategory(null, 'real_estate')).toBe('illiquid');
  });

  it('filters accounts and totals by portfolio scope', () => {
    const portfolio = {
      categoryBuckets: {
        cash: {
          accounts: [
            { id: 1, account_name: 'Cash', account_type: 'bank_balance', investment_category: 'cash', current_value: 100 },
          ],
        },
        liquid: {
          accounts: [
            { id: 2, account_name: 'Brokerage', account_type: 'brokerage', investment_category: 'liquid', current_value: 300 },
          ],
        },
        illiquid: {
          accounts: [
            { id: 3, account_name: 'Property', account_type: 'real_estate', investment_category: 'illiquid', current_value: 700 },
          ],
        },
        restricted: {
          accounts: [
            { id: 4, account_name: 'Pension', account_type: 'pension', investment_category: 'restricted', current_value: 400 },
          ],
        },
        stability: { accounts: [] },
        other: { accounts: [] },
      },
    } as PortfolioSummary;

    expect(accountMatchesPortfolioScope(portfolio.categoryBuckets.illiquid.accounts[0], 'exclude_real_estate')).toBe(false);
    expect(getPortfolioAccountsForScope(portfolio, 'exclude_real_estate').map((account) => account.id)).toEqual([1, 2, 4]);
    expect(getPortfolioScopeTotal(portfolio, 'exclude_real_estate')).toBe(800);
    expect(getPortfolioScopeTotal(portfolio, 'all')).toBe(1500);
    expect(getPortfolioAccountsForScope(portfolio, 'restricted').map((account) => account.id)).toEqual([4]);
  });
});
