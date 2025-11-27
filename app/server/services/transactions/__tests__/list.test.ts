import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as transactionsList from '../list.js';

const queryMock = vi.fn();
const mockDb = { query: queryMock };

describe('transactions list service', () => {
  beforeEach(() => {
    queryMock.mockReset();
    transactionsList.__setDatabase(mockDb as any);
  });

  afterEach(() => {
    transactionsList.__resetDatabase();
  });

  it('returns recent transactions with numeric prices', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'txn1',
          vendor: 'v1',
          category: 'Food',
          parent_category: 'Household',
          memo: 'note',
          price: '12.34',
          date: '2025-02-01',
          processed_date: '2025-02-02',
          account_number: '123',
          type: 'expense',
          status: 'completed',
        },
      ],
    });

    const result = await transactionsList.listRecentTransactions({ limit: 1, offset: 0 });

    expect(result.transactions[0].price).toBe(12.34);
    expect(result.count).toBe(1);
    expect(result.hasMore).toBe(true); // equals limit, so may have more
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('searchTransactions enforces numeric limit and applies filters', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { identifier: 'txn2', vendor: 'shop', category: 'Food', memo: 'chips', price: '-5', date: '2025-02-03' },
      ],
    });

    const result = await transactionsList.searchTransactions({
      query: 'chips',
      category: 'Food',
      vendor: 'shop',
      startDate: '2025-02-01',
      endDate: '2025-02-28',
      limit: 10,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('WHERE memo ILIKE');
    expect(params).toEqual(['%chips%', 'Food', 'shop', '2025-02-01', '2025-02-28', 10]);
    expect(result.transactions[0].price).toBe(-5);
  });

  it('searchTransactions supports all=true without category filter', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await transactionsList.searchTransactions({ month: '2025-01', all: true, limit: 5 });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('WHERE');
    expect(params).toEqual([5]);
  });

  it('listRecentTransactions throws on invalid limit', async () => {
    await expect(transactionsList.listRecentTransactions({ limit: 'oops' as any })).rejects.toThrow(
      'Invalid limit parameter',
    );
  });

  it('listRecentTransactions throws on invalid offset', async () => {
    await expect(transactionsList.listRecentTransactions({ offset: 'oops' as any })).rejects.toThrow(
      'Invalid offset parameter',
    );
  });

  it('searchTransactions works with only text query', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ identifier: 't-1', memo: 'foo', price: '0', date: '2025-02-10' }],
    });

    const result = await transactionsList.searchTransactions({
      month: '2025-02',
      query: 'foo',
    } as any);

    expect(result.transactions).toHaveLength(1);
    expect(result.searchQuery).toBe('foo');
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('memo ILIKE');
    expect(params).toEqual(['%foo%', 100]);
  });

  it('throws when limit is invalid', async () => {
    await expect(
      transactionsList.searchTransactions({ query: 'chips', limit: 'abc' as any, month: '2025-02' }),
    ).rejects.toThrow('Invalid limit parameter');
  });
});
