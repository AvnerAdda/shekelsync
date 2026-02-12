/**
 * Tests for auto-linker.js
 * Automatic transaction linking to investment accounts
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mockQuery = vi.fn();
const mockDatabaseQuery = vi.fn();
const mockGetInstitutionByVendorCode = vi.fn(async () => null);

vi.mock(new URL('../../../../utils/db.js', import.meta.url).pathname, () => ({
  query: (...args) => mockQuery(...args),
}));

vi.mock(new URL('../../institutions.js', import.meta.url).pathname, () => ({
  getInstitutionByVendorCode: (...args) => mockGetInstitutionByVendorCode(...args),
}));

let linkTransactionToAccount;
let linkMultipleTransactions;
let linkFromSuggestions;
let linkFromGroupedSuggestion;
let unlinkTransaction;
let getLinkedTransactions;
let calculateCostBasis;
let getTransactionCount;

beforeAll(async () => {
  globalThis.__TEST_DB_POOL__ = {
    query: (...args) => mockQuery(...args),
  };
  const databaseModule = await import('../../database.js');
  const databaseExport = databaseModule.default || databaseModule;
  databaseExport.query = (...args) => mockDatabaseQuery(...args);
  const module = await import('../auto-linker.js');
  linkTransactionToAccount = module.linkTransactionToAccount;
  linkMultipleTransactions = module.linkMultipleTransactions;
  linkFromSuggestions = module.linkFromSuggestions;
  linkFromGroupedSuggestion = module.linkFromGroupedSuggestion;
  unlinkTransaction = module.unlinkTransaction;
  getLinkedTransactions = module.getLinkedTransactions;
  calculateCostBasis = module.calculateCostBasis;
  getTransactionCount = module.getTransactionCount;
});

describe('auto-linker', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockDatabaseQuery.mockClear();
    mockGetInstitutionByVendorCode.mockReset();
    mockGetInstitutionByVendorCode.mockResolvedValue(null);
    vi.restoreAllMocks();
  });

  describe('linkTransactionToAccount', () => {
    it('should link a transaction to an account', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 1,
          transaction_identifier: 'txn123',
          transaction_vendor: 'leumi',
          account_id: 42,
          link_method: 'auto',
          confidence: 0.95
        }]
      });

      const result = await linkTransactionToAccount({
        transactionIdentifier: 'txn123',
        transactionVendor: 'leumi',
        transactionDate: '2024-11-01',
        accountId: 42,
        linkMethod: 'auto',
        confidence: 0.95,
        createdBy: 'system'
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
      expect(result.account_id).toBe(42);
      expect(result.link_method).toBe('auto');
    });

    it('should use default values when not provided', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 1,
          transaction_identifier: 'txn123',
          transaction_vendor: 'leumi',
          account_id: 42,
          link_method: 'auto',
          confidence: 1.0,
          created_by: 'system'
        }]
      });

      const result = await linkTransactionToAccount({
        transactionIdentifier: 'txn123',
        transactionVendor: 'leumi',
        transactionDate: '2024-11-01',
        accountId: 42
      });

      expect(result.link_method).toBe('auto');
      expect(result.confidence).toBe(1.0);
      expect(result.created_by).toBe('system');
    });
  });

  describe('linkMultipleTransactions', () => {
    it('should link multiple transactions successfully', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 1 }]
      });

      const transactions = [
        { transactionIdentifier: 'txn1', transactionVendor: 'leumi', transactionDate: '2024-01-01' },
        { transactionIdentifier: 'txn2', transactionVendor: 'leumi', transactionDate: '2024-02-01' },
        { transactionIdentifier: 'txn3', transactionVendor: 'leumi', transactionDate: '2024-03-01' }
      ];

      const result = await linkMultipleTransactions(42, transactions, 'auto', 0.9);

      expect(result.totalAttempted).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.successfulLinks).toHaveLength(3);
    });

    it('should handle partial failures', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({ rows: [{ id: 3 }] });

      const transactions = [
        { transactionIdentifier: 'txn1', transactionVendor: 'leumi', transactionDate: '2024-01-01' },
        { transactionIdentifier: 'txn2', transactionVendor: 'leumi', transactionDate: '2024-02-01' },
        { transactionIdentifier: 'txn3', transactionVendor: 'leumi', transactionDate: '2024-03-01' }
      ];

      const result = await linkMultipleTransactions(42, transactions);

      expect(result.totalAttempted).toBe(3);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.failedLinks).toHaveLength(1);
      expect(result.failedLinks[0].error).toBe('Database error');
    });

    it('should return empty result for empty transaction array', async () => {
      const result = await linkMultipleTransactions(42, []);

      expect(result.totalAttempted).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });

    it('attaches account institution metadata to successful links', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, account_id: 42 }],
        })
        .mockResolvedValueOnce({
          rows: [{
            account_type: 'brokerage',
            institution_id: 99,
            vendor_code: 'psagot',
            display_name_he: 'פסגות',
            display_name_en: 'Psagot',
            institution_type: 'investment',
            logo_url: 'psagot.png',
          }],
        });

      const result = await linkMultipleTransactions(42, [
        { transactionIdentifier: 'txn1', transactionVendor: 'leumi', transactionDate: '2024-01-01' },
      ]);

      expect(result.successCount).toBe(1);
      expect(result.successfulLinks[0].institution).toMatchObject({
        id: 99,
        vendor_code: 'psagot',
        display_name_en: 'Psagot',
      });
    });

    it('keeps institution null when account row has no institution metadata', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 2, account_id: 42 }],
        })
        .mockResolvedValueOnce({
          rows: [{ account_type: null, institution_id: null }],
        });

      const result = await linkMultipleTransactions(42, [
        { transactionIdentifier: 'txn2', transactionVendor: 'leumi', transactionDate: '2024-02-01' },
      ]);

      expect(result.successfulLinks[0].institution).toBeNull();
    });

    it('keeps institution null when metadata resolution fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockGetInstitutionByVendorCode.mockRejectedValue(new Error('institution lookup failed'));

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 3, account_id: 42 }],
        })
        .mockResolvedValueOnce({
          rows: [{ account_type: 'brokerage', institution_id: null }],
        });

      const result = await linkMultipleTransactions(42, [
        { transactionIdentifier: 'txn3', transactionVendor: 'leumi', transactionDate: '2024-03-01' },
      ]);

      expect(warnSpy).toHaveBeenCalled();
      expect(result.successfulLinks[0].institution).toBeNull();
    });

    it('continues when account institution fetch throws unexpectedly', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 4, account_id: 42 }],
        })
        .mockRejectedValueOnce(new Error('account query failed'));

      const result = await linkMultipleTransactions(42, [
        { transactionIdentifier: 'txn4', transactionVendor: 'leumi', transactionDate: '2024-04-01' },
      ]);

      expect(warnSpy).toHaveBeenCalled();
      expect(result.successCount).toBe(1);
      expect(result.successfulLinks[0].institution).toBeNull();
    });
  });

  describe('linkFromSuggestions', () => {
    it('returns empty result when no pending suggestions match', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await linkFromSuggestions(42, [1, 2, 3]);

      expect(result).toMatchObject({
        totalAttempted: 0,
        successCount: 0,
        failureCount: 0,
      });
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('links matched suggestions and marks them approved when at least one succeeds', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            transaction_identifier: 'txn10',
            transaction_vendor: 'leumi',
            transaction_date: '2024-05-01',
            confidence: 0.8,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 10, account_id: 42 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 });

      const result = await linkFromSuggestions(42, [10]);

      expect(result.totalAttempted).toBe(1);
      expect(result.successCount).toBe(1);
      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(String(mockQuery.mock.calls[3][0])).toContain('UPDATE pending_transaction_suggestions');
      expect(mockQuery.mock.calls[3][1]).toEqual([42, 10]);
    });

    it('does not update suggestions when all links fail', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            transaction_identifier: 'txn11',
            transaction_vendor: 'leumi',
            transaction_date: '2024-06-01',
            confidence: 0.8,
          }],
        })
        .mockRejectedValueOnce(new Error('insert failed'));

      const result = await linkFromSuggestions(42, [11]);

      expect(result.totalAttempted).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(1);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE pending_transaction_suggestions'),
      )).toBe(false);
    });
  });

  describe('linkFromGroupedSuggestion', () => {
    it('returns empty result when grouped suggestion has no transactions', async () => {
      const result = await linkFromGroupedSuggestion(42, { transactions: [] });

      expect(result).toMatchObject({
        totalAttempted: 0,
        successCount: 0,
        failureCount: 0,
      });
    });

    it('updates grouped suggestion transactions and logs update failures', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 21 }] })
        .mockResolvedValueOnce({ rows: [{ id: 22 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
        .mockRejectedValueOnce(new Error('update failed'));

      const result = await linkFromGroupedSuggestion(42, {
        transactions: [
          {
            transactionIdentifier: 'txn21',
            transactionVendor: 'leumi',
            transactionDate: '2024-07-01',
          },
          {
            transactionIdentifier: 'txn22',
            transactionVendor: 'leumi',
            transactionDate: '2024-08-01',
          },
        ],
      });

      expect(result.totalAttempted).toBe(2);
      expect(result.successCount).toBe(2);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls.filter(([sql]) =>
        String(sql).includes('UPDATE pending_transaction_suggestions'),
      )).toHaveLength(2);
    });
  });

  describe('unlinkTransaction', () => {
    it('should unlink a transaction', async () => {
      mockQuery.mockResolvedValue({
        rowsAffected: 1
      });

      const result = await unlinkTransaction('txn123', 'leumi');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledOnce();
    });

    it('should return false when no rows affected', async () => {
      mockQuery.mockResolvedValue({
        rowsAffected: 0
      });

      const result = await unlinkTransaction('nonexistent', 'leumi');

      expect(result).toBe(false);
    });
  });

  describe('getLinkedTransactions', () => {
    it('returns linked transactions for account', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          transaction_identifier: 'txn99',
          transaction_vendor_name: 'Leumi',
          date: '2024-09-01',
          price: -200,
        }],
      });

      const result = await getLinkedTransactions(42);

      expect(result).toHaveLength(1);
      expect(String(mockQuery.mock.calls[0][0])).toContain('FROM transaction_account_links tal');
      expect(mockQuery.mock.calls[0][1]).toEqual([42]);
    });
  });

  describe('calculateCostBasis', () => {
    it('should calculate cost basis from negative transactions', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ total_cost: 15000 }]
      });

      const result = await calculateCostBasis(42);

      expect(result).toBe(15000);
      expect(mockQuery).toHaveBeenCalledOnce();
    });

    it('should return 0 when no linked transactions', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ total_cost: null }]
      });

      const result = await calculateCostBasis(42);

      expect(result).toBe(0);
    });
  });

  describe('getTransactionCount', () => {
    it('should return transaction count for account', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: 12 }]
      });

      const result = await getTransactionCount(42);

      expect(result).toBe(12);
      expect(mockQuery).toHaveBeenCalledOnce();
    });

    it('should return 0 when no transactions', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: 0 }]
      });

      const result = await getTransactionCount(42);

      expect(result).toBe(0);
    });
  });
});
