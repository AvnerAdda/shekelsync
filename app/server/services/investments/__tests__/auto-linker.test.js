/**
 * Tests for auto-linker.js
 * Automatic transaction linking to investment accounts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the database pool
const mockQuery = vi.fn();
vi.mock('../../../../utils/db.js', () => ({
  getPool: () => ({
    query: mockQuery
  })
}));

import {
  linkTransactionToAccount,
  linkMultipleTransactions,
  unlinkTransaction,
  calculateCostBasis,
  getTransactionCount
} from '../auto-linker.js';

describe('auto-linker', () => {
  beforeEach(() => {
    mockQuery.mockClear();
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
      expect(mockQuery).toHaveBeenCalledTimes(3);
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
      expect(mockQuery).not.toHaveBeenCalled();
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
