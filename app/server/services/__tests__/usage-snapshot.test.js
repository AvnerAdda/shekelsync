import { afterEach, describe, test, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const snapshot = require('../usage-snapshot.js');

afterEach(() => snapshot.__setDatabaseForTests(null));

describe('usage snapshot facts', () => {
  test('returns counts, flags and the earliest activity time only', async () => {
    const query = vi.fn(async (sql) => {
      if (sql.includes('FROM vendor_credentials') && sql.includes('COUNT')) return { rows: [{ count: 3 }] };
      if (sql.includes('real_estate_properties')) return { rows: [{ count: 1 }] };
      if (sql.includes('category_budgets')) return { rows: [{ count: 0 }] };
      if (sql.includes('savings_goals')) return { rows: [{ count: 2 }] };
      if (sql.includes('MIN(created_at)') && sql.includes('vendor_credentials')) {
        return { rows: [{ earliest: '2026-09-01 08:00:00' }] };
      }
      if (sql.includes('MIN(created_at)') && sql.includes('scrape_events')) {
        return { rows: [{ earliest: '2026-08-15 10:00:00' }] };
      }
      return { rows: [] };
    });
    snapshot.__setDatabaseForTests({ query });

    const facts = await snapshot.collectUsageSnapshotFacts();
    expect(facts).toEqual({
      institutionCount: 3,
      hasProperty: true,
      hasBudgets: false,
      hasGoals: true,
      firstActivityAt: Date.parse('2026-08-15T10:00:00Z'),
    });
  });

  test('missing tables degrade to zero / null', async () => {
    snapshot.__setDatabaseForTests({
      query: vi.fn(async () => {
        throw new Error('no such table');
      }),
    });
    expect(await snapshot.collectUsageSnapshotFacts()).toEqual({
      institutionCount: 0,
      hasProperty: false,
      hasBudgets: false,
      hasGoals: false,
      firstActivityAt: null,
    });
  });
});
