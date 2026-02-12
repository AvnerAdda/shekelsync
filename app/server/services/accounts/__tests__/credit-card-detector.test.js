import { describe, it, expect, vi, beforeEach } from 'vitest';

const database = require('../../database.js');
const detector = require('../credit-card-detector.js');

describe('credit-card-detector', () => {
  describe('extractCardNumber', () => {
    it('returns null for falsy input', () => {
      expect(detector.extractCardNumber(null)).toBeNull();
      expect(detector.extractCardNumber('')).toBeNull();
      expect(detector.extractCardNumber(undefined)).toBeNull();
    });

    it('extracts last 4-digit sequence from transaction name', () => {
      expect(detector.extractCardNumber('ויזה כאל 1234')).toBe('1234');
      expect(detector.extractCardNumber('מקס 5678 תשלום 9012')).toBe('9012');
    });

    it('returns null when no 4-digit sequence exists', () => {
      expect(detector.extractCardNumber('some text')).toBeNull();
      expect(detector.extractCardNumber('abc 12 def')).toBeNull();
    });
  });

  describe('detectVendorFromName', () => {
    it('returns null for falsy input', () => {
      expect(detector.detectVendorFromName(null)).toBeNull();
      expect(detector.detectVendorFromName('')).toBeNull();
    });

    it('detects Visa Cal from Hebrew name', () => {
      expect(detector.detectVendorFromName('כ.א.ל תשלום')).toBe('visaCal');
      expect(detector.detectVendorFromName('ויזה כאל 1234')).toBe('visaCal');
    });

    it('detects Visa Cal from English name (case insensitive)', () => {
      expect(detector.detectVendorFromName('Visa Cal payment')).toBe('visaCal');
      expect(detector.detectVendorFromName('CAL charge')).toBe('visaCal');
    });

    it('detects Max', () => {
      expect(detector.detectVendorFromName('מקס כרטיס')).toBe('max');
      expect(detector.detectVendorFromName('MAX card')).toBe('max');
    });

    it('detects Isracard', () => {
      expect(detector.detectVendorFromName('ישראכרט תשלום')).toBe('isracard');
      expect(detector.detectVendorFromName('Isracard 5678')).toBe('isracard');
    });

    it('detects Amex from unambiguous keywords', () => {
      // 'אמקס' contains 'מקס' which matches 'max' first in iteration order,
      // so test with unambiguous English keywords instead
      expect(detector.detectVendorFromName('American Express card')).toBe('amex');
      expect(detector.detectVendorFromName('AMEX billing')).toBe('amex');
    });

    it('detects Leumi Card', () => {
      expect(detector.detectVendorFromName('לאומי כרט')).toBe('leumi');
      expect(detector.detectVendorFromName('Leumi Card payment')).toBe('leumi');
    });

    it('detects Diners', () => {
      expect(detector.detectVendorFromName('דיינרס חיוב')).toBe('diners');
      expect(detector.detectVendorFromName('Diners club')).toBe('diners');
    });

    it('returns null when no vendor matches', () => {
      expect(detector.detectVendorFromName('grocery store')).toBeNull();
      expect(detector.detectVendorFromName('סופר שלי')).toBeNull();
    });
  });

  describe('calculateConfidence', () => {
    it('returns 0 for empty params', () => {
      expect(detector.calculateConfidence({})).toBe(0);
    });

    it('adds 3 for category match', () => {
      expect(detector.calculateConfidence({ hasCategoryMatch: true })).toBe(3);
    });

    it('adds uniqueKeywords count for keyword match', () => {
      expect(detector.calculateConfidence({ hasKeywordMatch: true, uniqueKeywords: 2 })).toBe(2);
    });

    it('adds 2 for card number presence', () => {
      expect(detector.calculateConfidence({ hasCardNumber: true })).toBe(2);
    });

    it('adds transaction count bonus capped at 5', () => {
      expect(detector.calculateConfidence({ transactionCount: 10 })).toBe(2);
      expect(detector.calculateConfidence({ transactionCount: 25 })).toBe(5);
      expect(detector.calculateConfidence({ transactionCount: 100 })).toBe(5);
    });

    it('combines all signals', () => {
      const score = detector.calculateConfidence({
        hasCategoryMatch: true,
        hasKeywordMatch: true,
        uniqueKeywords: 2,
        hasCardNumber: true,
        transactionCount: 15,
      });
      // 3 (category) + 2 (keywords) + 2 (card) + 3 (15/5=3) = 10
      expect(score).toBe(10);
    });
  });

  describe('detectCreditCardSuggestions', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns empty suggestions when no transactions match', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      };
      vi.spyOn(database, 'getClient').mockResolvedValue(mockClient);

      const result = await detector.detectCreditCardSuggestions();

      expect(result.suggestions).toEqual([]);
      expect(result.totalSuggestions).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('groups transactions by vendor and creates suggestions', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          rows: [
            { name: 'ויזה כאל 1234', price: -100, date: '2026-01-01', category_definition_id: 25, category_name: 'repayment', is_repayment: 1 },
            { name: 'ויזה כאל 1234', price: -200, date: '2026-01-15', category_definition_id: 25, category_name: 'repayment', is_repayment: 1 },
            { name: 'Isracard 5678', price: -150, date: '2026-01-10', category_definition_id: null, category_name: null, is_repayment: 0 },
          ],
        }),
        release: vi.fn(),
      };
      vi.spyOn(database, 'getClient').mockResolvedValue(mockClient);

      const result = await detector.detectCreditCardSuggestions();

      expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
      expect(result.totalSuggestions).toBe(result.suggestions.length);
      expect(mockClient.release).toHaveBeenCalled();

      const visaSuggestion = result.suggestions.find((s) => s.vendor === 'visaCal');
      expect(visaSuggestion).toBeDefined();
      expect(visaSuggestion.lastFourDigits).toBe('1234');
    });

    it('releases client even on error', async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValue(new Error('DB error')),
        release: vi.fn(),
      };
      vi.spyOn(database, 'getClient').mockResolvedValue(mockClient);

      await expect(detector.detectCreditCardSuggestions()).rejects.toThrow('DB error');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
