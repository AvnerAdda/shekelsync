import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../categorization/rules.js');

const queryMock = vi.fn();
const querySequence = (...responses: any[]) => {
  queryMock.mockReset();
  responses.forEach((response) => queryMock.mockResolvedValueOnce(response));
};
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const getClientMock = vi.fn();

let rulesService: any;

beforeAll(async () => {
  const module = await modulePromise;
  rulesService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  getClientMock.mockReset();

  getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });

  rulesService.__setDatabase?.({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  rulesService.__resetDatabase?.();
});

describe('categorization rules service', () => {
  it('listRules returns rows from database', async () => {
    const rows = [{ id: 1, name_pattern: 'foo' }];
    queryMock.mockResolvedValueOnce({ rows });

    const result = await rulesService.listRules();

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('SELECT');
    expect(result).toEqual(rows);
  });

  it('createRule fetches category details and inserts with normalized data', async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            name: 'Utilities',
            category_type: 'expense',
            path: 'Expenses > Utilities',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            name_pattern: 'PAYMENT',
            target_category: 'Utilities',
            category_definition_id: 42,
            category_type: 'expense',
            category_path: 'Expenses > Utilities',
            is_active: true,
            priority: 3,
          },
        ],
      });

    const result = await rulesService.createRule({
      name_pattern: 'PAYMENT',
      category_definition_id: 42,
      priority: 3,
    });

    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: 7,
      target_category: 'Utilities',
      category_path: 'Expenses > Utilities',
    });
  });

  it('createRule uses provided target when no category definition', async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 8,
          name_pattern: 'UBER',
          target_category: 'Transport',
          category_definition_id: null,
          category_type: null,
          category_path: null,
          priority: 1,
        },
      ],
    });

    const result = await rulesService.createRule({
      name_pattern: 'UBER',
      target_category: 'Transport',
    });

    expect(clientQueryMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ target_category: 'Transport', category_definition_id: null });
  });

  it('createRule keeps provided target/category when category lookup is empty', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 81,
            name_pattern: 'CINEMA',
            target_category: 'Fun',
            category_definition_id: 42,
            category_type: 'expense',
            category_path: null,
          },
        ],
      });

    const result = await rulesService.createRule({
      name_pattern: 'CINEMA',
      target_category: 'Fun',
      category_type: 'expense',
      category_definition_id: 42,
    });

    expect(result).toMatchObject({
      id: 81,
      target_category: 'Fun',
      category_type: 'expense',
      category_path: null,
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('createRule releases client when insert fails', async () => {
    clientQueryMock.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      rulesService.createRule({
        name_pattern: 'ERR',
        target_category: 'Test',
      }),
    ).rejects.toThrow('insert failed');

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('updateRule updates provided fields', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 5,
          name_pattern: 'AMAZON',
          priority: 10,
        },
      ],
    });

    const result = await rulesService.updateRule({ id: 5, priority: 10 });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('UPDATE categorization_rules');
    expect(result).toMatchObject({ id: 5, priority: 10 });
  });

  it('updateRule throws when id is missing', async () => {
    await expect(rulesService.updateRule({ priority: 10 })).rejects.toMatchObject({ status: 400 });
  });

  it('deleteRule executes delete statement', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    await rulesService.deleteRule({ id: 4 });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('DELETE FROM categorization_rules');
    expect(queryMock.mock.calls[0][1]).toEqual([4]);
  });

  it('deleteRule throws when id is missing', async () => {
    await expect(rulesService.deleteRule({})).rejects.toMatchObject({ status: 400 });
  });

  describe('createAutoRule', () => {
    it('replaces an existing rule target without unique-key conflicts and refreshes cached analytics', async () => {
      const Database = require('better-sqlite3');
      const { createTtlCache } = require('../../../lib/server/ttl-cache.js');
      const sqlite = new Database(':memory:');
      try {
        sqlite.exec(`
          CREATE TABLE category_definitions (id INTEGER PRIMARY KEY, name TEXT, category_type TEXT, parent_id INTEGER);
          CREATE TABLE categorization_rules (
            id INTEGER PRIMARY KEY, name_pattern TEXT, target_category TEXT, category_path TEXT,
            category_definition_id INTEGER, category_type TEXT, is_active INTEGER, priority INTEGER,
            updated_at TEXT, UNIQUE(name_pattern, target_category)
          );
          CREATE TABLE transactions (
            name TEXT, price REAL, category_definition_id INTEGER, category_type TEXT,
            auto_categorized INTEGER, confidence_score REAL
          );
          INSERT INTO category_definitions VALUES (1, 'Food', 'expense', NULL), (2, 'Travel', 'expense', NULL);
          INSERT INTO categorization_rules (name_pattern, target_category, category_definition_id, is_active)
            VALUES ('SHOP', 'Food', 1, 1);
          INSERT INTO transactions VALUES ('SHOP branch', -35, 1, 'expense', 0, 1), ('SHOP refund', 10, 1, 'expense', 0, 1);
        `);
        rulesService.__setDatabase({
          query: async (sql: string, params: unknown[] = []) => {
            const ordered: unknown[] = [];
            const statement = sqlite.prepare(sql.replace(/\$(\d+)/g, (_match: string, index: string) => {
              const value = params[Number(index) - 1];
              ordered.push(typeof value === 'boolean' ? Number(value) : value);
              return '?';
            }));
            if (statement.reader) {
              const rows = statement.all(...ordered);
              return { rows, rowCount: rows.length };
            }
            return { rows: [], rowCount: statement.run(...ordered).changes };
          },
        });
        const cache = createTtlCache();
        cache.set('analytics', 'old category totals');
        const result = await rulesService.createAutoRule({ transactionName: 'SHOP', categoryDefinitionId: 2 });
        expect(result.transactionsUpdated).toBe(1);
        expect(cache.get('analytics')).toBeUndefined();
        expect(sqlite.prepare('SELECT target_category FROM categorization_rules WHERE is_active = 1').all())
          .toEqual([{ target_category: 'Travel' }]);
        expect(sqlite.prepare('SELECT category_definition_id FROM transactions ORDER BY price').all())
          .toEqual([{ category_definition_id: 2 }, { category_definition_id: 1 }]);
        await rulesService.createAutoRule({ transactionName: 'SHOP', categoryDefinitionId: 1 });
        expect(sqlite.prepare('SELECT target_category FROM categorization_rules WHERE is_active = 1').all())
          .toEqual([{ target_category: 'Food' }]);
      } finally {
        sqlite.close();
      }
    });

    it('throws when required fields missing', async () => {
      await expect(rulesService.createAutoRule({})).rejects.toMatchObject({ status: 400 });
    });

    it('throws when category is not found', async () => {
      querySequence({ rows: [] });
      await expect(
        rulesService.createAutoRule({
          transactionName: 'SPOTIFY',
          categoryDefinitionId: 404,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('returns rule metadata when pattern already exists', async () => {
      querySequence(
        {
          rows: [
            {
              id: 10,
              name: 'Subscriptions',
              category_type: 'expense',
              parent_name: 'Entertainment',
            },
          ],
        },
        {
          rows: [
            {
              id: 99,
              name_pattern: 'SPOTIFY',
              target_category: 'Subscriptions',
              category_path: 'Entertainment > Subscriptions',
              category_definition_id: 10,
              category_type: 'expense',
              is_active: true,
              priority: 50,
            },
          ],
        },
        { rowCount: 0 },
        { rowCount: 2 },
      );

      const result = await rulesService.createAutoRule({
        transactionName: 'SPOTIFY',
        categoryDefinitionId: 10,
      });

      expect(result.success).toBe(true);
      expect(result.rule).toMatchObject({ id: 99, target_category: 'Subscriptions' });
      expect(result.transactionsUpdated).toBe(2);
    });

    it('creates rule using category metadata', async () => {
      querySequence(
        {
          rows: [
            {
              id: 55,
              name: 'Subscriptions',
              category_type: 'expense',
              parent_name: 'Entertainment',
            },
          ],
        },
        {
          rows: [
            {
              id: 123,
              name_pattern: 'SPOTIFY',
              target_category: 'Subscriptions',
              category_path: 'Entertainment > Subscriptions',
              category_definition_id: 55,
              category_type: 'expense',
              is_active: true,
              priority: 50,
            },
          ],
        },
        { rowCount: 0 },
        { rowCount: 1 },
      );

      const result = await rulesService.createAutoRule({
        transactionName: 'SPOTIFY',
        categoryDefinitionId: 55,
      });

      expect(result.success).toBe(true);
      expect(result.rule).toMatchObject({
        target_category: 'Subscriptions',
        category_path: 'Entertainment > Subscriptions',
      });
    });

    it('applies income rule with positive-price condition and singular message', async () => {
      querySequence(
        {
          rows: [
            {
              id: 11,
              name: 'Salary',
              category_type: 'income',
              parent_name: null,
            },
          ],
        },
        {
          rows: [
            {
              id: 500,
              name_pattern: 'PAYROLL',
              target_category: 'Salary',
            },
          ],
        },
        { rowCount: 0 },
        { rowCount: 1 },
      );

      const result = await rulesService.createAutoRule({
        transactionName: 'PAYROLL',
        categoryDefinitionId: 11,
      });

      expect(result.message).toContain('1 transaction');
      const applySql = String(queryMock.mock.calls[3][0]);
      expect(applySql).toContain('AND price > 0');
      expect(queryMock.mock.calls[3][1][3]).toBe(0.7);
    });

    it('supports neutral category type override with no price condition', async () => {
      querySequence(
        {
          rows: [
            {
              id: 25,
              name: 'Transfers',
              category_type: 'expense',
              parent_name: null,
            },
          ],
        },
        { rows: [{ id: 99, target_category: 'Transfers' }] },
        { rowCount: 0 },
        { rowCount: 0 },
      );

      const result = await rulesService.createAutoRule({
        transactionName: 'INTERNAL TRANSFER',
        categoryDefinitionId: 25,
        categoryType: 'transfer',
      });

      expect(result.message).toBe('Rule created successfully');
      const applySql = String(queryMock.mock.calls[3][0]);
      expect(applySql).not.toContain('AND price > 0');
      expect(applySql).not.toContain('AND price < 0');
      expect(queryMock.mock.calls[3][1][3]).toBe(0.8);
    });
  });

  describe('getRuleMatchCounts', () => {
    it('returns every rule count from a single query', async () => {
      querySequence({ rows: [{ id: 1, total: '3' }, { id: 2, total: 0 }] });

      await expect(rulesService.getRuleMatchCounts()).resolves.toEqual({ 1: 3, 2: 0 });
      expect(queryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('previewRuleMatches', () => {
    it('throws when no pattern or ruleId supplied', async () => {
      await expect(rulesService.previewRuleMatches({})).rejects.toMatchObject({ status: 400 });
    });

    it('derives pattern from ruleId and returns matches', async () => {
      querySequence(
        { rows: [{ name_pattern: 'amazon' }] },
        {
          rows: [
            {
              identifier: 'tx-1',
              vendor: 'Amazon',
              date: '2025-10-01',
              name: 'Amazon Prime',
              price: '-12.99',
              account_number: '1234',
              memo: null,
              category_name: 'Subscriptions',
              parent_category_name: 'Entertainment',
            },
          ],
        },
        { rows: [{ total: '1' }] },
      );

      const result = await rulesService.previewRuleMatches({ ruleId: 5, limit: 10 });

      expect(result.pattern).toBe('amazon');
      expect(result.totalCount).toBe(1);
      expect(result.limitApplied).toBe(10);
      expect(result.matchedTransactions[0]).toMatchObject({
        name: 'Amazon Prime',
        price: -12.99,
      });
    });

    it('throws when ruleId does not exist', async () => {
      querySequence({ rows: [] });
      await expect(rulesService.previewRuleMatches({ ruleId: 999 })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('defaults to limit 100 when limit is invalid', async () => {
      querySequence(
        { rows: [] },
        { rows: [{ total: '0' }] },
      );

      const result = await rulesService.previewRuleMatches({ pattern: 'uber', limit: -1 });
      expect(result.limitApplied).toBe(100);
      expect(queryMock.mock.calls[0][1][1]).toBe(100);
    });

    it('caps limit at 500 when request limit is too high', async () => {
      querySequence(
        { rows: [] },
        { rows: [{ total: '0' }] },
      );

      const result = await rulesService.previewRuleMatches({ pattern: 'uber', limit: 9999 });
      expect(result.limitApplied).toBe(500);
      expect(queryMock.mock.calls[0][1][1]).toBe(500);
    });
  });

  describe('applyCategorizationRules', () => {
    it('returns early when no rules present', async () => {
      getClientMock.mockResolvedValueOnce({ query: clientQueryMock, release: releaseMock });
      clientQueryMock.mockResolvedValueOnce({ rows: [] });

      const result = await rulesService.applyCategorizationRules();

      expect(result).toEqual({
        success: true,
        rulesApplied: 0,
        transactionsUpdated: 0,
      });
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });

    it('applies rules and returns transaction count', async () => {
      getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
      clientQueryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              name_pattern: 'NETFLIX',
              target_category: 'Streaming Services',
              category_definition_id: 200,
              category_type: 'expense',
            },
          ],
        }) // rules query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 200,
              name: 'Streaming Services',
              category_type: 'expense',
              parent_id: null,
              depth_level: 2,
              parent_name: 'Entertainment',
            },
          ],
        }) // all categories query
        .mockResolvedValueOnce({ rows: [{ id: 999 }] }) // bank category id
        .mockResolvedValueOnce({ rowCount: 3 }); // update

      const result = await rulesService.applyCategorizationRules();

      expect(result).toEqual({
        success: true,
        rulesApplied: 1,
        transactionsUpdated: 3,
      });
      expect(clientQueryMock).toHaveBeenCalledTimes(4);
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to target_category lookup and skips unresolved rules', async () => {
      getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
      clientQueryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              name_pattern: 'PAY',
              target_category: 'Salary',
              category_definition_id: null,
              category_type: null,
            },
            {
              id: 2,
              name_pattern: 'UNKNOWN',
              target_category: null,
              category_definition_id: 999,
              category_type: null,
            },
          ],
        }) // rules query
        .mockResolvedValueOnce({
          rows: [
            { id: 7, name: 'Salary', category_type: 'income', parent_id: null, depth_level: 2, parent_name: null },
          ],
        }) // all categories query (only Salary exists, 999 missing → rule 2 skipped)
        .mockResolvedValueOnce({ rows: [] }) // no bank category
        .mockResolvedValueOnce({ rowCount: 2 }); // update for income rule

      const result = await rulesService.applyCategorizationRules();

      expect(result).toEqual({
        success: true,
        rulesApplied: 1,
        transactionsUpdated: 2,
      });
      const updateSql = String(clientQueryMock.mock.calls[3][0]);
      expect(updateSql).toContain('AND price > 0');
      expect(clientQueryMock.mock.calls[3][1][4]).toBeNull();
    });

    it('always releases client when applying rules fails', async () => {
      getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
      clientQueryMock.mockRejectedValueOnce(new Error('query failed'));

      await expect(rulesService.applyCategorizationRules()).rejects.toThrow('query failed');
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('mergeCategories', () => {
    it('rejects when fewer than two source categories are provided', async () => {
      await expect(
        rulesService.mergeCategories({ sourceCategories: ['A'], newCategoryName: 'Merged' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects invalid new category name', async () => {
      await expect(
        rulesService.mergeCategories({ sourceCategories: ['A', 'B'], newCategoryName: '   ' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('merges categories and trims target name', async () => {
      queryMock.mockResolvedValueOnce({ rowCount: 3 });

      const result = await rulesService.mergeCategories({
        sourceCategories: ['Rent', 'Lease', 'Housing'],
        newCategoryName: '  Housing  ',
      });

      expect(result).toEqual({
        success: true,
        message: 'Successfully merged categories into "Housing"',
        updatedRows: 3,
      });
      expect(String(queryMock.mock.calls[0][0])).toContain('WHERE category IN ($2, $3, $4)');
      expect(queryMock.mock.calls[0][1]).toEqual(['Housing', 'Rent', 'Lease', 'Housing']);
    });
  });
});
