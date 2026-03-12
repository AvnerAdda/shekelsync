import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const getInvestmentHistoryMock = vi.fn();

let performanceService: any;
let getInvestmentPerformance: (params?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  queryMock.mockReset();
  getInvestmentHistoryMock.mockReset();

  const module = await import('../performance.js');
  performanceService = module.default ?? module;
  getInvestmentPerformance = module.getInvestmentPerformance;

  performanceService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
  performanceService.__setHistoryService({
    getInvestmentHistory: (...args: any[]) => getInvestmentHistoryMock(...args),
  });
});

afterEach(() => {
  performanceService.__resetDatabase();
});

describe('investment performance service', () => {
  it('returns an empty payload when history is empty', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [],
      accounts: [],
    });

    const result = await getInvestmentPerformance({ range: '1m' });

    expect(result).toMatchObject({
      range: '1m',
      valueChange: 0,
      marketMove: 0,
      timeline: [],
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('separates contributions, capital returns, income, and market move', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        { date: '2026-03-01', currentValue: 1000, costBasis: 1000 },
        { date: '2026-03-02', currentValue: 1550, costBasis: 1500 },
        { date: '2026-03-03', currentValue: 1490, costBasis: 1400 },
      ],
      accounts: [{ accountId: 7, history: [] }],
    });

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'dep-1',
            vendor: 'broker',
            date: '2026-03-02',
            name: 'Monthly deposit',
            price: '-500',
            category_type: 'investment',
            is_counted_as_income: 1,
          },
          {
            identifier: 'ret-1',
            vendor: 'bank',
            date: '2026-03-03',
            name: 'Pikadon return',
            price: '60',
            category_type: 'investment',
            is_counted_as_income: 1,
          },
          {
            identifier: 'income-1',
            vendor: 'bank',
            date: '2026-03-03',
            name: 'Investment Interest',
            price: '10',
            category_type: 'income',
            category_name_en: 'Investment Interest',
            is_counted_as_income: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            return_transaction_id: 'ret-1',
            return_transaction_vendor: 'bank',
            cost_basis: '50',
            interest_amount: '10',
          },
        ],
      });

    const result = await getInvestmentPerformance({ range: '1m' });

    expect(getInvestmentHistoryMock).toHaveBeenCalledWith({
      timeRange: '1m',
      includeAccounts: true,
    });
    expect(queryMock.mock.calls[0][0]).toContain('tal.account_id IN ($1)');
    expect(queryMock.mock.calls[0][1]).toEqual([7, '2026-03-01', '2026-03-03']);
    expect(result.startValue).toBe(1000);
    expect(result.endValue).toBe(1490);
    expect(result.valueChange).toBe(490);
    expect(result.netFlows).toEqual({
      contributions: 500,
      withdrawals: 0,
      netContributions: 500,
    });
    expect(result.capitalReturns).toBe(50);
    expect(result.income).toBe(20);
    expect(result.marketMove).toBe(60);
    expect(result.timeline).toHaveLength(3);
    expect(result.timeline[1]).toMatchObject({
      date: '2026-03-02',
      contributions: 500,
    });
    expect(result.timeline[2]).toMatchObject({
      date: '2026-03-03',
      capitalReturns: 50,
      income: 20,
    });
    expect(typeof result.twr).toBe('number');
  });

  it('skips flow queries when history does not expose linked investment accounts', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        { date: '2026-03-01', currentValue: 1000, costBasis: 1000 },
        { date: '2026-03-03', currentValue: 1100, costBasis: 1000 },
      ],
      accounts: [],
    });

    const result = await getInvestmentPerformance({ range: '1m' });

    expect(queryMock).not.toHaveBeenCalled();
    expect(result.netFlows).toEqual({
      contributions: 0,
      withdrawals: 0,
      netContributions: 0,
    });
    expect(result.marketMove).toBe(100);
  });
});
