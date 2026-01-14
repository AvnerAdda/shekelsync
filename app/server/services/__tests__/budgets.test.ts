import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../budgets.js');

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const getClientMock = vi.fn();

let budgetsService: any;

beforeAll(async () => {
  const module = await modulePromise;
  budgetsService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  getClientMock.mockReset();

  getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });

  budgetsService.__setDatabase?.({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  budgetsService.__resetDatabase?.();
});

describe('budgets service', () => {
  describe('listBudgets', () => {
    it('returns active budgets ordered correctly', async () => {
      queryMock.mockResolvedValue({
        rows: [
          {
            id: 1,
            category_definition_id: 10,
            period_type: 'monthly',
            budget_limit: 1000,
            is_active: true,
            category_name: 'Food',
            category_name_en: 'Food',
            category_type: 'expense',
            parent_category_name: null,
          },
          {
            id: 2,
            category_definition_id: 11,
            period_type: 'weekly',
            budget_limit: 500,
            is_active: true,
            category_name: 'Transport',
            category_name_en: 'Transport',
            category_type: 'expense',
            parent_category_name: null,
          },
        ],
      });

      const result = await budgetsService.listBudgets();

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock.mock.calls[0][0]).toContain('WHERE cb.is_active = true');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
    });

    it('returns empty array when no budgets exist', async () => {
      queryMock.mockResolvedValue({ rows: [] });

      const result = await budgetsService.listBudgets();

      expect(result).toEqual([]);
    });
  });

  describe('upsertBudget', () => {
    it('creates a new budget with valid data', async () => {
      // First call: getCategoryForBudget
      queryMock
        .mockResolvedValueOnce({
          rows: [{ id: 10, category_type: 'expense' }],
        })
        // Second call: INSERT
        .mockResolvedValueOnce({
          rows: [{ id: 1 }],
        })
        // Third call: fetchBudgetById
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'monthly',
              budget_limit: 1000,
              is_active: true,
              category_name: 'Food',
            },
          ],
        });

      const result = await budgetsService.upsertBudget({
        category_definition_id: '10',
        period_type: 'monthly',
        budget_limit: 1000,
      });

      expect(queryMock).toHaveBeenCalledTimes(3);
      expect(result.id).toBe(1);
      expect(result.budget_limit).toBe(1000);
    });

    it('throws 400 error when missing required fields', async () => {
      await expect(
        budgetsService.upsertBudget({ category_definition_id: '10' })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Missing required fields',
      });
    });

    it('throws 400 error for invalid period_type', async () => {
      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '10',
          period_type: 'daily',
          budget_limit: 100,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Invalid period_type',
      });
    });

    it('throws 400 error for invalid category_definition_id', async () => {
      await expect(
        budgetsService.upsertBudget({
          category_definition_id: 'invalid',
          period_type: 'monthly',
          budget_limit: 100,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Invalid category selected',
      });
    });

    it('throws 404 error when category not found', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '999',
          period_type: 'monthly',
          budget_limit: 100,
        })
      ).rejects.toMatchObject({
        status: 404,
        message: 'Category not found',
      });
    });

    it('throws 400 error for non-expense category', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 10, category_type: 'income' }],
      });

      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '10',
          period_type: 'monthly',
          budget_limit: 100,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Budgets can only be created for expense categories',
      });
    });

    it('throws 400 error for invalid budget_limit', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 10, category_type: 'expense' }],
      });

      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '10',
          period_type: 'monthly',
          budget_limit: -100,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Budget limit must be greater than zero',
      });
    });

    it('throws 400 error for zero budget_limit', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 10, category_type: 'expense' }],
      });

      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '10',
          period_type: 'monthly',
          budget_limit: 0,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Budget limit must be greater than zero',
      });
    });
  });

  describe('updateBudget', () => {
    it('updates budget_limit successfully', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'monthly',
              budget_limit: 2000,
              is_active: true,
            },
          ],
        });

      const result = await budgetsService.updateBudget({
        id: 1,
        budget_limit: 2000,
      });

      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(result.budget_limit).toBe(2000);
    });

    it('updates is_active successfully', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'monthly',
              budget_limit: 1000,
              is_active: false,
            },
          ],
        });

      const result = await budgetsService.updateBudget({
        id: 1,
        is_active: false,
      });

      expect(result.is_active).toBe(false);
    });

    it('throws 400 error when missing budget ID', async () => {
      await expect(budgetsService.updateBudget({})).rejects.toMatchObject({
        status: 400,
        message: 'Missing budget ID',
      });
    });

    it('throws 400 error for invalid budget_limit', async () => {
      await expect(
        budgetsService.updateBudget({ id: 1, budget_limit: -50 })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Budget limit must be greater than zero',
      });
    });

    it('throws 400 error when no fields to update', async () => {
      await expect(
        budgetsService.updateBudget({ id: 1 })
      ).rejects.toMatchObject({
        status: 400,
        message: 'No fields to update',
      });
    });

    it('throws 404 error when budget not found', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        budgetsService.updateBudget({ id: 999, budget_limit: 1000 })
      ).rejects.toMatchObject({
        status: 404,
        message: 'Budget not found',
      });
    });
  });

  describe('deactivateBudget', () => {
    it('deactivates budget successfully', async () => {
      queryMock.mockResolvedValue({ rowCount: 1 });

      const result = await budgetsService.deactivateBudget({ id: 1 });

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock.mock.calls[0][0]).toContain('is_active = false');
      expect(result).toEqual({ success: true });
    });

    it('throws 400 error when missing budget ID', async () => {
      await expect(
        budgetsService.deactivateBudget({})
      ).rejects.toMatchObject({
        status: 400,
        message: 'Missing budget ID',
      });
    });

    it('throws 404 error when budget not found', async () => {
      queryMock.mockResolvedValue({ rowCount: 0 });

      await expect(
        budgetsService.deactivateBudget({ id: 999 })
      ).rejects.toMatchObject({
        status: 404,
        message: 'Budget not found',
      });
    });
  });

  describe('listBudgetUsage', () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    beforeEach(() => {
      getClientMock.mockResolvedValue(mockClient);
      mockClient.query.mockReset();
      mockClient.release.mockReset();
    });

    it('returns budget usage with status calculations', async () => {
      mockClient.query
        // First query: budgets
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'monthly',
              budget_limit: 1000,
              is_active: true,
              category_name: 'Food',
              category_name_en: 'Food',
              parent_category_name: null,
            },
          ],
        })
        // Second query: spending calculation
        .mockResolvedValueOnce({
          rows: [{ spent: 500 }],
        });

      const result = await budgetsService.listBudgetUsage();

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockClient.release).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].spent).toBe(500);
      expect(result[0].remaining).toBe(500);
      expect(result[0].percentage).toBe(50);
      expect(result[0].status).toBe('good');
    });

    it('returns warning status when over 80% used', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'monthly',
              budget_limit: 1000,
              is_active: true,
              category_name: 'Food',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ spent: 850 }],
        });

      const result = await budgetsService.listBudgetUsage();

      expect(result[0].status).toBe('warning');
      expect(result[0].percentage).toBe(85);
    });

    it('returns exceeded status when over 100% used', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'monthly',
              budget_limit: 1000,
              is_active: true,
              category_name: 'Food',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ spent: 1200 }],
        });

      const result = await budgetsService.listBudgetUsage();

      expect(result[0].status).toBe('exceeded');
      expect(result[0].percentage).toBe(100); // capped at 100
    });

    it('skips budgets with invalid limit', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            category_definition_id: 10,
            period_type: 'monthly',
            budget_limit: 0,
            is_active: true,
            category_name: 'Food',
          },
        ],
      });

      const result = await budgetsService.listBudgetUsage();

      expect(result).toHaveLength(0);
    });

    it('releases client even on error', async () => {
      const error = new Error('Database error');
      mockClient.query.mockRejectedValue(error);

      await expect(budgetsService.listBudgetUsage()).rejects.toThrow('Database error');
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('handles null spent values', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'monthly',
              budget_limit: 1000,
              is_active: true,
              category_name: 'Food',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ spent: null }],
        });

      const result = await budgetsService.listBudgetUsage();

      expect(result[0].spent).toBe(0);
      expect(result[0].remaining).toBe(1000);
      expect(result[0].percentage).toBe(0);
      expect(result[0].status).toBe('good');
    });

    it('handles empty budgets list', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const result = await budgetsService.listBudgetUsage();

      expect(result).toEqual([]);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('calculates weekly period budgets', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'weekly',
              budget_limit: 200,
              is_active: true,
              category_name: 'Coffee',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ spent: 50 }],
        });

      const result = await budgetsService.listBudgetUsage();

      expect(result[0].period_type).toBe('weekly');
      expect(result[0].spent).toBe(50);
      expect(result[0].remaining).toBe(150);
    });

    it('calculates yearly period budgets', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'yearly',
              budget_limit: 12000,
              is_active: true,
              category_name: 'Vacation',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ spent: 3000 }],
        });

      const result = await budgetsService.listBudgetUsage();

      expect(result[0].period_type).toBe('yearly');
      expect(result[0].spent).toBe(3000);
      expect(result[0].percentage).toBe(25);
    });
  });

  describe('upsertBudget additional tests', () => {
    it('creates budget with weekly period type', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [{ id: 10, category_type: 'expense' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1 }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'weekly',
              budget_limit: 100,
              is_active: true,
            },
          ],
        });

      const result = await budgetsService.upsertBudget({
        category_definition_id: '10',
        period_type: 'weekly',
        budget_limit: 100,
      });

      expect(result.period_type).toBe('weekly');
    });

    it('creates budget with yearly period type', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [{ id: 10, category_type: 'expense' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1 }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              category_definition_id: 10,
              period_type: 'yearly',
              budget_limit: 5000,
              is_active: true,
            },
          ],
        });

      const result = await budgetsService.upsertBudget({
        category_definition_id: '10',
        period_type: 'yearly',
        budget_limit: 5000,
      });

      expect(result.period_type).toBe('yearly');
    });

    it('throws 400 for invalid period_type', async () => {
      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '10',
          period_type: 'daily',
          budget_limit: 100,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Invalid period_type',
      });
    });

    it('throws 400 for non-numeric category_definition_id', async () => {
      await expect(
        budgetsService.upsertBudget({
          category_definition_id: 'abc',
          period_type: 'monthly',
          budget_limit: 100,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Invalid category selected',
      });
    });

    it('throws 400 for non-expense category', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 10, category_type: 'income' }],
      });

      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '10',
          period_type: 'monthly',
          budget_limit: 100,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Budgets can only be created for expense categories',
      });
    });

    it('throws 404 for non-existent category', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '999',
          period_type: 'monthly',
          budget_limit: 100,
        })
      ).rejects.toMatchObject({
        status: 404,
        message: 'Category not found',
      });
    });

    it('throws 400 for negative budget_limit', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 10, category_type: 'expense' }],
      });

      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '10',
          period_type: 'monthly',
          budget_limit: -100,
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Budget limit must be greater than zero',
      });
    });

    it('throws 400 for non-numeric budget_limit', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 10, category_type: 'expense' }],
      });

      await expect(
        budgetsService.upsertBudget({
          category_definition_id: '10',
          period_type: 'monthly',
          budget_limit: 'invalid',
        })
      ).rejects.toMatchObject({
        status: 400,
        message: 'Budget limit must be greater than zero',
      });
    });
  });
});
