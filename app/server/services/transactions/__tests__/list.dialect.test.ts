import { afterEach, describe, expect, it, vi } from 'vitest';

const originalUseSqlite = process.env.USE_SQLITE;

async function loadService(useSqlite: boolean) {
  vi.resetModules();
  process.env.USE_SQLITE = useSqlite ? 'true' : 'false';
  const module = await import('../list.js');
  return module.default ?? module;
}

afterEach(() => {
  process.env.USE_SQLITE = originalUseSqlite;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('transactions list service dialect branches', () => {
  it('uses non-FTS SQL branch when sqlite mode is disabled', async () => {
    const service = await loadService(false);
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          identifier: 'txn-pg-1',
          vendor: 'vendor',
          memo: 'chips',
          tags: '[]',
          price: '-18.3',
          date: '2026-02-10',
          processed_date: '2026-02-10',
        },
      ],
    });

    service.__setDatabase({ query: queryMock });

    const result = await service.searchTransactions({ query: 'chips', limit: 5 });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).not.toContain('transactions_fts MATCH');
    expect(String(sql)).toContain('LOWER(t.memo) LIKE LOWER($1)');
    expect(params).toEqual(['%chips%', 5]);
    expect(result.transactions[0].price).toBe(-18.3);

    service.__resetDatabase?.();
  });

  it('falls back to LIKE search in sqlite when prepared FTS query is empty', async () => {
    const service = await loadService(true);
    const queryMock = vi.fn().mockResolvedValue({
      rows: [
        {
          identifier: 'txn-sqlite-1',
          vendor: 'vendor',
          memo: 'wildcard',
          tags: '[]',
          price: '4',
          date: '2026-02-10',
          processed_date: '2026-02-10',
        },
      ],
    });

    service.__setDatabase({ query: queryMock });

    await service.searchTransactions({ query: '***', limit: 3 });

    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).not.toContain('transactions_fts MATCH');
    expect(String(sql)).toContain('LOWER(t.memo) LIKE LOWER($1)');
    expect(params).toEqual(['%***%', 3]);

    service.__resetDatabase?.();
  });

  it('applies integer fallbacks for empty limit/offset values', async () => {
    const service = await loadService(true);
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });

    service.__setDatabase({ query: queryMock });

    const result = await service.listRecentTransactions({ limit: '', offset: '' });

    expect(queryMock.mock.calls[0][1]).toEqual([50, 0]);
    expect(result).toEqual({ transactions: [], count: 0, hasMore: false });

    service.__resetDatabase?.();
  });
});
