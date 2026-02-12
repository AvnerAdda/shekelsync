import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findCategoryByName,
  getCategoryInfo,
  matchCategorizationRule,
  normalizeCategoryPath,
  resolveCategory,
} from '../category-helpers.js';

const database = require('../../server/services/database.js');

describe('category-helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes category paths by trimming segments', () => {
    expect(normalizeCategoryPath(' Food > Dining > Restaurants ')).toBe('Food > Dining > Restaurants');
    expect(normalizeCategoryPath(null)).toBeNull();
  });

  it('finds categories by name with and without parent filter', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Food' }] })
        .mockResolvedValueOnce({ rows: [{ id: 2, name: 'Dining' }] }),
    };

    await findCategoryByName(' Food ', null, client);
    await findCategoryByName(' Dining ', 10, client);

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0][1]).toEqual(['food']);
    expect(client.query.mock.calls[1][0]).toContain('AND parent_id = $2');
    expect(client.query.mock.calls[1][1]).toEqual(['dining', 10]);
  });

  it('matches categorization rules case-insensitively', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: 1, name_pattern: 'groceries', category_definition_id: 11 },
          { id: 2, name_pattern: 'coffee shop', category_definition_id: 12 },
        ],
      }),
    };

    const match = await matchCategorizationRule('Morning COFFEE SHOP purchase', client);
    expect(match).toMatchObject({ id: 2, category_definition_id: 12 });
  });

  it('returns null when no categorization rule matches', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 1, name_pattern: 'groceries', category_definition_id: 11 }],
      }),
    };

    const match = await matchCategorizationRule('Cinema ticket', client);
    expect(match).toBeNull();
  });

  it('returns null category info for empty category id', async () => {
    const client = { query: vi.fn() };
    const result = await getCategoryInfo(null, client);
    expect(result).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('uses provided client when loading category info', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 5, name: 'Transport', parent_id: null, parent_name: null }],
      }),
      release: vi.fn(),
    };
    const getClientSpy = vi.spyOn(database, 'getClient');

    const result = await getCategoryInfo(5, client);

    expect(result).toMatchObject({ id: 5, name: 'Transport' });
    expect(getClientSpy).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });

  it('acquires and releases DB client when category info is loaded without explicit client', async () => {
    const release = vi.fn();
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 6, name: 'Bills', parent_id: null, parent_name: null }],
      }),
      release,
    };
    const getClientSpy = vi.spyOn(database, 'getClient').mockResolvedValue(client);

    const result = await getCategoryInfo(6);

    expect(result).toMatchObject({ id: 6, name: 'Bills' });
    expect(getClientSpy).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('still releases DB client when category info query fails', async () => {
    const release = vi.fn();
    const client = {
      query: vi.fn().mockRejectedValue(new Error('query failed')),
      release,
    };
    vi.spyOn(database, 'getClient').mockResolvedValue(client);

    await expect(getCategoryInfo(99)).rejects.toThrow('query failed');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('resolves category via mapping then enriches via category definition', async () => {
    const query = vi.fn()
      // resolveCategoryFromMapping
      .mockResolvedValueOnce({
        rows: [
          {
            category_definition_id: 1,
            subcategory: 'Dining',
            parent_id: 2,
            parent_category: 'Food',
          },
        ],
      })
      // getCategoryInfo
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'Dining',
            name_en: 'Dining',
            category_type: 'expense',
            parent_id: 2,
            parent_name: 'Food',
            parent_name_en: 'Food',
          },
        ],
      });

    const client = { query };

    const result = await resolveCategory({
      client,
      rawCategory: 'Dining',
      transactionName: 'Dinner at restaurant',
    });

    expect(result).toEqual({
      categoryDefinitionId: 1,
      parentCategory: 'Food',
      subcategory: 'Dining',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('falls back to rule matching when mapping is empty', async () => {
    const query = vi.fn()
      // resolveCategoryFromMapping -> empty
      .mockResolvedValueOnce({ rows: [] })
      // matchCategorizationRule -> rows with pattern match
      .mockResolvedValueOnce({
        rows: [
          {
            name_pattern: 'coffee shop',
            category_definition_id: 3,
            subcategory: 'Coffee',
            parent_category: 'Food',
            parent_id: 2,
          },
        ],
      })
      // getCategoryInfo
      .mockResolvedValueOnce({
        rows: [
          {
            id: 3,
            name: 'Coffee',
            name_en: 'Coffee',
            category_type: 'expense',
            parent_id: 2,
            parent_name: 'Food',
            parent_name_en: 'Food',
          },
        ],
      });

    const client = { query };

    const result = await resolveCategory({
      client,
      rawCategory: 'Unknown',
      transactionName: 'Morning coffee shop visit',
    });

    expect(result).toEqual({
      categoryDefinitionId: 3,
      parentCategory: 'Food',
      subcategory: 'Coffee',
    });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('falls back to direct category-name lookup when mapping and rule matching fail', async () => {
    const query = vi.fn()
      // resolveCategoryFromMapping -> empty
      .mockResolvedValueOnce({ rows: [] })
      // matchCategorizationRule -> no match
      .mockResolvedValueOnce({ rows: [] })
      // findCategoryByName -> found top-level category
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            name: 'Transport',
            category_type: 'expense',
            parent_id: null,
          },
        ],
      })
      // getCategoryInfo
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            name: 'Transport',
            name_en: 'Transport',
            category_type: 'expense',
            parent_id: null,
            parent_name: null,
          },
        ],
      });

    const client = { query };
    const result = await resolveCategory({
      client,
      rawCategory: 'Transport',
      transactionName: 'No rule should match this',
    });

    expect(result).toEqual({
      categoryDefinitionId: 7,
      parentCategory: 'Transport',
      subcategory: null,
    });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('returns null when no category mapping, rule, or name match exists', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // mapping
      .mockResolvedValueOnce({ rows: [] }) // rules
      .mockResolvedValueOnce({ rows: [] }); // by name

    const result = await resolveCategory({
      client: { query },
      rawCategory: 'Unknown',
      transactionName: 'Unknown merchant',
    });

    expect(result).toBeNull();
  });
});
