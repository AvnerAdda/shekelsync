import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let serviceModule: any;

function createSchemaAwareClient(extraImpl?: (sql: string, params?: any[]) => Promise<any>) {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    const text = String(sql);

    if (text.includes('PRAGMA table_info(spending_category_mappings)')) {
      return { rows: [{ name: 'spending_category', notnull: 0 }] };
    }
    if (text.includes('PRAGMA table_info(spending_category_targets)')) {
      return { rows: [{ name: 'spending_category', notnull: 1 }] };
    }
    if (text.includes("sqlite_master") && text.includes('spending_category_mappings')) {
      return { rows: [{ sql: 'CREATE TABLE spending_category_mappings (spending_category TEXT)' }] };
    }
    if (text.includes("sqlite_master") && text.includes('spending_category_targets')) {
      return { rows: [{ sql: 'CREATE TABLE spending_category_targets (spending_category TEXT)' }] };
    }
    if (text.startsWith('INSERT OR IGNORE INTO spending_category_targets')) {
      return { rows: [], rowCount: 4 };
    }
    if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(text.trim())) {
      return { rows: [], rowCount: 0 };
    }

    if (extraImpl) {
      return extraImpl(text, params);
    }

    return { rows: [], rowCount: 0 };
  });

  return {
    query,
    release: vi.fn(),
  };
}

beforeAll(async () => {
  serviceModule = await import('../analytics/spending-categories.js');
});

