import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as transactionsAdmin from '../admin.js';

const client = { query: vi.fn(), release: vi.fn() };
const db = { getClient: vi.fn(), query: vi.fn() };

describe('transactions admin service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getClient.mockResolvedValue(client);
    transactionsAdmin.__setDatabase(db as any);
  });

  afterEach(() => {
    transactionsAdmin.__resetDatabase();
  });

  it('creates a manual income transaction with provided category', async () => {
    client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            name: 'Salary',
            category_type: 'income',
            parent_id: null,
            parent_name: null,
          },
        ],
      }) // category lookup
      .mockResolvedValueOnce({ rows: [] }); // insert

    const result = await transactionsAdmin.createManualTransaction({
      name: 'Manual Income',
      amount: 1500,
      date: '2025-03-01',
      type: 'income',
      categoryDefinitionId: 10,
    });

    expect(result).toEqual({ success: true });
    expect(db.getClient).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(2);
    const insertArgs = client.query.mock.calls[1];
    const insertSql = String(insertArgs[0]);
    expect(insertSql).toContain('INSERT INTO transactions');
    expect(insertArgs[1][4]).toBe(1500); // price positive for income
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('creates a manual expense transaction with negative price and manual vendor', async () => {
    client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 20,
            name: 'Rent',
            category_type: 'expense',
            parent_id: null,
            parent_name: null,
          },
        ],
      }) // category lookup
      .mockResolvedValueOnce({ rows: [] }); // insert

    const result = await transactionsAdmin.createManualTransaction({
      name: 'Manual Expense',
      amount: -750,
      date: '2025-04-01',
      type: 'expense',
      categoryDefinitionId: 20,
    });

    expect(result).toEqual({ success: true });
    expect(client.query).toHaveBeenCalledTimes(2);
    const [, insertArgs] = client.query.mock.calls;
    const params = insertArgs[1];
    expect(params[1]).toBe('manual_expense');
    expect(params[4]).toBe(-750); // price negative for expense
  });

  it('throws on invalid transaction identifier for update', async () => {
    await expect(transactionsAdmin.updateTransaction('invalid')).rejects.toThrow('Invalid transaction identifier');
  });

  it('throws on transaction identifier missing vendor', async () => {
    await expect(transactionsAdmin.updateTransaction('abc|')).rejects.toThrow('Invalid transaction identifier');
  });

  it('throws on invalid transaction identifier for delete', async () => {
    await expect(transactionsAdmin.deleteTransaction('invalid')).rejects.toThrow('Invalid transaction identifier');
  });

  it('resolves income root when category id is omitted', async () => {
    const incomeCategoryId = 42;
    client.query
      .mockResolvedValueOnce({ rows: [{ id: incomeCategoryId }] }) // income root lookup
      .mockResolvedValueOnce({
        rows: [
          {
            id: incomeCategoryId,
            name: 'Income',
            category_type: 'income',
            parent_id: null,
            parent_name: null,
          },
        ],
      }) // category info
      .mockResolvedValueOnce({ rows: [] }); // insert

    const result = await transactionsAdmin.createManualTransaction({
      name: 'Bonus',
      amount: 200,
      date: '2025-03-10',
      type: 'income',
    });

    expect(result).toEqual({ success: true });
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(client.query.mock.calls[0][0]).toMatch(/SELECT id\s+FROM category_definitions/i);
  });

  it('fails when category cannot be resolved', async () => {
    client.query.mockResolvedValueOnce({ rows: [] }); // income root lookup returns none

    await expect(
      transactionsAdmin.createManualTransaction({
        name: 'Unknown',
        amount: 50,
        date: '2025-03-10',
        type: 'income',
      }),
    ).rejects.toThrow('Unable to resolve category definition for manual transaction');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('fails when explicit category id is not found', async () => {
    client.query.mockResolvedValueOnce({ rows: [] }); // category info missing

    await expect(
      transactionsAdmin.createManualTransaction({
        name: 'Missing cat',
        amount: 10,
        date: '2025-03-10',
        type: 'expense',
        categoryDefinitionId: 999,
      }),
    ).rejects.toThrow('Category definition 999 not found');
  });

  it('updates an existing transaction with provided fields', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await transactionsAdmin.updateTransaction('abc|vendor', {
      price: -25,
      auto_categorized: true,
    });

    expect(result).toEqual({ success: true });
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(String(sql)).toContain('UPDATE transactions');
    expect(params.slice(0, 2)).toEqual(['abc', 'vendor']);
    expect(params).toContain(-25);
  });

  it('ignores unknown fields on update', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await transactionsAdmin.updateTransaction('id|vendor', { price: 10, extra: 'skip me' } as any);

    const [sql, params] = db.query.mock.calls[0];
    expect(String(sql)).not.toContain('extra');
    expect(params).toEqual(['id', 'vendor', 10]);
  });

  it('rejects update when no updatable fields are provided', async () => {
    await expect(transactionsAdmin.updateTransaction('abc|vendor', {})).rejects.toThrow(
      'At least one updatable field is required',
    );
  });

  it('deletes a transaction when identifier is valid', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await transactionsAdmin.deleteTransaction('abc|vendor');

    expect(result).toEqual({ success: true });
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(String(sql)).toContain('DELETE FROM transactions');
    expect(params).toEqual(['abc', 'vendor']);
  });
});
