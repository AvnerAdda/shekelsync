// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const breakdown = require('../analytics/breakdown.js');
const categoryDetails = require('../analytics/category-details.js');

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE category_definitions (
      id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, name_fr TEXT,
      color TEXT, icon TEXT, description TEXT, parent_id INTEGER,
      depth_level INTEGER, category_type TEXT
    );
    CREATE TABLE transactions (
      identifier TEXT, vendor TEXT, date TEXT, price REAL, processed_date TEXT,
      name TEXT, account_number TEXT, category_definition_id INTEGER,
      PRIMARY KEY (identifier, vendor)
    );
    CREATE TABLE transaction_pairing_exclusions (transaction_identifier TEXT, transaction_vendor TEXT);
    CREATE TABLE vendor_credentials (vendor TEXT, institution_id INTEGER);
    CREATE TABLE institution_nodes (
      id INTEGER PRIMARY KEY, node_type TEXT, display_name_he TEXT,
      display_name_en TEXT, logo_url TEXT, institution_type TEXT
    );
    INSERT INTO category_definitions (id, name, parent_id, depth_level, category_type) VALUES
      (1, 'Shopping', NULL, 1, 'expense'),
      (2, 'Clothing', 1, 2, 'expense'),
      (3, 'Salary', NULL, 1, 'income'),
      (4, 'Investments', NULL, 1, 'investment');
    INSERT INTO institution_nodes (id, node_type, display_name_en) VALUES (1, 'institution', 'Bank A');
    INSERT INTO vendor_credentials VALUES ('bank-a', 1), ('bank-a', 1);
  `);
  const query = async (sql: string, values: unknown[] = []) => {
    const parameters: any[] = [];
    const preparedSql = sql.replace(/\$(\d+)/g, (_match, index) => {
      const value = values[Number(index) - 1];
      parameters.push(value instanceof Date ? value.toISOString() : value);
      return '?';
    });
    const rows = db.prepare(preparedSql).all(...parameters);
    return { rows, rowCount: rows.length };
  };
  const database = { query, getClient: async () => ({ query, release() {} }) };
  breakdown.__setDatabase(database);
  categoryDetails.__setDatabase(database);
});

afterEach(() => {
  breakdown.__resetDatabase();
  categoryDetails.__resetDatabase();
  db.close();
});

function transaction(identifier: string, vendor: string, price: number, date: string, category = 2) {
  db.prepare(`INSERT INTO transactions
    (identifier, vendor, price, date, name, account_number, category_definition_id)
    VALUES (?, ?, ?, ?, ?, '1234', ?)`).run(identifier, vendor, price, date, identifier, category);
}

const range = { startDate: '2026-02-01', endDate: '2026-02-28', type: 'expense', noCache: true };

describe.each([false, true])('breakdown calculations (includeTransactions: %s)', (includeTransactions) => {
  it('keeps same identifiers at different banks, without multiplying saved connections', async () => {
    transaction('shared-id', 'bank-a', -100, '2026-02-01');
    transaction('shared-id', 'bank-b', -200, '2026-02-28T23:59:59.999Z');
    transaction('excluded-id', 'bank-a', -9000, '2026-02-15');
    transaction('excluded-id', 'bank-b', -50, '2026-02-15');
    db.exec("INSERT INTO transaction_pairing_exclusions VALUES ('excluded-id', 'bank-a')");

    const result = await breakdown.getBreakdownAnalytics({ ...range, includeTransactions });
    expect(result.summary).toMatchObject({ total: 350, count: 3 });
    expect(result.breakdowns.byCategory).toMatchObject([{ total: 350, count: 3 }]);
    expect(result.breakdowns.byVendor).toMatchObject([
      { vendor: 'bank-b', total: 250, count: 2 },
      { vendor: 'bank-a', total: 100, count: 1, institution: { id: 1 } },
    ]);
    expect(result.breakdowns.byMonth).toEqual([{ month: '2026-02', total: 350, inflow: 0, outflow: 350 }]);
    if (includeTransactions) expect(result.transactions).toHaveLength(3);
  });

  it.each([100, 500, 700])('nets a final-day refund of %s in every grouping and previous period', async (refund) => {
    transaction('purchase', 'bank-a', -500, '2026-02-01');
    transaction('refund', 'bank-a', refund, '2026-02-28T23:59:59.999Z');
    transaction('after-period', 'bank-a', -9000, '2026-03-01');
    transaction('prior-purchase', 'bank-a', -300, '2026-01-04');
    transaction('prior-refund', 'bank-a', 100, '2026-01-31T23:59:59.999Z');
    transaction('before-prior-period', 'bank-a', -9000, '2026-01-03T23:59:59.999Z');
    transaction('salary', 'bank-a', 1000, '2026-02-15', 3);
    const net = 500 - refund;

    const result = await breakdown.getBreakdownAnalytics({ ...range, includeTransactions });
    expect(result.summary).toMatchObject({ total: net, count: 2, average: net / 2, min: -refund, max: 500 });
    expect(result.breakdowns.byCategory).toMatchObject([{
      total: net, count: 2, previousTotal: 200, previousCount: 2,
      history: [{ month: '2026-02', total: net }], subcategories: [{ total: net }],
    }]);
    expect(result.breakdowns.byVendor).toMatchObject([{
      total: net, count: 2, previousTotal: 200, previousCount: 2,
      history: [{ month: '2026-02', total: net }],
    }]);
    expect(result.breakdowns.byMonth).toEqual([{ month: '2026-02', total: net, inflow: 0, outflow: net }]);
    expect(result.breakdowns.byDay).toEqual([
      { date: '2026-02-01', total: 500, inflow: 0, outflow: 500 },
      { date: '2026-02-28', total: -refund, inflow: 0, outflow: -refund },
    ]);
    if (includeTransactions) expect(result.transactions.map((row: any) => row.identifier)).toEqual(['purchase', 'refund']);
  });

  it('compares a single selected day with the complete preceding day', async () => {
    transaction('today', 'bank-a', -100, '2026-02-28T23:59:59.999Z');
    transaction('yesterday', 'bank-a', -200, '2026-02-27T23:59:59.999Z');
    transaction('before', 'bank-a', -9000, '2026-02-26');
    const result = await breakdown.getBreakdownAnalytics({ ...range, startDate: range.endDate, includeTransactions });
    expect(result.summary).toMatchObject({ total: 100, count: 1 });
    expect(result.breakdowns.byCategory).toMatchObject([{ previousTotal: 200, previousCount: 1 }]);
  });
});

describe('category detail consistency', () => {
  it.each([{ parentId: 1 }, { subcategoryId: 2 }, { category: 'Clothing' }])('uses the same signed full-day totals for %j', async (selection) => {
    transaction('purchase', 'bank-a', -100, '2026-02-01');
    transaction('purchase', 'bank-b', -200, '2026-02-20');
    transaction('refund', 'bank-a', 400, '2026-02-28T23:59:59.999Z');
    transaction('excluded', 'bank-a', 9000, '2026-02-15');
    transaction('before', 'bank-a', -9000, '2026-01-31T23:59:59.999Z');
    transaction('after', 'bank-a', -9000, '2026-03-01');
    db.exec("INSERT INTO transaction_pairing_exclusions VALUES ('excluded', 'bank-a')");

    const result = await categoryDetails.getCategoryDetails({ ...range, ...selection });
    expect(result.summary).toMatchObject({ total: -100, count: 3, minAmount: -400, maxAmount: 200 });
    expect(result.byVendor).toEqual([
      { vendor: 'bank-b', total: 200, count: 1 }, { vendor: 'bank-a', total: -300, count: 2 },
    ]);
    expect(result.byCard).toMatchObject([{ total: 200, count: 1 }, { total: -300, count: 2 }]);
    expect(result.trend).toEqual([{ month: '2026-02', total: -100, count: 3 }]);
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0]).toMatchObject({ identifier: 'refund', price: 400 });
    if ('parentId' in selection) expect(result.subcategories).toEqual([{ id: 2, name: 'Clothing', total: -100, count: 3 }]);
  });

  it('retains income sign filters and absolute investment amounts', async () => {
    transaction('salary', 'bank-a', 1000, '2026-02-28T23:59:59.999Z', 3);
    transaction('income-debit', 'bank-a', -200, '2026-02-15', 3);
    transaction('contribution', 'bank-a', -500, '2026-02-01', 4);
    transaction('withdrawal', 'bank-a', 100, '2026-02-28T23:59:59.999Z', 4);
    for (const [type, subcategoryId, total, count] of [['income', 3, 1000, 1], ['investment', 4, 600, 2]]) {
      const details = await categoryDetails.getCategoryDetails({ ...range, type, subcategoryId });
      expect(details.summary).toMatchObject({ total, count });
      for (const includeTransactions of [false, true]) {
        const result = await breakdown.getBreakdownAnalytics({ ...range, type, includeTransactions });
        expect(result.summary).toMatchObject({ total, count });
      }
    }
  });
});