describe('spending categories service advanced coverage', () => {
  let client: ReturnType<typeof createSchemaAwareClient>;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = createSchemaAwareClient();

    serviceModule.__setDatabase({
      getClient: async () => client,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    serviceModule.__resetDatabase?.();
  });

  it('auto-detects allocation and variability from category keywords', () => {
    const nonExpense = serviceModule.autoDetectSpendingCategory('Salary', 'Salary', 'Income', 'income');
    expect(nonExpense).toEqual({ spendingCategory: null, confidence: 1, variabilityType: 'variable' });

    const growth = serviceModule.autoDetectSpendingCategory('השקעות', 'Investment plan', 'Finance', 'expense');
    expect(growth.spendingCategory).toBe('growth');
    expect(growth.confidence).toBeGreaterThan(0.8);

    const stability = serviceModule.autoDetectSpendingCategory('הלוואה', 'Loan payment', 'Debt', 'expense');
    expect(stability.spendingCategory).toBe('stability');
    expect(stability.confidence).toBe(0.85);

    const essentialFixed = serviceModule.autoDetectSpendingCategory('שכירות', 'rent', 'housing', 'expense');
    expect(essentialFixed.spendingCategory).toBe('essential');
    expect(essentialFixed.variabilityType).toBe('fixed');

    const rewardSeasonal = serviceModule.autoDetectSpendingCategory('טיול', 'travel', 'vacation', 'expense');
    expect(rewardSeasonal.spendingCategory).toBe('reward');
    expect(rewardSeasonal.variabilityType).toBe('seasonal');
  });

  it('falls back cleanly when auto-detect input names are missing', () => {
    const fallback = serviceModule.autoDetectSpendingCategory(undefined, undefined, undefined, 'expense');
    expect(fallback).toEqual({
      spendingCategory: null,
      confidence: 0.5,
      variabilityType: 'variable',
    });
  });

  it('returns filtered mappings by spending category and definition id', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('FROM spending_category_mappings scm')) {
        expect(sql).toContain('scm.spending_category = $1');
        expect(sql).toContain('scm.category_definition_id = $2');
        expect(params).toEqual(['essential', 7]);
        return {
          rows: [
            {
              category_definition_id: 7,
              spending_category: 'essential',
              category_name: 'Rent',
            },
          ],
        };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryMappings({
      spendingCategory: 'essential',
      categoryDefinitionId: 7,
    });

    expect(result.mappings).toHaveLength(1);
    expect(result.mappings[0].category_definition_id).toBe(7);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('skips schema checks after first validation in the same process', async () => {
    client = createSchemaAwareClient(async (sql) => {
      if (sql.includes('FROM spending_category_mappings scm')) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    await serviceModule.getSpendingCategoryMappings();
    await serviceModule.getSpendingCategoryMappings();

    const mappingPragmaCalls = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('PRAGMA table_info(spending_category_mappings)'),
    );
    const targetsPragmaCalls = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('PRAGMA table_info(spending_category_targets)'),
    );
    const mappingSelectCalls = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('FROM spending_category_mappings scm'),
    );

    expect(mappingPragmaCalls).toHaveLength(1);
    expect(targetsPragmaCalls).toHaveLength(1);
    expect(mappingSelectCalls).toHaveLength(2);
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it('migrates legacy spending category mappings table and recreates indexes', async () => {
    client = {
      query: vi.fn(async (sql: string) => {
        const text = String(sql);
        if (text.includes('PRAGMA table_info(spending_category_mappings)')) {
          return { rows: [{ name: 'spending_category', notnull: 1 }] };
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_mappings')) {
          return {
            rows: [
              {
                sql: "CREATE TABLE spending_category_mappings (spending_category TEXT NOT NULL CHECK(spending_category IN ('essential', 'growth', 'stability', 'reward', 'other')))",
              },
            ],
          };
        }
        if (text.includes('PRAGMA table_info(spending_category_targets)')) {
          return { rows: [{ name: 'spending_category', notnull: 1 }] };
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_targets')) {
          return { rows: [{ sql: 'CREATE TABLE spending_category_targets (spending_category TEXT)' }] };
        }
        if (text.includes('FROM spending_category_mappings scm')) {
          return { rows: [] };
        }
        if (text.startsWith('INSERT OR IGNORE INTO spending_category_targets')) {
          return { rows: [], rowCount: 4 };
        }
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(text.trim())) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    } as any;

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryMappings();
    expect(result).toEqual({ mappings: [] });

    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('DROP TABLE IF EXISTS spending_category_mappings_new')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('INSERT INTO spending_category_mappings_new')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('DROP TABLE spending_category_mappings')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('ALTER TABLE spending_category_mappings_new RENAME TO spending_category_mappings')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('idx_spending_category_mappings_category_id')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('idx_spending_category_mappings_spending_cat')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('idx_spending_category_mappings_variability')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('idx_spending_mappings_unallocated')),
    ).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back spending category mappings migration when table creation fails', async () => {
    client = {
      query: vi.fn(async (sql: string) => {
        const text = String(sql);
        if (text.includes('PRAGMA table_info(spending_category_mappings)')) {
          return { rows: [{ name: 'spending_category', notnull: 1 }] };
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_mappings')) {
          return {
            rows: [
              {
                sql: "CREATE TABLE spending_category_mappings (spending_category TEXT NOT NULL CHECK(spending_category IN ('essential', 'growth', 'stability', 'reward', 'other')))",
              },
            ],
          };
        }
        if (text.includes('CREATE TABLE spending_category_mappings_new')) {
          throw new Error('mapping migration failed');
        }
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(text.trim())) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    } as any;

    serviceModule.__setDatabase({ getClient: async () => client });

    await expect(serviceModule.getSpendingCategoryMappings()).rejects.toThrow('mapping migration failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('migrates legacy spending category targets table when schema contains other values', async () => {
    client = {
      query: vi.fn(async (sql: string) => {
        const text = String(sql);
        if (text.includes('PRAGMA table_info(spending_category_mappings)')) {
          return { rows: [{ name: 'spending_category', notnull: 0 }] };
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_mappings')) {
          return { rows: [{ sql: 'CREATE TABLE spending_category_mappings (spending_category TEXT)' }] };
        }
        if (text.includes('PRAGMA table_info(spending_category_targets)')) {
          return { rows: [{ name: 'spending_category', notnull: 1 }] };
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_targets')) {
          return {
            rows: [
              {
                sql: "CREATE TABLE spending_category_targets (spending_category TEXT CHECK(spending_category IN ('essential', 'growth', 'stability', 'reward', 'other')))",
              },
            ],
          };
        }
        if (text.includes('FROM spending_category_mappings scm')) {
          return { rows: [] };
        }
        if (text.startsWith('INSERT OR IGNORE INTO spending_category_targets')) {
          return { rows: [], rowCount: 4 };
        }
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(text.trim())) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    } as any;

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryMappings();
    expect(result).toEqual({ mappings: [] });

    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('DROP TABLE IF EXISTS spending_category_targets_new')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('INSERT INTO spending_category_targets_new')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('DROP TABLE spending_category_targets')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('ALTER TABLE spending_category_targets_new RENAME TO spending_category_targets')),
    ).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back spending category targets migration when target table recreation fails', async () => {
    client = {
      query: vi.fn(async (sql: string) => {
        const text = String(sql);
        if (text.includes('PRAGMA table_info(spending_category_mappings)')) {
          return { rows: [{ name: 'spending_category', notnull: 0 }] };
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_mappings')) {
          return { rows: [{ sql: 'CREATE TABLE spending_category_mappings (spending_category TEXT)' }] };
        }
        if (text.includes('PRAGMA table_info(spending_category_targets)')) {
          return { rows: [{ name: 'spending_category', notnull: 1 }] };
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_targets')) {
          return {
            rows: [
              {
                sql: "CREATE TABLE spending_category_targets (spending_category TEXT CHECK(spending_category IN ('essential', 'growth', 'stability', 'reward', 'other')))",
              },
            ],
          };
        }
        if (text.includes('CREATE TABLE spending_category_targets_new')) {
          throw new Error('target migration failed');
        }
        if (text.startsWith('INSERT OR IGNORE INTO spending_category_targets')) {
          return { rows: [], rowCount: 4 };
        }
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(text.trim())) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    } as any;

    serviceModule.__setDatabase({ getClient: async () => client });

    await expect(serviceModule.getSpendingCategoryMappings()).rejects.toThrow('target migration failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('bootstraps schema when metadata queries return empty arrays', async () => {
    client = {
      query: vi.fn(async (sql: string) => {
        const text = String(sql);
        if (text.includes('PRAGMA table_info(spending_category_mappings)')) {
          return [];
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_mappings')) {
          return { rows: null };
        }
        if (text.includes('PRAGMA table_info(spending_category_targets)')) {
          return [];
        }
        if (text.includes("sqlite_master") && text.includes('spending_category_targets')) {
          return { rows: [] };
        }
        if (text.includes('FROM spending_category_mappings scm')) {
          return { rows: [] };
        }
        if (text.startsWith('INSERT OR IGNORE INTO spending_category_targets')) {
          return { rows: [], rowCount: 4 };
        }
        if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(text.trim())) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    } as any;

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryMappings();
    expect(result).toEqual({ mappings: [] });

    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('INSERT INTO spending_category_mappings_new')),
    ).toBe(false);
    expect(
      client.query.mock.calls.some(([sql]: [string]) =>
        String(sql).includes('INSERT INTO spending_category_targets_new')),
    ).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects mapping update without fields', async () => {
    await expect(serviceModule.updateSpendingCategoryMapping(99, {})).rejects.toThrow('No fields to update');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('inserts mapping when update target does not exist', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('UPDATE spending_category_mappings')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO spending_category_mappings')) {
        expect(params).toEqual([12, 'growth', 'fixed', 1, 35, 'manual note']);
        return {
          rows: [
            {
              category_definition_id: 12,
              spending_category: 'growth',
              variability_type: 'fixed',
              user_overridden: 1,
              target_percentage: 35,
              notes: 'manual note',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.updateSpendingCategoryMapping(12, {
      spendingCategory: 'growth',
      variabilityType: 'fixed',
      targetPercentage: 35,
      notes: 'manual note',
    });

    expect(result.mapping.category_definition_id).toBe(12);
    expect(result.mapping.spending_category).toBe('growth');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns updated mapping when update affects an existing row', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('UPDATE spending_category_mappings')) {
        expect(params).toEqual(['reward', 'seasonal', 18]);
        return {
          rows: [
            {
              category_definition_id: 18,
              spending_category: 'reward',
              variability_type: 'seasonal',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('INSERT INTO spending_category_mappings')) {
        throw new Error('Insert should not run when update returned rows');
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.updateSpendingCategoryMapping(18, {
      spendingCategory: 'reward',
      variabilityType: 'seasonal',
    });

    expect(result.mapping).toMatchObject({
      category_definition_id: 18,
      spending_category: 'reward',
      variability_type: 'seasonal',
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('inserts fallback defaults when updating a non-existing row without spending category', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('UPDATE spending_category_mappings')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO spending_category_mappings')) {
        expect(params).toEqual([33, null, 'variable', 0, 25, null]);
        return {
          rows: [
            {
              category_definition_id: 33,
              spending_category: null,
              variability_type: 'variable',
              user_overridden: 0,
              target_percentage: 25,
              notes: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.updateSpendingCategoryMapping(33, {
      targetPercentage: 25,
    });

    expect(result.mapping).toMatchObject({
      category_definition_id: 33,
      spending_category: null,
      variability_type: 'variable',
      user_overridden: 0,
      target_percentage: 25,
      notes: null,
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('uses null defaults for target and notes when inserting a null spending category mapping', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('UPDATE spending_category_mappings')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO spending_category_mappings')) {
        expect(params).toEqual([34, null, 'variable', 1, null, null]);
        return {
          rows: [
            {
              category_definition_id: 34,
              spending_category: null,
              variability_type: 'variable',
              user_overridden: 1,
              target_percentage: null,
              notes: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.updateSpendingCategoryMapping(34, {
      spendingCategory: null,
    });

    expect(result.mapping).toMatchObject({
      category_definition_id: 34,
      spending_category: null,
      variability_type: 'variable',
      user_overridden: 1,
      target_percentage: null,
      notes: null,
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('bulk assigns categories by updating existing and inserting missing mappings', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('SELECT id FROM spending_category_mappings WHERE category_definition_id = $1')) {
        if (params?.[0] === 1) {
          return { rows: [{ id: 55 }] };
        }
        return { rows: [] };
      }
      return { rows: [], rowCount: 1 };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.bulkAssignCategories([1, 2], 'reward');

    expect(result).toEqual({ success: true, updated: 2 });
    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE spending_category_mappings')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO spending_category_mappings')),
    ).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('validates target totals and updates active targets', async () => {
    await expect(
      serviceModule.updateSpendingCategoryTargets({ essential: 40, growth: 20, stability: 20, reward: 10 }),
    ).rejects.toThrow('Target percentages must sum to 100%');

    client = createSchemaAwareClient(async () => ({ rows: [], rowCount: 1 }));
    serviceModule.__setDatabase({ getClient: async () => client });

    const validTargets = { essential: 50, growth: 20, stability: 15, reward: 15 };
    const result = await serviceModule.updateSpendingCategoryTargets(validTargets);

    expect(result).toEqual({ success: true, targets: validTargets });
    const upserts = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO spending_category_targets'),
    );
    expect(upserts).toHaveLength(4);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('initializes mappings and reports created/skipped totals', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('FROM category_definitions cd') && sql.includes("cd.category_type = 'expense'")) {
        return {
          rows: [
            { id: 1, name: 'שכירות', name_en: 'Rent', parent_name: 'Housing', category_type: 'expense' },
            { id: 2, name: 'בידור', name_en: 'Entertainment', parent_name: 'Leisure', category_type: 'expense' },
          ],
        };
      }
      if (sql.includes('SELECT id FROM spending_category_mappings WHERE category_definition_id = $1')) {
        if (params?.[0] === 1) {
          return { rows: [{ id: 9 }] };
        }
        return { rows: [] };
      }
      return { rows: [], rowCount: 1 };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.initializeSpendingCategories();

    expect(result.success).toBe(true);
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('builds breakdown with target variance and capital-return growth offset', async () => {
    client = createSchemaAwareClient(async (sql) => {
      if (sql.includes('total_income')) {
        return { rows: [{ total_income: '1000' }] };
      }
      if (sql.includes('total_salary')) {
        return { rows: [{ total_salary: '900' }] };
      }
      if (sql.includes('avg_transaction') && sql.includes('GROUP BY COALESCE(scm.spending_category')) {
        return {
          rows: [
            {
              spending_category: 'essential',
              transaction_count: '4',
              total_amount: '200',
              avg_transaction: '50',
            },
            {
              spending_category: 'growth',
              transaction_count: '2',
              total_amount: '100',
              avg_transaction: '50',
            },
            {
              spending_category: null,
              transaction_count: '1',
              total_amount: '50',
              avg_transaction: '50',
            },
          ],
        };
      }
      if (sql.includes('AND t.price > 0') && sql.includes('category_definition_id IN')) {
        return { rows: [{ total_amount: '40' }] };
      }
      if (sql.includes('FROM spending_category_targets')) {
        return {
          rows: [
            { spending_category: 'essential', target_percentage: '50' },
            { spending_category: 'growth', target_percentage: '20' },
          ],
        };
      }
      if (sql.includes('allocation_type') && sql.includes('FROM category_definitions cd')) {
        return {
          rows: [
            {
              allocation_type: 'essential',
              category_definition_id: 10,
              category_name: 'Rent',
              category_name_en: 'Rent',
              category_name_fr: 'Loyer',
              icon: 'home',
              spending_category: 'essential',
              total_amount: '200',
              transaction_count: '4',
            },
            {
              allocation_type: 'surprise_bucket',
              category_definition_id: 44,
              category_name: 'Unknown Bucket Category',
              category_name_en: 'Unknown Bucket Category',
              category_name_fr: null,
              icon: null,
              spending_category: 'growth',
              total_amount: '10',
              transaction_count: '1',
            },
          ],
        };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryBreakdown({
      startDate: '2026-02-01',
      endDate: '2026-02-10',
    });

    expect(result.total_income).toBe(1000);
    expect(result.total_salary).toBe(900);
    expect(result.total_spending).toBe(350);

    const growth = result.breakdown.find((item: any) => item.spending_category === 'growth');
    const essential = result.breakdown.find((item: any) => item.spending_category === 'essential');

    expect(growth.total_amount).toBe(60); // 100 minus 40 capital return offset
    expect(growth.status).toBe('on_track');
    expect(essential.status).toBe('over');
    expect(result.categories_by_allocation.essential).toHaveLength(1);
    expect(result.categories_by_allocation.unallocated).toHaveLength(1);
    expect(result.categories_by_allocation.unallocated[0].category_definition_id).toBe(44);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('computes zero-total breakdowns with other->unallocated mapping and under status', async () => {
    client = createSchemaAwareClient(async (sql) => {
      if (sql.includes('total_income')) {
        return { rows: [{ total_income: null }] };
      }
      if (sql.includes('total_salary')) {
        return { rows: [{ total_salary: null }] };
      }
      if (sql.includes('avg_transaction') && sql.includes('GROUP BY COALESCE(scm.spending_category')) {
        return {
          rows: [
            {
              spending_category: 'essential',
              transaction_count: null,
              total_amount: null,
              avg_transaction: null,
            },
            {
              spending_category: 'other',
              transaction_count: null,
              total_amount: null,
              avg_transaction: null,
            },
          ],
        };
      }
      if (sql.includes('AND t.price > 0') && sql.includes('category_definition_id IN')) {
        return { rows: [{ total_amount: null }] };
      }
      if (sql.includes('FROM spending_category_targets')) {
        return {
          rows: [{ spending_category: 'essential', target_percentage: '60' }],
        };
      }
      if (sql.includes('allocation_type') && sql.includes('FROM category_definitions cd')) {
        return {
          rows: [
            {
              allocation_type: 'essential',
              category_definition_id: 99,
              category_name: 'Other-mapped category',
              category_name_en: 'Other-mapped category',
              category_name_fr: null,
              icon: null,
              spending_category: 'other',
              total_amount: null,
              transaction_count: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryBreakdown({
      startDate: '2026-02-01',
      endDate: '2026-02-10',
    });

    const essential = result.breakdown.find((item: any) => item.spending_category === 'essential');
    const unallocated = result.breakdown.find((item: any) => item.spending_category === 'unallocated');

    expect(result.total_income).toBe(0);
    expect(result.total_salary).toBe(0);
    expect(result.total_spending).toBe(0);
    expect(essential).toMatchObject({
      total_amount: 0,
      avg_transaction: 0,
      transaction_count: 0,
      actual_percentage: 0,
      target_percentage: 60,
      status: 'under',
    });
    expect(unallocated).toMatchObject({
      total_amount: 0,
      avg_transaction: 0,
      transaction_count: 0,
      actual_percentage: 0,
      target_percentage: 0,
      status: 'on_track',
    });
    expect(result.categories_by_allocation.essential).toHaveLength(1);
    expect(result.categories_by_allocation.essential[0]).toMatchObject({
      category_definition_id: 99,
      spending_category: null,
      total_amount: 0,
      percentage_of_income: 0,
      transaction_count: 0,
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('handles growth adjustment and null target/category totals with numeric fallbacks', async () => {
    client = createSchemaAwareClient(async (sql) => {
      if (sql.includes('total_income')) {
        return { rows: [{ total_income: '200' }] };
      }
      if (sql.includes('total_salary')) {
        return { rows: [{ total_salary: '100' }] };
      }
      if (sql.includes('avg_transaction') && sql.includes('GROUP BY COALESCE(scm.spending_category')) {
        return {
          rows: [
            {
              spending_category: 'growth',
              transaction_count: '1',
              total_amount: null,
              avg_transaction: null,
            },
          ],
        };
      }
      if (sql.includes('AND t.price > 0') && sql.includes('category_definition_id IN')) {
        return { rows: [{ total_amount: '5' }] };
      }
      if (sql.includes('FROM spending_category_targets')) {
        return {
          rows: [{ spending_category: 'growth', target_percentage: null }],
        };
      }
      if (sql.includes('allocation_type') && sql.includes('FROM category_definitions cd')) {
        return {
          rows: [
            {
              allocation_type: 'growth',
              category_definition_id: 15,
              category_name: 'Brokerage',
              category_name_en: 'Brokerage',
              category_name_fr: 'Courtage',
              icon: 'chart',
              spending_category: 'growth',
              total_amount: null,
              transaction_count: '2',
            },
          ],
        };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryBreakdown({
      startDate: '2026-02-01',
      endDate: '2026-02-10',
    });

    const growth = result.breakdown.find((item: any) => item.spending_category === 'growth');

    expect(growth).toMatchObject({
      total_amount: 0,
      avg_transaction: 0,
      target_percentage: 0,
      actual_percentage: 0,
    });
    expect(result.categories_by_allocation.growth).toHaveLength(1);
    expect(result.categories_by_allocation.growth[0]).toMatchObject({
      category_definition_id: 15,
      total_amount: 0,
      percentage_of_income: 0,
      transaction_count: 2,
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('uses current month boundaries when currentMonthOnly is true', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T12:00:00Z'));

    const now = new Date();
    const expectedStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const expectedEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('AS category_name') && sql.includes('LIMIT $4 OFFSET $5')) {
        expect(new Date(params?.[0]).toISOString().slice(0, 10)).toBe(expectedStart);
        expect(new Date(params?.[1]).toISOString().slice(0, 10)).toBe(expectedEnd);
        return { rows: [] };
      }
      if (sql.includes('COUNT(*) AS total_count') && sql.includes('COALESCE(SUM(ABS(t.price)), 0)')) {
        expect(new Date(params?.[0]).toISOString().slice(0, 10)).toBe(expectedStart);
        expect(new Date(params?.[1]).toISOString().slice(0, 10)).toBe(expectedEnd);
        return { rows: [{ total_count: '0', total_amount: '0' }] };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryTransactions({
      spendingCategory: 'essential',
      currentMonthOnly: true,
    });

    expect(result.period).toEqual({ start: expectedStart, end: expectedEnd });
    expect(result.transactions).toEqual([]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns spending-category transactions with totals', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('AS category_name') && sql.includes('LIMIT $4 OFFSET $5')) {
        expect(new Date(params?.[0]).toISOString().slice(0, 10)).toBe('2026-02-01');
        expect(new Date(params?.[1]).toISOString().slice(0, 10)).toBe('2026-02-10');
        expect(params?.[2]).toBe('essential');
        expect(params?.[3]).toBe(2);
        expect(params?.[4]).toBe(0);
        return {
          rows: [
            {
              identifier: 'txn-1',
              vendor: 'supermarket',
              name: 'Grocery run',
              date: '2026-02-05',
              price: '-120',
              account_number: '1111',
              category_definition_id: 10,
              category_type: 'expense',
              status: 'completed',
              category_name: 'Groceries',
              category_name_en: 'Groceries',
              category_name_fr: 'Courses',
            },
          ],
        };
      }
      if (sql.includes('COUNT(*) AS total_count') && sql.includes('COALESCE(SUM(ABS(t.price)), 0)')) {
        expect(new Date(params?.[0]).toISOString().slice(0, 10)).toBe('2026-02-01');
        expect(new Date(params?.[1]).toISOString().slice(0, 10)).toBe('2026-02-10');
        expect(params?.[2]).toBe('essential');
        return { rows: [{ total_count: '1', total_amount: '120' }] };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryTransactions({
      spendingCategory: 'essential',
      startDate: '2026-02-01',
      endDate: '2026-02-10',
      limit: 2,
    });

    expect(result.spending_category).toBe('essential');
    expect(result.total_count).toBe(1);
    expect(result.total_amount).toBe(120);
    expect(result.transactions[0]).toMatchObject({
      identifier: 'txn-1',
      price: -120,
      category_name: 'Groceries',
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('falls back to default summary values and normalizes nullable transaction fields', async () => {
    client = createSchemaAwareClient(async (sql, params) => {
      if (sql.includes('AS category_name') && sql.includes('LIMIT $4 OFFSET $5')) {
        expect(new Date(params?.[0]).toISOString().slice(0, 10)).toBe('2026-02-01');
        expect(new Date(params?.[1]).toISOString().slice(0, 10)).toBe('2026-02-10');
        expect(params?.[2]).toBe('growth');
        expect(params?.[3]).toBe(1); // clamped from below-min input
        expect(params?.[4]).toBe(0); // clamped from negative input
        return {
          rows: [
            {
              identifier: 'txn-nullable',
              vendor: null,
              name: null,
              date: '2026-02-08',
              price: null,
              account_number: null,
              category_definition_id: null,
              category_type: null,
              status: null,
              category_name: null,
              category_name_en: null,
              category_name_fr: null,
            },
          ],
        };
      }
      if (sql.includes('COUNT(*) AS total_count') && sql.includes('COALESCE(SUM(ABS(t.price)), 0)')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryTransactions({
      spendingCategory: 'growth',
      startDate: '2026-02-01',
      endDate: '2026-02-10',
      limit: 0,
      offset: -10,
    });

    expect(result.total_count).toBe(0);
    expect(result.total_amount).toBe(0);
    expect(result.limit).toBe(1);
    expect(result.offset).toBe(0);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      identifier: 'txn-nullable',
      price: 0,
      account_number: null,
      category_definition_id: null,
      category_type: null,
      status: null,
      category_name: null,
      category_name_en: null,
      category_name_fr: null,
    });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects transactions query when spending category is missing', async () => {
    await expect(
      serviceModule.getSpendingCategoryTransactions({
        startDate: '2026-02-01',
        endDate: '2026-02-10',
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Invalid spending category' });
  });

  it('supports resetting injected database with undefined and then re-injecting a mock', async () => {
    serviceModule.__setDatabase(undefined);

    client = createSchemaAwareClient(async (sql) => {
      if (sql.includes('FROM spending_category_mappings scm')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    serviceModule.__setDatabase({ getClient: async () => client });

    const result = await serviceModule.getSpendingCategoryMappings();
    expect(result).toEqual({ mappings: [] });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid spending category transactions query', async () => {
    await expect(
      serviceModule.getSpendingCategoryTransactions({ spendingCategory: 'invalid' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
