const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  runSchemaMigrations,
} = require('../schema-migrations.js');

const Database = require('better-sqlite3');

function withDatabase(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-migrations-'));
  const dbPath = path.join(tempDir, 'migrations.sqlite');
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS sample (id INTEGER PRIMARY KEY, value TEXT)');
    return run(db, dbPath, tempDir);
  } finally {
    try {
      db.close();
    } catch (_error) {
      // Ignore close failures during cleanup.
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const scenarios = {
  'applies-in-order': () =>
    withDatabase((db, dbPath) => {
      const order = [];
      const migrations = [
        { version: 1, name: 'one', up: () => order.push(1) },
        { version: 2, name: 'two', up: (handle) => {
          order.push(2);
          handle.exec("INSERT INTO sample (value) VALUES ('from-migration')");
        } },
      ];
      const result = runSchemaMigrations(db, { dbPath, migrations, logger: { log: () => {} } });
      assert.deepEqual(order, [1, 2]);
      assert.equal(result.fromVersion, 0);
      assert.equal(result.toVersion, 2);
      assert.equal(getSchemaVersion(db), 2);
      const row = db.prepare('SELECT value FROM sample').get();
      assert.equal(row.value, 'from-migration');
    }),

  'skips-applied': () =>
    withDatabase((db, dbPath) => {
      let calls = 0;
      const migrations = [{ version: 1, name: 'one', up: () => { calls += 1; } }];
      runSchemaMigrations(db, { dbPath, migrations, logger: { log: () => {} } });
      const second = runSchemaMigrations(db, { dbPath, migrations, logger: { log: () => {} } });
      assert.equal(calls, 1);
      assert.deepEqual(second.applied, []);
      assert.equal(second.fromVersion, 1);
      assert.equal(getSchemaVersion(db), 1);
    }),

  'rolls-back-on-failure': () =>
    withDatabase((db, dbPath) => {
      const migrations = [
        { version: 1, name: 'ok', up: (handle) => handle.exec("INSERT INTO sample (value) VALUES ('kept')") },
        { version: 2, name: 'boom', up: (handle) => {
          handle.exec("INSERT INTO sample (value) VALUES ('rolled-back')");
          throw new Error('migration exploded');
        } },
      ];
      assert.throws(
        () => runSchemaMigrations(db, { dbPath, migrations, logger: { log: () => {} } }),
        /migration v2 \(boom\) failed: migration exploded/,
      );
      assert.equal(getSchemaVersion(db), 1);
      const rows = db.prepare('SELECT value FROM sample ORDER BY id').all();
      assert.deepEqual(rows.map((row) => row.value), ['kept']);
    }),

  'creates-backup': () =>
    withDatabase((db, dbPath) => {
      const migrations = [{ version: 1, name: 'one', up: () => {} }];
      const result = runSchemaMigrations(db, { dbPath, migrations, logger: { log: () => {} } });
      assert.ok(result.backupPath, 'expected a backup path');
      assert.ok(fs.existsSync(result.backupPath), 'expected backup file on disk');
      assert.match(path.basename(result.backupPath), /pre-migration-v0-to-v1/);

      const noop = runSchemaMigrations(db, { dbPath, migrations, logger: { log: () => {} } });
      assert.equal(noop.backupPath, null, 'no backup expected when nothing is pending');
    }),

  'rejects-bad-registry': () =>
    withDatabase((db, dbPath) => {
      assert.throws(
        () => runSchemaMigrations(db, {
          dbPath,
          migrations: [
            { version: 2, name: 'two', up: () => {} },
            { version: 1, name: 'one', up: () => {} },
          ],
          logger: { log: () => {} },
        }),
        /strictly ascending/,
      );
      assert.equal(getSchemaVersion(db), 0);
    }),

  'default-registry': () =>
    withDatabase((db, dbPath) => {
      const result = runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });
      assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(getSchemaVersion(db), CURRENT_SCHEMA_VERSION);
      assert.equal(MIGRATIONS[MIGRATIONS.length - 1].version, CURRENT_SCHEMA_VERSION);
    }),

  'migrates-legacy-investment-assets': () =>
    withDatabase((db, dbPath) => {
      db.exec(`
        CREATE TABLE investment_accounts (
          id INTEGER PRIMARY KEY,
          currency TEXT NOT NULL DEFAULT 'ILS',
          is_active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE investment_assets (
          id INTEGER PRIMARY KEY,
          account_id INTEGER NOT NULL,
          asset_symbol TEXT,
          asset_name TEXT NOT NULL,
          asset_type TEXT,
          units REAL NOT NULL,
          average_cost REAL,
          currency TEXT NOT NULL DEFAULT 'USD',
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE investment_positions (
          id INTEGER PRIMARY KEY,
          account_id INTEGER NOT NULL,
          position_name TEXT NOT NULL,
          asset_type TEXT,
          currency TEXT NOT NULL DEFAULT 'ILS',
          status TEXT NOT NULL DEFAULT 'open',
          opened_at TEXT NOT NULL,
          closed_at TEXT,
          original_cost_basis REAL NOT NULL DEFAULT 0,
          open_cost_basis REAL NOT NULL DEFAULT 0,
          current_value REAL,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE investment_position_events (
          id INTEGER PRIMARY KEY,
          position_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          effective_date TEXT NOT NULL,
          amount REAL,
          principal_amount REAL,
          income_amount REAL,
          fee_amount REAL,
          units REAL,
          current_value REAL,
          close_action TEXT,
          linked_transaction_identifier TEXT,
          linked_transaction_vendor TEXT,
          notes TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO investment_accounts (id, currency) VALUES (1, 'ILS');
        INSERT INTO investment_assets (
          id, account_id, asset_symbol, asset_name, asset_type, units,
          average_cost, currency, is_active, created_at, updated_at
        ) VALUES
          (10, 1, 'ETF', 'Legacy ETF', 'etf', 5, 100, 'ILS', 1, '2026-01-01', '2026-08-01'),
          (11, 1, NULL, 'Cash', 'cash', 250, NULL, 'ILS', 0, '2026-01-01', '2026-08-02');
        INSERT INTO investment_positions (
          id, account_id, position_name, currency, status, opened_at,
          original_cost_basis, open_cost_basis, current_value
        ) VALUES (20, 1, 'Existing position', 'ILS', 'open', '2026-01-01', 75, 75, 80);
        INSERT INTO investment_position_events (
          id, position_id, event_type, effective_date, amount
        ) VALUES (30, 20, 'buy', '2026-01-01', 75);
        PRAGMA user_version = 1;
      `);

      const first = runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });
      assert.equal(first.toVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('investment_allocation_targets', 'investment_liabilities', 'investment_fx_rates', 'investment_benchmarks', 'investment_benchmark_points')").get().count,
        5,
      );
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM investment_assets').get().count, 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM investment_positions').get().count, 3);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM investment_position_events').get().count, 1);

      const migratedEtf = db.prepare(
        'SELECT * FROM investment_positions WHERE legacy_asset_id = 10',
      ).get();
      assert.equal(migratedEtf.asset_symbol, 'ETF');
      assert.equal(migratedEtf.units, 5);
      assert.equal(migratedEtf.average_cost, 100);
      assert.equal(migratedEtf.open_cost_basis, 500);
      assert.equal(migratedEtf.current_value, null);
      assert.equal(migratedEtf.source, 'legacy_asset');

      const migratedCash = db.prepare(
        'SELECT * FROM investment_positions WHERE legacy_asset_id = 11',
      ).get();
      assert.equal(migratedCash.status, 'closed');
      assert.equal(migratedCash.current_price, 1);
      assert.equal(migratedCash.current_value, 250);

      db.exec('PRAGMA user_version = 1');
      runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM investment_positions').get().count, 3);

      db.exec(`
        UPDATE investment_assets
        SET units = 6,
            current_price = 120,
            current_value = 720,
            valuation_date = '2026-08-12'
        WHERE id = 10
      `);
      const mirrored = db.prepare(
        'SELECT units, current_price, current_value, valuation_date FROM investment_positions WHERE legacy_asset_id = 10',
      ).get();
      assert.deepEqual(mirrored, {
        units: 6,
        current_price: 120,
        current_value: 720,
        valuation_date: '2026-08-12',
      });

      db.prepare(`
        INSERT INTO investment_position_events (
          position_id, event_type, effective_date, current_price, current_value
        ) VALUES (?, 'valuation', '2026-08-12', 120, 720)
      `).run(migratedEtf.id);
      db.exec(`
        UPDATE investment_assets
        SET units = 7,
            current_price = 130,
            current_value = 910,
            valuation_date = '2026-08-13'
        WHERE id = 10
      `);
      const ledgerOwned = db.prepare(
        'SELECT units, current_price, current_value, valuation_date FROM investment_positions WHERE legacy_asset_id = 10',
      ).get();
      assert.deepEqual(ledgerOwned, mirrored);
    }),

  'preserves-duplicate-position-event-links': () =>
    withDatabase((db, dbPath) => {
      db.exec(`
        CREATE TABLE investment_position_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          position_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          effective_date TEXT NOT NULL,
          linked_transaction_identifier TEXT,
          linked_transaction_vendor TEXT
        );
        INSERT INTO investment_position_events (
          id, position_id, event_type, effective_date,
          linked_transaction_identifier, linked_transaction_vendor
        ) VALUES
          (1, 10, 'buy', '2026-01-01', 'bank-tx-1', 'bank-a'),
          (2, 11, 'buy', '2026-01-01', 'bank-tx-1', 'bank-a'),
          (3, 12, 'buy', '2026-01-01', 'bank-tx-2', 'bank-a');
        PRAGMA user_version = 4;
      `);

      const result = runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });

      assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM investment_position_events').get().count, 3);
      assert.deepEqual(
        db.prepare(`
          SELECT id, linked_transaction_identifier, linked_transaction_vendor
          FROM investment_position_events
          ORDER BY id
        `).all(),
        [
          { id: 1, linked_transaction_identifier: 'bank-tx-1', linked_transaction_vendor: 'bank-a' },
          { id: 2, linked_transaction_identifier: 'bank-tx-1', linked_transaction_vendor: 'bank-a' },
          { id: 3, linked_transaction_identifier: 'bank-tx-2', linked_transaction_vendor: 'bank-a' },
        ],
      );
      const index = db.prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'index'
          AND name = 'idx_investment_position_events_linked_transaction_unique'
      `).get();
      assert.match(index.sql, /UNIQUE INDEX/);
      assert.match(index.sql, /id NOT IN \(2\)/);
      const indexMetadata = db.prepare(`
        PRAGMA index_list('investment_position_events')
      `).all().find((entry) =>
        entry.name === 'idx_investment_position_events_linked_transaction_unique');
      assert.equal(indexMetadata.unique, 1);
      assert.equal(indexMetadata.partial, 1);
      assert.equal(db.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'trigger'
          AND name IN (
            'trg_position_event_link_unique_insert',
            'trg_position_event_link_unique_update'
          )
      `).get().count, 2);

      db.pragma('user_version = 4');
      runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM investment_position_events').get().count, 3);

      assert.throws(() => db.prepare(`
        INSERT INTO investment_position_events (
          position_id, event_type, effective_date,
          linked_transaction_identifier, linked_transaction_vendor
        ) VALUES (13, 'buy', '2026-01-02', 'bank-tx-1', 'bank-a')
      `).run(), /position event transaction link already exists/);
      assert.throws(() => db.prepare(`
        UPDATE investment_position_events
        SET linked_transaction_identifier = 'bank-tx-2',
            linked_transaction_vendor = 'bank-a'
        WHERE id = 2
      `).run(), /position event transaction link already exists/);

      db.prepare('DELETE FROM investment_position_events WHERE id = 1').run();
      assert.throws(() => db.prepare(`
        INSERT INTO investment_position_events (
          position_id, event_type, effective_date,
          linked_transaction_identifier, linked_transaction_vendor
        ) VALUES (13, 'buy', '2026-01-02', 'bank-tx-1', 'bank-a')
      `).run(), /position event transaction link already exists/);
      assert.doesNotThrow(() => db.prepare(`
        INSERT INTO investment_position_events (
          position_id, event_type, effective_date,
          linked_transaction_identifier, linked_transaction_vendor
        ) VALUES (13, 'buy', '2026-01-02', 'bank-tx-3', 'bank-a')
      `).run());
      assert.doesNotThrow(() => db.prepare(`
        INSERT INTO investment_position_events (
          position_id, event_type, effective_date,
          linked_transaction_identifier, linked_transaction_vendor
        ) VALUES (14, 'buy', '2026-01-02', NULL, NULL)
      `).run());
    }),

  'optimizer-v2-from-legacy-v5': () =>
    withDatabase((db, dbPath) => {
      db.pragma('user_version = 5');
      const result = runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });
      assert.equal(result.fromVersion, 5);
      assert.equal(result.toVersion, 6);
      assert.equal(getSchemaVersion(db), 6);
      const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'optimizer_v2_%'
        ORDER BY name
      `).all().map((row) => row.name);
      assert.deepEqual(tables, [
        'optimizer_v2_candidates',
        'optimizer_v2_review_groups',
        'optimizer_v2_runs',
        'optimizer_v2_sources',
      ]);
    }),
};

const scenario = process.argv[2];
if (!scenarios[scenario]) {
  console.error(`Unknown scenario: ${scenario}`);
  process.exit(1);
}

Promise.resolve(scenarios[scenario]())
  .then(() => {
    console.log(`schema-migrations:${scenario}:ok`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
