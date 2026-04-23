import { describe, expect, it } from 'vitest';
import type { InvestmentPosition, PortfolioSummary } from '@renderer/types/investments';
import {
  buildHybridHoldingsPositionRows,
  filterHybridHoldingsPositionRows,
} from '../holdings-positions';

const portfolio: PortfolioSummary = {
  summary: {
    totalPortfolioValue: 2000,
    totalCostBasis: 1850,
    unrealizedGainLoss: 150,
    roi: 8.1,
    totalAccounts: 3,
    accountsWithValues: 2,
    newestUpdateDate: '2026-01-03',
    liquid: {
      totalValue: 1200,
      totalCost: 1000,
      unrealizedGainLoss: 200,
      roi: 20,
      accountsCount: 1,
    },
    restricted: {
      totalValue: 800,
      totalCost: 850,
      unrealizedGainLoss: -50,
      roi: -5.88,
      accountsCount: 1,
    },
  },
  categoryBuckets: {
    cash: {
      totalValue: 0,
      totalCost: 0,
      unrealizedGainLoss: 0,
      roi: 0,
      accountsCount: 1,
      accounts: [],
    },
    liquid: {
      totalValue: 1200,
      totalCost: 1000,
      unrealizedGainLoss: 200,
      roi: 20,
      accountsCount: 1,
      accounts: [],
    },
    restricted: {
      totalValue: 800,
      totalCost: 850,
      unrealizedGainLoss: -50,
      roi: -5.88,
      accountsCount: 1,
      accounts: [],
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
  accounts: [
    {
      id: 1,
      account_name: 'Brokerage',
      account_type: 'brokerage',
      investment_category: 'liquid',
      institution: 'Demo Broker',
      currency: 'ILS',
      current_value: 1200,
      cost_basis: 1000,
      as_of_date: '2026-01-03',
      assets: [{ asset_name: 'Core ETF', asset_type: 'etf', current_value: 1200, cost_basis: 1000 }],
    },
    {
      id: 2,
      account_name: 'Retirement',
      account_type: 'pension',
      investment_category: 'restricted',
      institution: 'Demo Pension',
      currency: 'ILS',
      current_value: 800,
      cost_basis: 850,
      as_of_date: '2026-01-02',
      assets: [{ asset_name: 'Pension Basket', asset_type: 'fund', current_value: 800, cost_basis: 850 }],
    },
    {
      id: 3,
      account_name: 'Cash Reserve',
      account_type: 'bank_balance',
      investment_category: 'cash',
      institution: 'Demo Bank',
      currency: 'ILS',
      current_value: null as unknown as number,
      cost_basis: 0,
      as_of_date: null,
      assets: [],
    },
  ],
  liquidAccounts: [],
  restrictedAccounts: [],
};

const positions: InvestmentPosition[] = [
  {
    id: 55,
    account_id: 1,
    account_name: 'Brokerage',
    account_type: 'brokerage',
    investment_category: 'liquid',
    institution: 'Demo Broker',
    position_name: 'Core ETF Position',
    asset_type: 'etf',
    currency: 'ILS',
    status: 'open',
    opened_at: '2026-01-01',
    original_cost_basis: 1000,
    open_cost_basis: 1000,
    current_value: 1200,
    updated_at: '2026-01-03',
  },
];

describe('holdings-positions utilities', () => {
  it('prefers open positions over fallback account rows and sorts by current value', () => {
    const rows = buildHybridHoldingsPositionRows(portfolio, positions);

    expect(rows.map((row) => row.rowId)).toEqual([
      'position-55',
      'holding-2',
      'holding-3',
    ]);
    expect(rows.find((row) => row.rowId === 'holding-1')).toBeUndefined();
  });

  it('builds fallback holding rows with asset naming and needs-valuation status', () => {
    const rows = buildHybridHoldingsPositionRows(portfolio, positions);

    expect(rows.find((row) => row.rowId === 'holding-2')).toMatchObject({
      name: 'Pension Basket',
      rowKind: 'holding',
      category: 'restricted',
      status: 'valued',
      unrealizedPnL: -50,
    });
    expect(rows.find((row) => row.rowId === 'holding-3')).toMatchObject({
      name: 'Cash Reserve',
      category: 'cash',
      status: 'needs_valuation',
      currentValue: null,
    });
  });

  it('filters rows by category, row kind, and search text', () => {
    const rows = buildHybridHoldingsPositionRows(portfolio, positions);

    expect(
      filterHybridHoldingsPositionRows(rows, {
        search: '',
        category: 'restricted',
        rowKind: 'all',
      }).map((row) => row.rowId),
    ).toEqual(['holding-2']);

    expect(
      filterHybridHoldingsPositionRows(rows, {
        search: '',
        category: 'all',
        rowKind: 'holding',
      }).map((row) => row.rowId),
    ).toEqual(['holding-2', 'holding-3']);

    expect(
      filterHybridHoldingsPositionRows(rows, {
        search: 'cash reserve',
        category: 'all',
        rowKind: 'all',
      }).map((row) => row.rowId),
    ).toEqual(['holding-3']);
  });
});
