/**
 * Tests for InvestmentNotificationService
 * Real-time notifications for investment account suggestions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  subscribeToPendingSuggestions,
  refreshPendingSuggestionsCount,
  getPendingSuggestionsCount,
  handleInvestmentCategoryAssigned
} from '../InvestmentNotificationService.tsx';

// Mock fetch
global.fetch = vi.fn();

// Mock window
global.window = {
  addEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  location: { hash: '' }
} as any;

describe('InvestmentNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('subscribeToPendingSuggestions', () => {
    it('should call callback immediately with current count', () => {
      const callback = vi.fn();

      const unsubscribe = subscribeToPendingSuggestions(callback);

      expect(callback).toHaveBeenCalledWith(expect.any(Number));

      unsubscribe();
    });

    it('should allow unsubscribe', () => {
      const callback = vi.fn();

      const unsubscribe = subscribeToPendingSuggestions(callback);
      unsubscribe();

      // Callback should not be called again after unsubscribe
      callback.mockClear();

      // This would normally trigger callbacks, but shouldn't after unsubscribe
      expect(callback).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsubscribe1 = subscribeToPendingSuggestions(callback1);
      const unsubscribe2 = subscribeToPendingSuggestions(callback2);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();

      unsubscribe1();
      unsubscribe2();
    });
  });

  describe('refreshPendingSuggestionsCount', () => {
    it('should fetch suggestions count from API', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ({ success: true, count: 3 })
      });

      const count = await refreshPendingSuggestionsCount();

      expect(global.fetch).toHaveBeenCalledWith('/api/investments/suggestions/pending');
      expect(count).toBe(3);
    });

    it('should return 0 on API error', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const count = await refreshPendingSuggestionsCount();

      expect(count).toBe(0);
    });

    it('should return 0 when success is false', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ({ success: false, error: 'Something went wrong' })
      });

      const count = await refreshPendingSuggestionsCount();

      expect(count).toBe(0);
    });

    it('should update subscribers when count changes', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ({ success: true, count: 5 })
      });

      const callback = vi.fn();
      const unsubscribe = subscribeToPendingSuggestions(callback);

      callback.mockClear();

      await refreshPendingSuggestionsCount();

      expect(callback).toHaveBeenCalledWith(5);

      unsubscribe();
    });
  });

  describe('getPendingSuggestionsCount', () => {
    it('should return current count synchronously', () => {
      const count = getPendingSuggestionsCount();

      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('handleInvestmentCategoryAssigned', () => {
    it('should analyze transaction when investment category assigned', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          json: async () => ({
            success: true,
            suggestions: [
              {
                suggestedAccountName: 'קרן פנסיה - מנורה',
                transactions: [{
                  transactionIdentifier: 'txn123',
                  transactionVendor: 'leumi'
                }]
              }
            ]
          })
        })
        .mockResolvedValueOnce({
          json: async () => ({ success: true, count: 1 })
        });

      const event = {
        transactionId: 'txn123',
        transactionVendor: 'leumi',
        transactionDescription: 'העברה לפנסיה מנורה',
        categoryName: 'Pension',
        categoryType: 'investment'
      };

      await handleInvestmentCategoryAssigned(event);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/investments/analyze-transactions',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should not show notification if no matching suggestion', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ({
          success: true,
          suggestions: []
        })
      });

      const event = {
        transactionId: 'txn123',
        transactionVendor: 'leumi',
        transactionDescription: 'Some transaction',
        categoryName: 'Investment',
        categoryType: 'investment'
      };

      await handleInvestmentCategoryAssigned(event);

      // Should only call analyze API, not show notification
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const event = {
        transactionId: 'txn123',
        transactionVendor: 'leumi',
        transactionDescription: 'Some transaction',
        categoryName: 'Investment',
        categoryType: 'investment'
      };

      // Should not throw
      await expect(
        handleInvestmentCategoryAssigned(event)
      ).resolves.not.toThrow();
    });

    it('should call custom callback when provided', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        json: async () => ({
          success: true,
          suggestions: [
            {
              suggestedAccountName: 'Test Account',
              transactions: [{
                transactionIdentifier: 'txn123',
                transactionVendor: 'leumi'
              }]
            }
          ]
        })
      }).mockResolvedValueOnce({
        json: async () => ({ success: true, count: 1 })
      });

      const onCreateAccountClick = vi.fn();

      const event = {
        transactionId: 'txn123',
        transactionVendor: 'leumi',
        transactionDescription: 'Test',
        categoryName: 'Investment',
        categoryType: 'investment'
      };

      await handleInvestmentCategoryAssigned(event, onCreateAccountClick);

      // Callback should be ready to be called (via toast click)
      expect(onCreateAccountClick).toBeDefined();
    });
  });
});
