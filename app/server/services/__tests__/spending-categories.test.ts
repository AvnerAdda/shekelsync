import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();

let serviceModule: any;
let getSpendingCategoryBreakdown: any;
let queryQueue: any[] = [];

beforeAll(async () => {
  serviceModule = await import('../analytics/spending-categories.js');
  getSpendingCategoryBreakdown =
    serviceModule.getSpendingCategoryBreakdown ??
    serviceModule.default?.getSpendingCategoryBreakdown;
});

beforeEach(() => {
  queryMock.mockReset();
  releaseMock.mockReset();
  queryQueue = [];

  queryMock.mockImplementation((sql: string) => {
    if (sql.includes('PRAGMA table_info(spending_category_mappings)')) {
      return Promise.resolve({ rows: [{ name: 'spending_category', notnull: 0 }] });
    }
    if (sql.includes('PRAGMA table_info(spending_category_targets)')) {
      return Promise.resolve({ rows: [{ name: 'spending_category', notnull: 1 }] });
    }
    if (sql.includes("sqlite_master") && sql.includes('spending_category_mappings')) {
      return Promise.resolve({ rows: [{ sql: "CREATE TABLE spending_category_mappings (spending_category TEXT)" }] });
    }
    if (sql.includes("sqlite_master") && sql.includes('spending_category_targets')) {
      return Promise.resolve({ rows: [{ sql: "CREATE TABLE spending_category_targets (spending_category TEXT)" }] });
    }
    if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('spending_category_mappings_new') || sql.includes('spending_category_targets_new')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('CREATE INDEX') || sql.startsWith('ALTER TABLE spending_category')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('SELECT COALESCE(SUM(t.price)') && sql.includes('total_income')) {
      const next = queryQueue.shift();
      return Promise.resolve(next ?? { rows: [] });
    }
    if (sql.includes('COALESCE(NULLIF(scm.spending_category') && sql.includes('avg_transaction')) {
      const next = queryQueue.shift();
      return Promise.resolve(next ?? { rows: [] });
    }
    if (sql.includes('FROM spending_category_targets') && sql.includes('target_percentage')) {
      const next = queryQueue.shift();
      return Promise.resolve(next ?? { rows: [] });
    }
    if (sql.includes('allocation_type') && sql.includes('category_definitions')) {
      const next = queryQueue.shift();
      return Promise.resolve(next ?? { rows: [] });
    }
    if (sql.startsWith('INSERT OR IGNORE INTO spending_category_targets')) {
      return Promise.resolve({ rows: [], rowCount: 4 });
    }

    return Promise.resolve({ rows: [] });
  });

  const mockClient = {
    query: queryMock,
    release: releaseMock,
  };
  serviceModule.__setDatabase?.({
    getClient: async () => mockClient,
  });
});

afterEach(() => {
  serviceModule.__resetDatabase?.();
});

describe('spending categories service', () => {
  it('marks missing spending_category entries as unallocated', async () => {
    queryQueue.push(
      // total income
      { rows: [{ total_income: '100' }] },
      // spending breakdown
      {
        rows: [
          {
            spending_category: null,
            transaction_count: '2',
            total_amount: '50',
            avg_transaction: '25',
            first_transaction_date: '2025-01-01',
            last_transaction_date: '2025-01-31',
          },
        ],
      },
      // targets
      { rows: [] },
      // categories by allocation
      {
        rows: [
          {
            category_definition_id: 10,
            category_name: 'Misc',
            category_name_en: 'Misc',
            spending_category: null,
            total_amount: '50',
            transaction_count: '2',
          },
        ],
      }
    );

    const result = await getSpendingCategoryBreakdown({
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });

    expect(queryMock).toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);

    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].spending_category).toBe('unallocated');
    expect(result.breakdown[0].actual_percentage).toBeCloseTo(0);

    expect(result.categories_by_allocation.unallocated).toHaveLength(1);
    expect(result.categories_by_allocation.unallocated[0].category_definition_id).toBe(10);
  });
});
