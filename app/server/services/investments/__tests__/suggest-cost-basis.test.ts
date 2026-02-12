import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let suggestService: any;
let suggestCostBasis: (params?: Record<string, unknown>) => Promise<any>;

beforeAll(async () => {
  const module = await import('../suggest-cost-basis.js');
  suggestService = module.default ?? module;
  suggestCostBasis = module.suggestCostBasis;
});

beforeEach(() => {
  queryMock.mockReset();
  suggestService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  suggestService.__resetDatabase();
});

describe('suggest cost basis service', () => {
  it('requires account_id or account_name', async () => {
    await expect(suggestCostBasis({})).rejects.toMatchObject({ status: 400 });
  });

  it('returns 404 when account is not found', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(suggestCostBasis({ account_id: 123 })).rejects.toMatchObject({ status: 404 });
  });

  it('uses account_id lookup and computes deposits, withdrawals, and suggested basis', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 7,
            account_name: 'Retirement',
            account_type: 'pension',
            cost_basis: '1000',
            as_of_date: '2025-01-01',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'txn-1',
            vendor: 'leumi',
            name: 'pension deposit',
            price: '-100',
            date: '2025-01-10',
            category_type: 'investment',
          },
          {
            identifier: 'txn-2',
            vendor: 'leumi',
            name: 'pension withdrawal',
            price: '25',
            date: '2025-01-15',
            category_type: 'investment',
          },
        ],
      });

    const result = await suggestCostBasis({ account_id: 7 });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [accountSql, accountParams] = queryMock.mock.calls[0];
    const [txnSql, txnParams] = queryMock.mock.calls[1];

    expect(accountSql).toContain('WHERE ia.id = $1');
    expect(accountParams).toEqual([7]);
    expect(txnSql).toContain("category_type = 'investment'");
    expect(txnParams[0]).toBe('2025-01-01');
    expect(txnParams.length).toBeGreaterThan(1);

    expect(result.account).toMatchObject({
      account_id: 7,
      account_name: 'Retirement',
      account_type: 'pension',
      current_cost_basis: 1000,
    });
    expect(result.suggestion).toMatchObject({
      has_new_transactions: true,
      transaction_count: 2,
      deposits_count: 1,
      withdrawals_count: 1,
      total_deposits: 100,
      total_withdrawals: 25,
      net_flow: 75,
      suggested_cost_basis: 1075,
      increase: 75,
    });
    expect(result.transactions.deposits[0]).toMatchObject({ absoluteAmount: 100 });
  });

  it('uses account_name lookup when account_id is missing', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 18,
            account_name: 'Main Brokerage',
            account_type: 'brokerage',
            cost_basis: '2500',
            as_of_date: '2024-12-31',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await suggestCostBasis({ account_name: 'Main Brokerage' });

    const [accountSql, accountParams] = queryMock.mock.calls[0];
    expect(accountSql).toContain('WHERE LOWER(ia.account_name) = LOWER($1)');
    expect(accountParams).toEqual(['Main Brokerage']);
    expect(result.suggestion.has_new_transactions).toBe(false);
    expect(result.suggestion.suggested_cost_basis).toBe(2500);
  });

  it('falls back to account name pattern and default date when matcher returns no type patterns', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 9,
            account_name: 'My Custom Portfolio',
            account_type: 'unmapped_type',
            cost_basis: null,
            as_of_date: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await suggestCostBasis({ account_id: 9 });

    const [, txnParams] = queryMock.mock.calls[1];
    expect(txnParams[0]).toBe('1900-01-01');
    expect(txnParams).toContain('%my custom portfolio%');
    expect(result.account.current_cost_basis).toBe(0);
    expect(result.suggestion.suggested_cost_basis).toBe(0);
  });

  it('falls back to generic investment pattern when both type patterns and account name are unavailable', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 10,
            account_name: null,
            account_type: 'unknown_type',
            cost_basis: '0',
            as_of_date: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await suggestCostBasis({ account_id: 10 });

    const [, txnParams] = queryMock.mock.calls[1];
    expect(txnParams).toContain('%investment%');
  });
});
