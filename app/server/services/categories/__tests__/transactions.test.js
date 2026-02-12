import { describe, it, expect, vi, beforeEach } from 'vitest';

const database = require('../../database.js');
const service = require('../transactions.js');

describe('categories/transactions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('listCategoryTransactions', () => {
    it('throws 400 when categoryId is missing', async () => {
      await expect(service.listCategoryTransactions({})).rejects.toThrow('categoryId is required');
    });

    it('throws 400 when categoryId is not a valid number', async () => {
      await expect(service.listCategoryTransactions({ categoryId: 'abc' })).rejects.toThrow(
        'categoryId must be a valid number',
      );
    });

    it('accepts category_id as alias', async () => {
      vi.spyOn(database, 'query')
        .mockResolvedValueOnce({ rows: [] }) // transactions query
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }); // count query

      const result = await service.listCategoryTransactions({ category_id: 5 });
      expect(result.transactions).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('accepts category_definition_id as alias', async () => {
      vi.spyOn(database, 'query')
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      await service.listCategoryTransactions({ category_definition_id: 7 });

      // Verify the categoryId (7) was passed as query param
      const firstCallParams = database.query.mock.calls[0][1];
      expect(firstCallParams[0]).toBe(7);
    });

    it('returns transactions mapped to camelCase with pagination', async () => {
      vi.spyOn(database, 'query')
        .mockResolvedValueOnce({
          rows: [
            {
              identifier: 'tx1',
              vendor: 'hapoalim',
              name: 'Grocery Store',
              date: '2026-01-15',
              price: '-50.00',
              account_number: '12345',
              category_definition_id: 10,
              category_type: 'expense',
              auto_categorized: true,
              confidence_score: 0.95,
              category_name: 'מזון',
              category_name_en: 'Food',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: '25' }] });

      const result = await service.listCategoryTransactions({
        categoryId: 10,
        limit: 20,
        offset: 5,
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toEqual({
        identifier: 'tx1',
        vendor: 'hapoalim',
        name: 'Grocery Store',
        date: '2026-01-15',
        price: -50,
        accountNumber: '12345',
        categoryDefinitionId: 10,
        categoryType: 'expense',
        autoCategorized: true,
        confidenceScore: 0.95,
        categoryName: 'מזון',
        categoryNameEn: 'Food',
      });
      expect(result.totalCount).toBe(25);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(5);
    });

    it('defaults limit to 100 and offset to 0', async () => {
      vi.spyOn(database, 'query')
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await service.listCategoryTransactions({ categoryId: 1 });

      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
    });

    it('handles null price gracefully', async () => {
      vi.spyOn(database, 'query')
        .mockResolvedValueOnce({
          rows: [{ identifier: 'tx2', price: null, name: 'test', date: '2026-01-01' }],
        })
        .mockResolvedValueOnce({ rows: [{ total: '1' }] });

      const result = await service.listCategoryTransactions({ categoryId: 1 });
      expect(result.transactions[0].price).toBeNull();
    });
  });
});
