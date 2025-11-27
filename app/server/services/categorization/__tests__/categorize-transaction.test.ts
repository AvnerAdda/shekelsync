import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  categorizeTransaction,
  bulkCategorizeTransactions,
  __setDatabase,
  __setResolveCategory,
  __resetDependencies,
} from '../categorize-transaction.js';

describe('categorize-transaction service', () => {
  let client: any;

  beforeEach(() => {
    client = {
      query: vi.fn(),
      release: vi.fn(),
    };
    __setDatabase({ getClient: vi.fn().mockResolvedValue(client) } as any);
  });

  afterEach(() => {
    __resetDependencies();
  });

  it('rejects missing transaction_name', async () => {
    await expect(categorizeTransaction({} as any)).rejects.toMatchObject({ status: 400 });
    expect(client.release).toHaveBeenCalled();
  });

  it('returns suggestion when no transactionId provided', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name_pattern: 'coffee',
          category_definition_id: 2,
          subcategory: 'Coffee',
          parent_category: 'Food',
          priority: 1,
        },
      ],
    });

    const res = await categorizeTransaction({ transaction_name: 'Coffee shop' } as any);

    expect(res.success).toBe(true);
    expect(res.best_match.pattern).toBe('coffee');
    expect(client.release).toHaveBeenCalled();
  });

  it('updates transaction when id and vendor provided', async () => {
    client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name_pattern: 'grocery',
            category_definition_id: null,
            subcategory: null,
            parent_category: 'Food',
            priority: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'txn1' }], rowCount: 1 });

    __setResolveCategory(() =>
      Promise.resolve({
        categoryDefinitionId: 10,
        parentCategory: 'Food',
        subcategory: 'Groceries',
      }),
    );

    const res = await categorizeTransaction({
      transaction_name: 'Grocery run',
      transaction_id: 'txn1',
      vendor: 'test-vendor',
    } as any);

    expect(res.success).toBe(true);
    expect(res.transaction.id).toBe('txn1');
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('bulkCategorizeTransactions applies patterns and counts updates', async () => {
    client.query
      .mockResolvedValueOnce({
        rows: [
          {
            name_pattern: 'netflix',
            category_definition_id: null,
            subcategory: null,
            parent_category: 'Entertainment',
            priority: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 3 });

    __setResolveCategory(() =>
      Promise.resolve({
        categoryDefinitionId: 5,
        parentCategory: 'Entertainment',
        subcategory: 'Streaming',
      }),
    );

    const res = await bulkCategorizeTransactions();

    expect(res.transactionsUpdated).toBe(3);
    expect(res.patternsApplied).toBe(1);
    expect(client.release).toHaveBeenCalled();
  });
});
