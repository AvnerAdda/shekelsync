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

  it('deleteRule executes delete statement', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    await rulesService.deleteRule({ id: 4 });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('DELETE FROM categorization_rules');
    expect(queryMock.mock.calls[0][1]).toEqual([4]);
  });

  describe('createAutoRule', () => {
    it('throws when required fields missing', async () => {
      await expect(rulesService.createAutoRule({})).rejects.toMatchObject({ status: 400 });
    });

    it('returns existing rule metadata when pattern already exists', async () => {
      queryMock
        .mockImplementationOnce(async () => ({ rows: [{ id: 99 }] }))
        .mockImplementationOnce(async () => ({
          rows: [
            {
              id: 99,
              name_pattern: 'SPOTIFY',
              target_category: 'Subscriptions',
              category_path: 'Entertainment > Subscriptions',
              category_definition_id: 55,
              category_type: 'expense',
            },
          ],
        }));

      await expect(
        rulesService.createAutoRule({
          transactionName: 'SPOTIFY',
          categoryDefinitionId: 10,
        }),
      ).resolves.toMatchObject({
        success: true,
        alreadyExists: true,
        rule: expect.objectContaining({ id: 99 }),
      });
    });

    it('creates rule using category metadata', async () => {
      querySequence(
        { rows: [] }, // existing rule check
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
        })
        .mockResolvedValueOnce({ rows: [{ id: 999 }] }) // bank category id
        .mockResolvedValueOnce({
          rows: [
            {
              id: 200,
              name: 'Streaming Services',
              category_type: 'expense',
              parent_name: 'Entertainment',
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 3 });

      const result = await rulesService.applyCategorizationRules();

      expect(result).toEqual({
        success: true,
        rulesApplied: 1,
        transactionsUpdated: 3,
      });
      expect(clientQueryMock).toHaveBeenCalledTimes(4);
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });
  });
});
