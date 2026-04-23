import { describe, expect, it } from 'vitest';
import type { PortfolioHistoryPoint, PortfolioSummary } from '@renderer/types/investments';
import { buildStackedPortfolioHistoryData } from '../portfolio-history';

const portfolio: PortfolioSummary = {
  summary: {
    totalPortfolioValue: 320,
    totalCostBasis: 300,
    unrealizedGainLoss: 20,
    roi: 6.67,
    totalAccounts: 2,
    accountsWithValues: 2,
    newestUpdateDate: '2026-01-03',
    liquid: {
      totalValue: 120,
      totalCost: 110,
      unrealizedGainLoss: 10,
      roi: 9.09,
      accountsCount: 1,
    },
    restricted: {
      totalValue: 200,
      totalCost: 190,
      unrealizedGainLoss: 10,
      roi: 5.26,
      accountsCount: 1,
    },
  },
  categoryBuckets: {
    cash: {
      totalValue: 120,
      totalCost: 110,
      unrealizedGainLoss: 10,
      roi: 9.09,
      accountsCount: 1,
      accounts: [
        {
          id: 1,
          account_name: 'Cash Account',
          account_type: 'bank_balance',
          investment_category: 'cash',
          institution: 'Demo Bank',
          currency: 'ILS',
          current_value: 120,
          cost_basis: 110,
          as_of_date: '2026-01-03',
          assets: [],
        },
      ],
    },
    liquid: {
      totalValue: 0,
      totalCost: 0,
      unrealizedGainLoss: 0,
      roi: 0,
      accountsCount: 0,
      accounts: [],
    },
    restricted: {
      totalValue: 200,
      totalCost: 190,
      unrealizedGainLoss: 10,
      roi: 5.26,
      accountsCount: 1,
      accounts: [
        {
          id: 2,
          account_name: 'Retirement Account',
          account_type: 'pension',
          investment_category: 'restricted',
          institution: 'Demo Pension',
          currency: 'ILS',
          current_value: 200,
          cost_basis: 190,
          as_of_date: '2026-01-02',
          assets: [],
        },
      ],
    },
    stability: {
      totalValue: 0,
      totalCost: 0,
      unrealizedGainLoss: 0,
      roi: 0,
      accountsCount: 0,
      accounts: [],
    },
    other: {
      totalValue: 0,
      totalCost: 0,
      unrealizedGainLoss: 0,
      roi: 0,
      accountsCount: 0,
      accounts: [],
    },
  },
  breakdown: [],
  timeline: [],
  accounts: [],
  liquidAccounts: [],
  restrictedAccounts: [],
};

const accountHistories: Record<number, PortfolioHistoryPoint[]> = {
  1: [
    { date: '2026-01-01', currentValue: 100, costBasis: 100 },
    { date: '2026-01-03', currentValue: 120, costBasis: 110 },
  ],
  2: [
    { date: '2026-01-02', currentValue: 200, costBasis: 190 },
  ],
};

describe('portfolio-history utilities', () => {
  it('carries forward last known values instead of dropping missing dates to zero', () => {
    const result = buildStackedPortfolioHistoryData(portfolio, accountHistories);

    expect(result.orderedAccounts.map((account) => account.id)).toEqual([1, 2]);
    expect(result.sortedDates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(result.data.map((point) => ({
      fullDate: point.fullDate,
      first: point['1'],
      second: point['2'],
    }))).toEqual([
      { fullDate: '2026-01-01', first: 100, second: 0 },
      { fullDate: '2026-01-02', first: 100, second: 200 },
      { fullDate: '2026-01-03', first: 120, second: 200 },
    ]);
  });
});
