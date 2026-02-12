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
    serviceModule.__resetDatabase?.();
  });

  it('auto-detects allocation and variability from category keywords', () => {
    const nonExpense = serviceModule.autoDetectSpendingCategory('Salary', 'Salary', 'Income', 'income');
    expect(nonExpense).toEqual({ spendingCategory: null, confidence: 1, variabilityType: 'variable' });

    const growth = serviceModule.autoDetectSpendingCategory('השקעות', 'Investment plan', 'Finance', 'expense');
    expect(growth.spendingCategory).toBe('growth');
    expect(growth.confidence).toBeGreaterThan(0.8);

    const essentialFixed = serviceModule.autoDetectSpendingCategory('שכירות', 'rent', 'housing', 'expense');
    expect(essentialFixed.spendingCategory).toBe('essential');
    expect(essentialFixed.variabilityType).toBe('fixed');

    const rewardSeasonal = serviceModule.autoDetectSpendingCategory('טיול', 'travel', 'vacation', 'expense');
    expect(rewardSeasonal.spendingCategory).toBe('reward');
    expect(rewardSeasonal.variabilityType).toBe('seasonal');
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
    expect(result.total_spending).toBe(350);

    const growth = result.breakdown.find((item: any) => item.spending_category === 'growth');
    const essential = result.breakdown.find((item: any) => item.spending_category === 'essential');

    expect(growth.total_amount).toBe(60); // 100 minus 40 capital return offset
    expect(growth.status).toBe('on_track');
    expect(essential.status).toBe('over');
    expect(result.categories_by_allocation.essential).toHaveLength(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
