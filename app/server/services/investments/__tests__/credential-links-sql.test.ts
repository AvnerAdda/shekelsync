import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const credentials = require('../../credentials.js');
const { getOrCreateBankBalanceAccount, forwardFillForCredential } = require('../balance-sync.js');
const { clearInstitutionsCache } = require('../../institutions.js');

describe('bank credential links on SQLite', () => {
  let db: DatabaseSync;
  let client: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    clearInstitutionsCache();
    db = new DatabaseSync(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE investment_accounts (
        id INTEGER PRIMARY KEY, account_name TEXT, account_type TEXT DEFAULT 'bank_balance',
        notes TEXT, institution_id INTEGER, account_number TEXT, currency TEXT,
        is_active INTEGER DEFAULT 1, is_liquid INTEGER, investment_category TEXT
      );
      CREATE TABLE investment_holdings (
        id INTEGER PRIMARY KEY,
        account_id INTEGER REFERENCES investment_accounts(id) ON DELETE CASCADE,
        current_value REAL, cost_basis REAL, as_of_date TEXT,
        holding_type TEXT DEFAULT 'standard', asset_type TEXT, notes TEXT, updated_at TEXT
      );
      CREATE UNIQUE INDEX snapshots_unique ON investment_holdings(account_id, as_of_date)
        WHERE holding_type = 'standard';
      CREATE TABLE vendor_credentials (
        id INTEGER PRIMARY KEY, vendor TEXT, institution_id INTEGER, bank_account_number TEXT,
        nickname TEXT, created_at TEXT
      );
      CREATE TABLE transactions (
        identifier TEXT, vendor TEXT, account_number TEXT, vendor_nickname TEXT
      );
      CREATE TABLE scrape_events (credential_id INTEGER, status TEXT, created_at TEXT);
      CREATE TABLE institution_nodes (
        id INTEGER PRIMARY KEY, vendor_code TEXT, institution_type TEXT, display_name_he TEXT,
        display_name_en TEXT, category TEXT, subcategory TEXT, is_scrapable INTEGER, logo_url TEXT,
        scraper_company_id TEXT, credential_fields TEXT, display_order INTEGER, parent_id INTEGER,
        hierarchy_path TEXT, depth_level INTEGER, is_active INTEGER, node_type TEXT
      );
      INSERT INTO institution_nodes
        (id, vendor_code, display_name_en, is_active, node_type)
        VALUES (9, 'bank', 'Bank', 1, 'institution');
      INSERT INTO vendor_credentials VALUES
        (1, 'bank', 9, '1111', NULL, '2026-10-01'),
        (10, 'bank', 9, '1010', NULL, '2026-10-01');
      INSERT INTO investment_accounts
        (id, account_name, notes, institution_id, account_number) VALUES
        (10, 'Sibling account', 'credential_id:10', 9, '1010'),
        (20, 'Requested account', 'credential_id:1', 9, '1111');
      INSERT INTO investment_holdings (account_id, current_value, cost_basis, as_of_date) VALUES
        (10, 10000, 10000, '2026-10-10'), (20, 2000, 2000, '2026-10-10');
      INSERT INTO transactions VALUES ('own', 'bank', '1111', NULL), ('sibling', 'bank', '1010', NULL);
    `);
    client = {
      async query(sql: string, params: unknown[] = []) {
        const bindings: any[] = [];
        const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => {
          const value = params[Number(index) - 1];
          bindings.push(typeof value === 'boolean' ? Number(value) : value);
          return '?';
        });
        const statement = db.prepare(sqliteSql);
        if (statement.columns().length > 0) return { rows: statement.all(...bindings) };
        const result = statement.run(...bindings);
        return { rows: [], rowCount: Number(result.changes) };
      },
      release() {},
    };
    credentials.__setDatabase({ query: client.query, getClient: async () => client });
  });

  afterEach(() => {
    credentials.__resetDependencies();
    clearInstitutionsCache();
    vi.useRealTimers();
    db.close();
  });

  it('looks up credential 1 without using credential 10 account during synchronization', async () => {
    const querySpy = vi.spyOn(client, 'query');
    const account = await getOrCreateBankBalanceAccount(
      client, { id: 1, vendor: 'bank', institution_id: 9 }, '1111', {},
    );
    expect(account.id).toBe(20);
    expect(account.notes).toBe('credential_id:1');
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it('creates the missing bank account without attaching its credential to a sibling at the same institution', async () => {
    db.exec('DELETE FROM investment_accounts WHERE id = 20');
    const account = await getOrCreateBankBalanceAccount(
      client, { id: 1, vendor: 'bank', institution_id: 9 }, '1111', {},
    );
    expect(account.id).not.toBe(10);
    expect(account.notes).toContain('credential_id:1');
    expect(account.account_number).toBe('1111');
    expect(db.prepare('SELECT notes FROM investment_accounts WHERE id = 10').get()?.notes)
      .toBe('credential_id:10');
  });

  it.each([{}, { vendor: 'bank' }])('lists each credential once with its own holdings (%j)', async (params) => {
    // Even a duplicate legacy investment record should not duplicate the credential.
    db.exec(`INSERT INTO investment_accounts
      (id, account_name, notes, institution_id, account_number)
      VALUES (30, 'Duplicate', 'Extra notes credential_id:1', 9, '1111');`);
    const result = await credentials.listCredentials({ ...params, skipDecrypt: true });
    expect(result).toHaveLength(2);
    expect(result.find((row: any) => row.id === 1).current_balance).toBe(2000);
    expect(result.find((row: any) => row.id === 10).current_balance).toBe(10000);
  });

  it('deletes only credential 1 bank account and preserves sibling history and unrelated investments', async () => {
    db.exec(`INSERT INTO investment_accounts
      (id, account_name, account_type, notes, institution_id)
      VALUES (30, 'Brokerage', 'brokerage', 'Imported using credential_id:1', 9);
      INSERT INTO investment_holdings (account_id, current_value, as_of_date)
      VALUES (30, 30000, '2026-10-10');`);
    await expect(credentials.deleteCredential({ id: 1 })).resolves.toEqual({ success: true });

    expect(db.prepare('SELECT id FROM vendor_credentials ORDER BY id').all()).toEqual([{ id: 10 }]);
    expect(db.prepare('SELECT id FROM investment_accounts ORDER BY id').all()).toEqual([{ id: 10 }, { id: 30 }]);
    expect(db.prepare('SELECT account_id, current_value FROM investment_holdings ORDER BY account_id').all())
      .toEqual([{ account_id: 10, current_value: 10000 }, { account_id: 30, current_value: 30000 }]);
    expect(db.prepare('SELECT identifier FROM transactions').all()).toEqual([{ identifier: 'sibling' }]);
  });

  it('forward-fills only the requested credential, leaving sibling history untouched', async () => {
    const result = await forwardFillForCredential(client, { id: 1, vendor: 'bank' }, {});
    expect(result.accountsUpdated).toBe(1);
    expect(db.prepare('SELECT as_of_date FROM investment_holdings WHERE account_id = 20 ORDER BY as_of_date').all())
      .toEqual([{ as_of_date: '2026-10-10' }, { as_of_date: '2026-10-11' }, { as_of_date: '2026-10-12' }]);
    expect(db.prepare('SELECT as_of_date FROM investment_holdings WHERE account_id = 10').all())
      .toEqual([{ as_of_date: '2026-10-10' }]);
  });

  it('retains legacy fallback only for an unlinked account matching the bank account number', async () => {
    db.exec(`UPDATE investment_accounts SET notes = NULL WHERE id = 20;
      UPDATE investment_accounts SET notes = NULL WHERE id = 10;`);
    const result = await forwardFillForCredential(client, { id: 1, vendor: 'bank' }, {});
    expect(result.accountsUpdated).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM investment_holdings WHERE account_id = 10').get()?.count)
      .toBe(1);
  });
});
