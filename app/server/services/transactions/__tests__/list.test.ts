import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as transactionsList from '../list.js';
import { useSqlite } from '../../../../lib/sql-dialect.js';

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
    if (useSqlite) {
      expect(String(sql)).toContain('transactions_fts MATCH $1');
      expect(String(sql)).toContain('LOWER(t.memo) LIKE LOWER($2)');
      expect(params[0]).toContain('chips');
      expect(params[1]).toBe('%chips%');
      expect(params.slice(2)).toEqual(['Food', 'shop', '2025-02-01', '2025-02-28', 10]);
    } else {
      expect(String(sql)).toContain('LOWER(t.memo) LIKE LOWER($1)');
      expect(params).toEqual(['%chips%', 'Food', 'shop', '2025-02-01', '2025-02-28', 10]);
    }
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
    if (useSqlite) {
      expect(String(sql)).toContain('transactions_fts MATCH $1');
      expect(String(sql)).toContain('LOWER(t.memo) LIKE LOWER($2)');
      expect(params[0]).toContain('foo');
      expect(params[1]).toBe('%foo%');
      expect(params[2]).toBe(100);
    } else {
      expect(String(sql)).toContain('LOWER(t.memo) LIKE LOWER($1)');
      expect(params).toEqual(['%foo%', 100]);
    }
  });

  it('throws when limit is invalid', async () => {
    await expect(
      transactionsList.searchTransactions({ query: 'chips', limit: 'abc' as any, month: '2025-02' }),
    ).rejects.toThrow('Invalid limit parameter');
  });

  it('listRecentTransactions parses array tags and ignores malformed tags json', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'txn-tags-1',
          vendor: 'v1',
          tags: '["groceries","weekly"]',
          price: '10',
          date: '2025-02-01',
          processed_date: '2025-02-01',
        },
        {
          identifier: 'txn-tags-2',
          vendor: 'v2',
          tags: '{bad-json',
          price: '4.5',
          date: '2025-02-01',
          processed_date: '2025-02-01',
        },
        {
          identifier: 'txn-tags-3',
          vendor: 'v3',
          tags: '"single-string"',
          price: '6.7',
          date: '2025-02-01',
          processed_date: '2025-02-01',
        },
      ],
    });

    const result = await transactionsList.listRecentTransactions({ limit: 10, offset: 0 });

    expect(result.hasMore).toBe(false);
    expect(result.transactions[0].tags).toEqual(['groceries', 'weekly']);
    expect(result.transactions[1].tags).toEqual([]);
    expect(result.transactions[2].tags).toEqual([]);
  });

  it('searchTransactions supports numeric category id filtering', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ identifier: 'txn3', price: '-12.5', tags: '[]', date: '2025-02-03' }],
    });

    await transactionsList.searchTransactions({
      category: '123',
      vendor: 'max',
      limit: 20,
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('t.category_definition_id =');
    expect(params).toContain(123);
    expect(params).toContain('max');
    expect(params[params.length - 1]).toBe(20);
  });

  it('searchTransactions works without text query and returns parsed tags', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'txn-no-query',
          vendor: 'shop',
          tags: '["a","b"]',
          price: '-33.9',
          date: '2025-02-05',
          processed_date: '2025-02-05',
        },
      ],
    });

    const result = await transactionsList.searchTransactions({
      vendor: 'shop',
      startDate: '2025-02-01',
      endDate: '2025-02-28',
      limit: 5,
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('WHERE');
    expect(String(sql)).toContain('t.vendor =');
    expect(result.transactions[0].tags).toEqual(['a', 'b']);
    expect(params[params.length - 1]).toBe(5);
  });

  it('getAllTags returns unique sorted tags from all rows', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { tags: '["food","weekly"]' },
        { tags: '["food","home"]' },
        { tags: '[]' },
      ],
    });

    const tags = await transactionsList.getAllTags();

    expect(tags).toEqual(['food', 'home', 'weekly']);
  });

  it('getAllTags ignores malformed JSON entries', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ tags: '["ok"]' }, { tags: '{bad-json' }, { tags: '["later"]' }],
    });

    const tags = await transactionsList.getAllTags();

    expect(tags).toEqual(['later', 'ok']);
  });

  it('getAllTags returns empty list when tags column is missing in sqlite', async () => {
    const err = new Error('no such column: tags') as Error & { code?: string };
    err.code = 'SQLITE_ERROR';
    queryMock.mockRejectedValueOnce(err);

    await expect(transactionsList.getAllTags()).resolves.toEqual([]);
  });

  it('getAllTags rethrows non-schema query errors', async () => {
    const err = new Error('db offline') as Error & { code?: string };
    err.code = 'SQLITE_BUSY';
    queryMock.mockRejectedValueOnce(err);

    await expect(transactionsList.getAllTags()).rejects.toThrow('db offline');
  });
});
