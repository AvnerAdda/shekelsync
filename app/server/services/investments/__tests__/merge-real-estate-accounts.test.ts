import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { mergeRealEstateAccounts } = require('../merge-real-estate-accounts.js');
const { syncRealEstateHolding } = require('../real-estate.js');

describe('real estate account consolidation on SQLite', () => {
  let db: DatabaseSync;
  let adapter: any;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE investment_accounts (id INTEGER PRIMARY KEY, account_type TEXT,
        account_name TEXT, currency TEXT, is_active INTEGER DEFAULT 1, notes TEXT, updated_at TEXT);
      CREATE TABLE investment_holdings (id INTEGER PRIMARY KEY, account_id INTEGER REFERENCES investment_accounts,
        current_value REAL, cost_basis REAL, as_of_date TEXT, asset_type TEXT,
        holding_type TEXT DEFAULT 'standard', status TEXT DEFAULT 'active', notes TEXT, updated_at TEXT);
      CREATE UNIQUE INDEX standard_snapshot ON investment_holdings(account_id, as_of_date) WHERE holding_type = 'standard';
      CREATE TABLE transactions (identifier TEXT, vendor TEXT, date TEXT, transaction_datetime TEXT, name TEXT,
        memo TEXT, price REAL, original_currency TEXT, charged_currency TEXT, is_pikadon_related INTEGER,
        category_type TEXT DEFAULT 'investment', category_definition_id INTEGER,
        UNIQUE(identifier, vendor));
      CREATE TABLE category_definitions (id INTEGER, category_type TEXT, name TEXT, name_en TEXT,
        name_fr TEXT, is_counted_as_income INTEGER);
      CREATE TABLE transaction_account_links (transaction_identifier TEXT, transaction_vendor TEXT,
        account_id INTEGER REFERENCES investment_accounts, UNIQUE(transaction_identifier, transaction_vendor));
      CREATE TABLE account_transaction_patterns (account_id INTEGER REFERENCES investment_accounts,
        pattern TEXT, pattern_type TEXT DEFAULT 'substring', is_active INTEGER DEFAULT 1,
        match_count INTEGER DEFAULT 0, last_matched TEXT, UNIQUE(account_id, pattern));
      CREATE TABLE pending_transaction_suggestions (suggested_account_id INTEGER REFERENCES investment_accounts);
      CREATE TABLE investment_assets (account_id INTEGER REFERENCES investment_accounts);
      CREATE TABLE investment_positions (account_id INTEGER REFERENCES investment_accounts);
      CREATE TABLE real_estate_properties (account_id INTEGER UNIQUE REFERENCES investment_accounts, city TEXT);
      INSERT INTO investment_accounts (id, account_type, account_name, currency) VALUES
        (9, 'real_estate', 'נדל"ן', 'ILS'), (10, 'real_estate', 'נדל"ן', 'ILS'), (11, 'real_estate', 'נדל"ן', 'ILS');
      INSERT INTO investment_holdings (account_id, current_value, cost_basis, as_of_date, notes) VALUES
        (9, 693271, 693271, '2026-05-26', 'Auto-synced from linked real estate transactions'),
        (9, 682500, 682500, '2026-06-18', 'Real estate simulator valuation (net_equity)'),
        (10, 3469.45, 3469.45, '2026-09-14', 'Created from smart suggestion'),
        (11, 6700.8, 6700.8, '2026-10-13', 'Created from smart suggestion');
      INSERT INTO transactions (identifier, vendor, date, name, price) VALUES
        ('purchase', 'bank', '2026-05-26', 'Property purchase', -693271),
        ('payment1', 'bank', '2026-09-10', 'Property payment', -3469.45),
        ('payment2', 'bank', '2026-10-11', 'Property payment', -6700.8);
      INSERT INTO transaction_account_links VALUES ('purchase', 'bank', 9), ('payment1', 'bank', 10), ('payment2', 'bank', 11);
      INSERT INTO real_estate_properties VALUES (9, 'Bat Yam');
      INSERT INTO account_transaction_patterns (account_id, pattern, match_count) VALUES
        (9, 'Property', 3), (10, 'Property', 1), (11, 'Property', 1), (11, 'Building', 2);
      INSERT INTO pending_transaction_suggestions VALUES (11);
      INSERT INTO investment_assets VALUES (10);
      INSERT INTO investment_positions VALUES (11);
    `);
    adapter = {
      async query(sql: string, params: unknown[] = []) {
        const bindings: any[] = [];
        const converted = sql.replace(/\$(\d+)/g, (_, index) => {
          bindings.push(params[Number(index) - 1]);
          return '?';
        });
        const statement = db.prepare(converted);
        if (/^\s*(SELECT|WITH)/i.test(converted) || /RETURNING/i.test(converted)) {
          return { rows: statement.all(...bindings) };
        }
        return { rows: [], rowCount: statement.run(...bindings).changes };
      },
      release() {},
      async getClient() { return this; },
    };
  });
  afterEach(() => db.close());

  it('combines values and dates, preserves the property, and moves links and patterns', async () => {
    const result = await mergeRealEstateAccounts(adapter, { target_account_id: 9, source_account_ids: [10, 11] });
    expect(result.latest).toEqual({ as_of_date: '2026-10-13', current_value: 692670.25, cost_basis: 692670.25 });
    expect(db.prepare('SELECT id FROM investment_accounts WHERE is_active = 1').all()).toEqual([{ id: 9 }]);
    expect(db.prepare('SELECT DISTINCT account_id FROM transaction_account_links').all()).toEqual([{ account_id: 9 }]);
    expect(db.prepare('SELECT * FROM real_estate_properties').all()).toEqual([{ account_id: 9, city: 'Bat Yam' }]);
    expect(db.prepare('SELECT current_value FROM investment_holdings WHERE account_id = 9 AND as_of_date = ?')
      .get('2026-09-10')).toEqual({ current_value: 685969.45 });
    expect(db.prepare('SELECT COUNT(*) count FROM investment_holdings WHERE account_id IN (10, 11)').get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT match_count FROM account_transaction_patterns WHERE account_id = 9 AND pattern = 'Property'").get())
      .toEqual({ match_count: 5 });
    expect(db.prepare('SELECT DISTINCT is_active FROM account_transaction_patterns WHERE account_id IN (10, 11)').all())
      .toEqual([{ is_active: 0 }]);
    for (const table of ['investment_assets', 'investment_positions']) {
      expect(db.prepare(`SELECT account_id FROM ${table}`).get()).toEqual({ account_id: 9 });
    }
    expect(db.prepare('SELECT suggested_account_id FROM pending_transaction_suggestions').get()).toEqual({ suggested_account_id: 9 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps the merged valuation when future payments are linked and synced', async () => {
    await mergeRealEstateAccounts(adapter, { target_account_id: 9, source_account_ids: [10, 11] });
    db.exec(`INSERT INTO transactions (identifier, vendor, date, name, price)
      VALUES ('new-payment', 'bank', '2026-10-14', 'Property payment', -100);
      INSERT INTO transaction_account_links VALUES ('new-payment', 'bank', 9);`);
    await syncRealEstateHolding({ dbAdapter: adapter, accountId: 9 });
    expect(db.prepare('SELECT current_value FROM investment_holdings WHERE account_id = 9 ORDER BY as_of_date DESC LIMIT 1').get())
      .toEqual({ current_value: 692770.25 });
    expect(db.prepare("SELECT current_value FROM investment_holdings WHERE account_id = 9 AND as_of_date = '2026-06-18'").get())
      .toEqual({ current_value: 682500 });
  });

  it.each([
    [9, []], [9, [9]], [9, [10, 10]], ['9', [10]], [9, [-1]],
  ])('rejects invalid selections %s / %s', async (target, sources) => {
    await expect(mergeRealEstateAccounts(adapter, { target_account_id: target, source_account_ids: sources }))
      .rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ["UPDATE investment_accounts SET currency = 'USD' WHERE id = 10", 400],
    ["UPDATE investment_accounts SET account_type = 'brokerage' WHERE id = 10", 400],
    ['UPDATE investment_accounts SET is_active = 0 WHERE id = 10', 400],
    ["INSERT INTO real_estate_properties VALUES (10, 'Haifa')", 400],
  ])('rejects incompatible accounts without changing links', async (sql, status) => {
    db.exec(String(sql));
    await expect(mergeRealEstateAccounts(adapter, { target_account_id: 9, source_account_ids: [10, 11] }))
      .rejects.toMatchObject({ status });
    expect(db.prepare('SELECT account_id FROM transaction_account_links WHERE transaction_identifier = ?').get('payment1'))
      .toEqual({ account_id: 10 });
    expect(db.isTransaction).toBe(false);
  });

  it('requires keeping the account with the property profile', async () => {
    await expect(mergeRealEstateAccounts(adapter, { target_account_id: 10, source_account_ids: [9] }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rolls back values and links if an update fails midway', async () => {
    const query = adapter.query.bind(adapter);
    adapter.query = (sql: string, params: unknown[]) => {
      if (sql.includes('UPDATE investment_positions')) throw new Error('write failed');
      return query(sql, params);
    };
    await expect(mergeRealEstateAccounts(adapter, { target_account_id: 9, source_account_ids: [10, 11] }))
      .rejects.toThrow('write failed');
    expect(db.prepare('SELECT COUNT(*) count FROM investment_holdings').get()).toEqual({ count: 4 });
    expect(db.prepare('SELECT account_id FROM transaction_account_links WHERE transaction_identifier = ?').get('payment1'))
      .toEqual({ account_id: 10 });
    expect(db.prepare('SELECT COUNT(*) count FROM investment_accounts WHERE is_active = 1').get()).toEqual({ count: 3 });
  });
});
