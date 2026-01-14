import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../hierarchy.js');

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const getClientMock = vi.fn();

let hierarchyService: any;

beforeAll(async () => {
  const module = await modulePromise;
  hierarchyService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  getClientMock.mockReset();

  getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });

  hierarchyService.__setDatabase?.({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  hierarchyService.__resetDatabase?.();
});

describe('hierarchy service', () => {
  describe('listHierarchy', () => {
    it('returns categories with transaction counts', async () => {
      queryMock
        // Categories query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              name: 'Food',
              name_en: 'Food',
              parent_id: null,
              category_type: 'expense',
              display_order: 1,
              icon: '🍔',
              color: '#FF5722',
              is_active: true,
              transaction_count: '50',
              total_amount: '5000',
            },
            {
              id: 2,
              name: 'Groceries',
              name_en: 'Groceries',
              parent_id: 1,
              category_type: 'expense',
              display_order: 1,
              icon: '🛒',
              color: '#4CAF50',
              is_active: true,
              transaction_count: '30',
              total_amount: '3000',
            },
          ],
        })
        // Uncategorized summary
        .mockResolvedValueOnce({
          rows: [{ total_transactions: '10', total_amount: '1000' }],
        })
        // Uncategorized recent
        .mockResolvedValueOnce({
          rows: [
            {
              identifier: 'tx-1',
              vendor: 'hapoalim',
              name: 'Unknown Merchant',
              date: '2025-01-01',
              price: 100,
              account_number: '1234',
              category_definition_id: null,
              category_type: null,
              category_name: null,
            },
          ],
        });

      const result = await hierarchyService.listHierarchy();

      expect(result.categories).toHaveLength(2);
      expect(result.categories[0].transaction_count).toBe(50);
      expect(result.categories[0].total_amount).toBe(5000);
      expect(result.uncategorized.totalCount).toBe(10);
      expect(result.uncategorized.totalAmount).toBe(1000);
      expect(result.uncategorized.recentTransactions).toHaveLength(1);
    });

    it('filters by category type when specified', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_transactions: 0, total_amount: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await hierarchyService.listHierarchy({ type: 'expense' });

      expect(queryMock).toHaveBeenCalled();
      const query = queryMock.mock.calls[0][0];
      expect(query).toContain('category_type = $1');
      const params = queryMock.mock.calls[0][1];
      expect(params).toContain('expense');
    });

    it('includes inactive categories when requested', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [
            { id: 1, name: 'Active', is_active: true, transaction_count: '10', total_amount: '1000' },
            { id: 2, name: 'Inactive', is_active: false, transaction_count: '0', total_amount: '0' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total_transactions: 0, total_amount: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await hierarchyService.listHierarchy({ includeInactive: 'true' });

      expect(result.categories).toHaveLength(2);
      const query = queryMock.mock.calls[0][0];
      expect(query).not.toContain('is_active = true');
    });

    it('excludes inactive categories by default', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_transactions: 0, total_amount: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await hierarchyService.listHierarchy();

      const query = queryMock.mock.calls[0][0];
      expect(query).toContain('is_active = true');
    });

    it('handles empty categories gracefully', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_transactions: 0, total_amount: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await hierarchyService.listHierarchy();

      expect(result.categories).toEqual([]);
      expect(result.uncategorized.totalCount).toBe(0);
    });

    it('handles boolean includeInactive parameter', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_transactions: 0, total_amount: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await hierarchyService.listHierarchy({ includeInactive: true });

      const query = queryMock.mock.calls[0][0];
      expect(query).not.toContain('is_active = true');
    });
  });

  describe('createCategory', () => {
    it('creates new category successfully', async () => {
      queryMock
        // Duplicate check
        .mockResolvedValueOnce({ rows: [] })
        // Parent validation (returns existing parent)
        .mockResolvedValueOnce({
          rows: [{ category_type: 'expense', hierarchy_path: '1', depth_level: 0 }],
        })
        // Get next display order
        .mockResolvedValueOnce({ rows: [{ next_order: 1 }] })
        // Insert
        .mockResolvedValueOnce({
          rows: [{
            id: 2,
            name: 'Groceries',
            name_en: 'Groceries',
            parent_id: 1,
            category_type: 'expense',
          }],
        })
        // Update hierarchy_path
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await hierarchyService.createCategory({
        name: 'Groceries',
        parent_id: 1,
        category_type: 'expense',
      });

      expect(result.id).toBe(2);
      expect(result.name).toBe('Groceries');
    });

    it('throws 400 for missing name', async () => {
      await expect(
        hierarchyService.createCategory({
          category_type: 'expense',
        } as any)
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 for invalid category type', async () => {
      await expect(
        hierarchyService.createCategory({
          name: 'Test',
          category_type: 'invalid',
        } as any)
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 for non-existent parent', async () => {
      queryMock
        // Duplicate check
        .mockResolvedValueOnce({ rows: [] })
        // Parent validation (not found)
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        hierarchyService.createCategory({
          name: 'Test',
          category_type: 'expense',
          parent_id: 999,
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 for duplicate category name at same level', async () => {
      queryMock
        // Duplicate check - returns existing category with same name at same level
        .mockResolvedValueOnce({
          rows: [{ id: 5 }], // Duplicate exists
        });

      await expect(
        hierarchyService.createCategory({
          name: 'Groceries',
          category_type: 'expense',
          parent_id: 1,
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('updateCategory', () => {
    it('updates category name', async () => {
      queryMock
        // Update query returns updated row
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'New Name', category_type: 'expense' }],
        });

      const result = await hierarchyService.updateCategory({ id: 1, name: 'New Name' });

      expect(result.name).toBe('New Name');
    });

    it('throws 400 for missing category ID', async () => {
      await expect(
        hierarchyService.updateCategory({ name: 'Test' })
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 404 for non-existent category', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        hierarchyService.updateCategory({ id: 999, name: 'Test' })
      ).rejects.toMatchObject({
        status: 404,
      });
    });

    it('throws 400 when no fields to update', async () => {
      await expect(
        hierarchyService.updateCategory({ id: 1 })
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('deleteCategory', () => {
    it('deletes category successfully', async () => {
      queryMock
        // Check transactions using this category
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Check child categories
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Delete
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test' }] });

      const result = await hierarchyService.deleteCategory({ id: 1 });

      expect(result.message).toBe('Category deleted successfully');
      expect(result.category).toBeDefined();
    });

    it('throws 400 for missing category ID', async () => {
      await expect(hierarchyService.deleteCategory({})).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 when category has transactions', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ count: 5 }] }); // Has transactions

      await expect(hierarchyService.deleteCategory({ id: 1 })).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 when category has subcategories', async () => {
      queryMock
        // Check transactions - none
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Check child categories - has children
        .mockResolvedValueOnce({ rows: [{ count: 2 }] });

      await expect(hierarchyService.deleteCategory({ id: 1 })).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 404 for non-existent category', async () => {
      queryMock
        // Check transactions
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Check child categories
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        // Delete returns empty
        .mockResolvedValueOnce({ rows: [] });

      await expect(hierarchyService.deleteCategory({ id: 999 })).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('updateCategory additional tests', () => {
    it('updates display_order', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 1, name: 'Test', display_order: 5 }],
      });

      const result = await hierarchyService.updateCategory({
        id: 1,
        display_order: 5,
      });

      expect(result.display_order).toBe(5);
      const query = queryMock.mock.calls[0][0];
      expect(query).toContain('display_order');
    });

    it('updates is_active to false', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 1, name: 'Test', is_active: false }],
      });

      const result = await hierarchyService.updateCategory({
        id: 1,
        is_active: false,
      });

      expect(result.is_active).toBe(false);
    });

    it('updates is_active from string "true"', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 1, name: 'Test', is_active: true }],
      });

      const result = await hierarchyService.updateCategory({
        id: '1',
        is_active: 'true',
      });

      expect(result.is_active).toBe(true);
    });

    it('updates multiple fields at once', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{
          id: 1,
          name: 'Updated Name',
          icon: '🍕',
          color: '#FF0000',
          description: 'New description',
        }],
      });

      const result = await hierarchyService.updateCategory({
        id: 1,
        name: 'Updated Name',
        icon: '🍕',
        color: '#FF0000',
        description: 'New description',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.icon).toBe('🍕');
      expect(result.color).toBe('#FF0000');
      expect(result.description).toBe('New description');
    });

    it('throws 400 for invalid is_active value', async () => {
      await expect(
        hierarchyService.updateCategory({
          id: 1,
          is_active: 'invalid',
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 for invalid display_order value', async () => {
      await expect(
        hierarchyService.updateCategory({
          id: 1,
          display_order: 'not-a-number',
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('createCategory additional tests', () => {
    it('creates root category without parent', async () => {
      queryMock
        // Duplicate check
        .mockResolvedValueOnce({ rows: [] })
        // Get next display order
        .mockResolvedValueOnce({ rows: [{ next_order: 1 }] })
        // Insert
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            name: 'New Root',
            parent_id: null,
            category_type: 'expense',
            depth_level: 0,
          }],
        })
        // Update hierarchy_path
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await hierarchyService.createCategory({
        name: 'New Root',
        category_type: 'expense',
      });

      expect(result.id).toBe(1);
      expect(result.parent_id).toBeNull();
    });

    it('creates category with icon and color', async () => {
      queryMock
        // Duplicate check
        .mockResolvedValueOnce({ rows: [] })
        // Get next display order
        .mockResolvedValueOnce({ rows: [{ next_order: 1 }] })
        // Insert
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            name: 'Colored Category',
            icon: '🎨',
            color: '#00FF00',
            category_type: 'expense',
          }],
        })
        // Update hierarchy_path
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await hierarchyService.createCategory({
        name: 'Colored Category',
        category_type: 'expense',
        icon: '🎨',
        color: '#00FF00',
      });

      expect(result.icon).toBe('🎨');
      expect(result.color).toBe('#00FF00');
    });

    it('creates category with custom display_order', async () => {
      queryMock
        // Duplicate check
        .mockResolvedValueOnce({ rows: [] })
        // Insert (skips next_order query when display_order provided)
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            name: 'Test',
            display_order: 10,
            category_type: 'expense',
          }],
        })
        // Update hierarchy_path
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await hierarchyService.createCategory({
        name: 'Test',
        category_type: 'expense',
        display_order: 10,
      });

      expect(result.display_order).toBe(10);
    });

    it('throws 400 when parent has different category_type', async () => {
      queryMock
        // Duplicate check
        .mockResolvedValueOnce({ rows: [] })
        // Parent validation - different type
        .mockResolvedValueOnce({
          rows: [{ category_type: 'income', hierarchy_path: '1', depth_level: 0 }],
        });

      await expect(
        hierarchyService.createCategory({
          name: 'Child',
          category_type: 'expense',
          parent_id: 1,
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('supports income category type', async () => {
      queryMock
        // Duplicate check
        .mockResolvedValueOnce({ rows: [] })
        // Get next display order
        .mockResolvedValueOnce({ rows: [{ next_order: 1 }] })
        // Insert
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            name: 'Salary',
            category_type: 'income',
          }],
        })
        // Update hierarchy_path
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await hierarchyService.createCategory({
        name: 'Salary',
        category_type: 'income',
      });

      expect(result.category_type).toBe('income');
    });

    it('supports investment category type', async () => {
      queryMock
        // Duplicate check
        .mockResolvedValueOnce({ rows: [] })
        // Get next display order
        .mockResolvedValueOnce({ rows: [{ next_order: 1 }] })
        // Insert
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            name: 'Stocks',
            category_type: 'investment',
          }],
        })
        // Update hierarchy_path
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await hierarchyService.createCategory({
        name: 'Stocks',
        category_type: 'investment',
      });

      expect(result.category_type).toBe('investment');
    });
  });

  describe('listHierarchy additional tests', () => {
    it('filters by income type', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_transactions: 0, total_amount: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await hierarchyService.listHierarchy({ type: 'income' });

      const params = queryMock.mock.calls[0][1];
      expect(params).toContain('income');
    });

    it('includes uncategorized transactions in parent categories', async () => {
      queryMock
        // Categories with parent
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              name: 'Food',
              parent_id: null,
              transaction_count: '10',
              total_amount: '1000',
            },
            {
              id: 2,
              name: 'Groceries',
              parent_id: 1,
              transaction_count: '5',
              total_amount: '500',
            },
          ],
        })
        // Uncategorized summary - includes parent category transactions
        .mockResolvedValueOnce({ rows: [{ total_transactions: '3', total_amount: '300' }] })
        // Uncategorized recent
        .mockResolvedValueOnce({
          rows: [
            {
              identifier: 'tx-1',
              vendor: 'hapoalim',
              name: 'Test',
              date: '2025-01-01',
              price: 100,
              category_definition_id: 1, // Assigned to parent, not leaf
              category_name: 'Food',
            },
          ],
        });

      const result = await hierarchyService.listHierarchy();

      expect(result.uncategorized.totalCount).toBe(3);
      expect(result.uncategorized.recentTransactions).toHaveLength(1);
    });
  });
});
