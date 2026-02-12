import { describe, it, expect } from 'vitest';

const { createAnonymizer, anonymizeContext } = require('../data-anonymizer.js');

describe('data-anonymizer', () => {
  describe('createAnonymizer', () => {
    it('returns null for null/empty merchant names', () => {
      const anon = createAnonymizer();
      expect(anon.anonymizeMerchant(null)).toBeNull();
      expect(anon.anonymizeMerchant('')).toBeNull();
      expect(anon.anonymizeMerchant('   ')).toBeNull();
    });

    it('assigns sequential anonymous labels', () => {
      const anon = createAnonymizer();
      expect(anon.anonymizeMerchant('SuperMarket')).toBe('Merchant_1');
      expect(anon.anonymizeMerchant('Coffee Shop')).toBe('Merchant_2');
    });

    it('returns same label for same merchant', () => {
      const anon = createAnonymizer();
      const first = anon.anonymizeMerchant('SuperMarket');
      const second = anon.anonymizeMerchant('SuperMarket');
      expect(first).toBe(second);
    });

    it('trims merchant name before mapping', () => {
      const anon = createAnonymizer();
      const a = anon.anonymizeMerchant('  SuperMarket  ');
      const b = anon.anonymizeMerchant('SuperMarket');
      expect(a).toBe(b);
    });
  });

  describe('anonymizeTransaction', () => {
    it('returns null for null transaction', () => {
      const anon = createAnonymizer();
      expect(anon.anonymizeTransaction(null)).toBeNull();
    });

    it('anonymizes name and merchant_name fields', () => {
      const anon = createAnonymizer();
      const result = anon.anonymizeTransaction({
        name: 'SuperMarket',
        merchant_name: 'SuperMarket',
        price: -100,
        date: '2026-01-01',
        category: 'groceries',
        category_definition_id: 5,
        account_number: '12345678',
      });

      expect(result.name).toBe('Merchant_1');
      expect(result.merchant_name).toBe('Merchant_1');
      expect(result.price).toBe(-100);
      expect(result.date).toBe('2026-01-01');
      expect(result.category).toBe('groceries');
      expect(result.account_number).toBe('****5678');
    });

    it('masks account number keeping last 4 digits', () => {
      const anon = createAnonymizer();
      const result = anon.anonymizeTransaction({
        name: 'Shop',
        account_number: '98765432',
      });
      expect(result.account_number).toBe('****5432');
    });

    it('handles null account_number', () => {
      const anon = createAnonymizer();
      const result = anon.anonymizeTransaction({
        name: 'Shop',
        account_number: null,
      });
      expect(result.account_number).toBeNull();
    });
  });

  describe('anonymizeTransactions', () => {
    it('returns empty array for non-array input', () => {
      const anon = createAnonymizer();
      expect(anon.anonymizeTransactions(null)).toEqual([]);
      expect(anon.anonymizeTransactions(undefined)).toEqual([]);
      expect(anon.anonymizeTransactions('string')).toEqual([]);
    });

    it('anonymizes array of transactions consistently', () => {
      const anon = createAnonymizer();
      const results = anon.anonymizeTransactions([
        { name: 'Shop A', price: -50 },
        { name: 'Shop B', price: -75 },
        { name: 'Shop A', price: -30 },
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('Merchant_1');
      expect(results[1].name).toBe('Merchant_2');
      expect(results[2].name).toBe('Merchant_1'); // same merchant, same label
    });
  });

  describe('anonymizeMerchants', () => {
    it('returns empty array for non-array input', () => {
      const anon = createAnonymizer();
      expect(anon.anonymizeMerchants(null)).toEqual([]);
    });

    it('anonymizes merchant spending data', () => {
      const anon = createAnonymizer();
      const results = anon.anonymizeMerchants([
        { name: 'SuperMarket', visits: 10, total: 500 },
        { merchant_name: 'Coffee', visit_count: 20, total_spent: 300 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Merchant_1');
      expect(results[0].visits).toBe(10);
      expect(results[0].total).toBe(500);
      expect(results[1].name).toBe('Merchant_2');
      expect(results[1].visits).toBe(20);
      expect(results[1].total).toBe(300);
    });
  });

  describe('getOriginal / getMapping / getStats', () => {
    it('reverse-maps anonymous labels', () => {
      const anon = createAnonymizer();
      anon.anonymizeMerchant('SuperMarket');
      anon.anonymizeMerchant('Coffee Shop');

      expect(anon.getOriginal('Merchant_1')).toBe('SuperMarket');
      expect(anon.getOriginal('Merchant_2')).toBe('Coffee Shop');
      expect(anon.getOriginal('Merchant_99')).toBeUndefined();
    });

    it('returns full mapping object', () => {
      const anon = createAnonymizer();
      anon.anonymizeMerchant('SuperMarket');
      expect(anon.getMapping()).toEqual({ Merchant_1: 'SuperMarket' });
    });

    it('returns stats', () => {
      const anon = createAnonymizer();
      anon.anonymizeMerchant('A');
      anon.anonymizeMerchant('B');
      expect(anon.getStats()).toEqual({ uniqueMerchants: 2 });
    });
  });

  describe('anonymizeContext', () => {
    it('returns null/falsy context as-is', () => {
      const anon = createAnonymizer();
      expect(anonymizeContext(null, anon)).toBeNull();
      expect(anonymizeContext(undefined, anon)).toBeUndefined();
    });

    it('preserves non-sensitive fields and anonymizes transactions and merchants', () => {
      const anon = createAnonymizer();
      const context = {
        hasData: true,
        permissions: { read: true },
        summary: { income: 5000 },
        categories: ['food'],
        budgets: [],
        monthlyTrends: [],
        analytics: {},
        investments: {},
        recentTransactions: [{ name: 'SuperMarket', price: -100 }],
        topMerchants: [{ name: 'SuperMarket', visits: 5, total: 500 }],
      };

      const result = anonymizeContext(context, anon);

      expect(result.hasData).toBe(true);
      expect(result.permissions).toEqual({ read: true });
      expect(result.summary).toEqual({ income: 5000 });
      expect(result.recentTransactions[0].name).toBe('Merchant_1');
      expect(result.topMerchants[0].name).toBe('Merchant_1');
    });
  });
});
