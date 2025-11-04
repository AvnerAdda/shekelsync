import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../categorization/categorize-transaction.js');

const getClientMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const resolveCategoryMock = vi.fn();

let service: any;

beforeAll(async () => {
  const module = await modulePromise;
  service = module.default ?? module;
});

beforeEach(() => {
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  resolveCategoryMock.mockReset();
  getClientMock.mockReset();
  getClientMock.mockResolvedValue({
    query: clientQueryMock,
    release: releaseMock,
  });

  service.__setDatabase({
    getClient: getClientMock,
  });
  service.__setResolveCategory(resolveCategoryMock);
});

afterEach(() => {
  service.__resetDependencies?.();
});

describe('categorizeTransaction', () => {
  it('rejects when transaction_name is missing', async () => {
    clientQueryMock.mockResolvedValue({ rows: [] });

    await expect(service.categorizeTransaction({})).rejects.toMatchObject({ status: 400 });
    expect(getClientMock).toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalled();
  });

  it('returns no suggestions when no matches found', async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    const result = await service.categorizeTransaction({ transaction_name: 'Unknown Vendor' });

    expect(result.success).toBe(false);
    expect(result.suggestions).toEqual([]);
    expect(releaseMock).toHaveBeenCalled();
  });

  it('updates transaction when match exists with definition', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name_pattern: 'NETFLIX',
            category_definition_id: 10,
            subcategory: 'Streaming',
            parent_category: 'Entertainment',
            priority: 5,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'NETFLIX',
            category_definition_id: 10,
          },
        ],
        rowCount: 1,
      });

    const result = await service.categorizeTransaction({
      transaction_name: 'Netflix Payment',
      transaction_id: 'tx-1',
      vendor: 'NETFLIX',
    });

    expect(result.success).toBe(true);
    expect(result.match.category_definition_id).toBe(10);
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    expect(resolveCategoryMock).not.toHaveBeenCalled();
  });

  it('resolves category when rule lacks definition', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name_pattern: 'POWER',
            category_definition_id: null,
            subcategory: 'Electricity',
            parent_category: 'Utilities',
            priority: 3,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'tx-2',
            vendor: 'Electric Company',
            category_definition_id: 55,
          },
        ],
        rowCount: 1,
      });

    resolveCategoryMock.mockResolvedValueOnce({
      categoryDefinitionId: 55,
      parentCategory: 'Utilities',
      subcategory: 'Electricity',
    });

    const result = await service.categorizeTransaction({
      transaction_name: 'Power Company Bill',
      transaction_id: 'tx-2',
      vendor: 'Electric Company',
    });

    expect(resolveCategoryMock).toHaveBeenCalled();
    expect(result.match.category_definition_id).toBe(55);
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
  });

  it('returns suggestions without updating when transaction id missing', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name_pattern: 'SPOTIFY',
          category_definition_id: null,
          subcategory: 'Subscriptions',
          parent_category: 'Entertainment',
          priority: 2,
        },
      ],
    });

    resolveCategoryMock.mockResolvedValueOnce(null);

    const result = await service.categorizeTransaction({
      transaction_name: 'Spotify Charge',
    });

    expect(result.success).toBe(true);
    expect(result.transaction_name).toBe('Spotify Charge');
    expect(clientQueryMock).toHaveBeenCalledTimes(1);
    expect(resolveCategoryMock).toHaveBeenCalled();
  });
});

describe('bulkCategorizeTransactions', () => {
  it('returns zero updates when no patterns exist', async () => {
    getClientMock.mockResolvedValueOnce({ query: clientQueryMock, release: releaseMock });
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    const result = await service.bulkCategorizeTransactions();

    expect(result).toEqual({ patternsApplied: 0, transactionsUpdated: 0 });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('applies patterns and returns updated count', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name_pattern: 'NETFLIX',
            category_definition_id: 10,
            subcategory: 'Streaming',
            parent_category: 'Entertainment',
            priority: 5,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 999 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            name: 'Streaming',
            category_type: 'expense',
            parent_name: 'Entertainment',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 4, rows: [] });

    const result = await service.bulkCategorizeTransactions();

    expect(result.patternsApplied).toBe(1);
    expect(result.transactionsUpdated).toBeGreaterThanOrEqual(0);
    expect(clientQueryMock.mock.calls.some(([sql]) => String(sql).includes('UPDATE transactions'))).toBe(true);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
