import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = require('fs');
const createSqlitePool = require('../sqlite-pool.js');

const LEGACY_INVESTMENT_HOLDINGS_SQL = `
  CREATE TABLE investment_holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    asset_name TEXT,
    asset_type TEXT,
    units REAL,
    current_value REAL NOT NULL,
    cost_basis REAL,
    as_of_date TEXT NOT NULL,
    notes TEXT,
    holding_type TEXT DEFAULT 'standard',
    deposit_transaction_id TEXT,
    deposit_transaction_vendor TEXT,
    return_transaction_id TEXT,
    return_transaction_vendor TEXT,
    maturity_date TEXT,
    interest_rate REAL,
    status TEXT DEFAULT 'active',
    parent_pikadon_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, as_of_date)
  )
`;

describe('sqlite-pool legacy investment holdings migration', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rebuilds legacy investment_holdings tables and installs pikadon-safe uniqueness on startup', () => {
    const execCalls: string[] = [];
    const pragmaCalls: string[] = [];
    const getCalls: Array<{ sql: string; params: unknown[] }> = [];

    class LegacyInvestmentHoldingsDb {
      exec(sql: string) {
        execCalls.push(sql);
      }

      pragma(sql: string) {
        pragmaCalls.push(sql);
      }

      prepare(sql: string) {
        return {
          all: () => {
            if (sql === "PRAGMA table_info('investment_holdings')") {
              return [{ name: 'id' }, { name: 'holding_type' }];
            }
            if (sql === "PRAGMA table_info('account_pairings')") {
              return [{ name: 'discrepancy_acknowledged' }];
            }
            if (sql === "PRAGMA table_info('transactions')") {
              return [{ name: 'tags' }];
            }
            if (sql === "PRAGMA table_info('transaction_pairing_exclusions')") {
              return [{ name: 'pairing_id', pk: 1 }];
            }
            if (sql.includes('FROM sqlite_master') && sql.includes("type = 'trigger'")) {
              return [];
            }
            return [];
          },
          get: (...params: unknown[]) => {
            getCalls.push({ sql, params });
            if (
              sql === "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?"
              && params[0] === 'investment_holdings'
            ) {
              return { sql: LEGACY_INVESTMENT_HOLDINGS_SQL };
            }
            if (sql === 'SELECT 1 FROM transaction_pairing_exclusions LIMIT 1') {
              return { exists: 1 };
            }
            return undefined;
          },
          run: () => ({ changes: 0 }),
        };
      }
    }

    createSqlitePool({
      databasePath: 'dist/shekelsync.sqlite',
      databaseCtor: LegacyInvestmentHoldingsDb,
    });

    const startupSql = execCalls.join('\n');

    expect(pragmaCalls).toEqual(['foreign_keys = ON', 'journal_mode = WAL']);
    expect(getCalls).toContainEqual({
      sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      params: ['investment_holdings'],
    });
    expect(startupSql).toContain("UPDATE investment_holdings\n    SET holding_type = 'standard'");
    expect(startupSql).toContain('PRAGMA foreign_keys = OFF');
    expect(startupSql).toContain('BEGIN');
    expect(startupSql).toContain('CREATE TABLE investment_holdings__new');
    expect(startupSql).toContain("holding_type TEXT NOT NULL DEFAULT 'standard'");
    expect(startupSql).toContain('INSERT INTO investment_holdings__new');
    expect(startupSql).toContain('DROP TABLE investment_holdings');
    expect(startupSql).toContain('ALTER TABLE investment_holdings__new RENAME TO investment_holdings');
    expect(startupSql).toContain('COMMIT');
    expect(startupSql).not.toContain('ROLLBACK');
    expect(startupSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_holdings_standard_snapshot_unique');
    expect(startupSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_holdings_pikadon_deposit_unique');
  });
});
