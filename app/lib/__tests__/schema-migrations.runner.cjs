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
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'forecast_prediction_snapshots'").get());
    }),

  'review-forecast-v8-from-legacy': () =>
    withDatabase((db, dbPath) => {
      db.exec(`
        CREATE TABLE subscription_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subscription_id INTEGER NOT NULL,
          alert_type TEXT NOT NULL,
          severity TEXT,
          title TEXT NOT NULL,
          description TEXT,
          old_amount REAL,
          new_amount REAL,
          percentage_change REAL,
          is_dismissed INTEGER DEFAULT 0,
          dismissed_at TEXT,
          is_actioned INTEGER DEFAULT 0,
          actioned_at TEXT,
          action_taken TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT
        );
        PRAGMA user_version = 7;
      `);

      runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });

      const columns = new Set(db.prepare("PRAGMA table_info('subscription_alerts')").all().map((column) => column.name));
      assert.ok(columns.has('identity_key'));
      assert.ok(columns.has('occurrence_id'));
      assert.ok(columns.has('correction_capabilities_json'));
      assert.ok(columns.has('time_scope_json'));
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_subscription_alerts_identity'").get());
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'forecast_prediction_snapshots'").get());

      const upsert = db.prepare(`
        INSERT INTO subscription_alerts (subscription_id, alert_type, severity, title, identity_key)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(identity_key) WHERE identity_key IS NOT NULL DO UPDATE SET title = excluded.title
      `);
      upsert.run(4, 'price_increase', 'warning', 'First', 'subscription:4:price:2026-08-01');
      upsert.run(4, 'price_increase', 'warning', 'Updated', 'subscription:4:price:2026-08-01');
      assert.deepEqual(
        db.prepare('SELECT COUNT(*) AS count, MAX(title) AS title FROM subscription_alerts').get(),
        { count: 1, title: 'Updated' },
      );
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
      assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(getSchemaVersion(db), CURRENT_SCHEMA_VERSION);
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

  'financial-truth-v7-backfill': () =>
    withDatabase((db, dbPath) => {
      db.exec(`
        CREATE TABLE category_definitions (id INTEGER PRIMARY KEY);
        CREATE TABLE transactions (
          identifier TEXT NOT NULL,
          vendor TEXT NOT NULL,
          PRIMARY KEY (identifier, vendor)
        );
        CREATE TABLE subscriptions (
          id INTEGER PRIMARY KEY,
          pattern_key TEXT,
          display_name TEXT NOT NULL,
          category_definition_id INTEGER,
          user_frequency TEXT,
          detected_frequency TEXT,
          user_amount REAL,
          detected_amount REAL,
          billing_day INTEGER,
          consistency_score REAL,
          first_detected_date TEXT,
          last_charge_date TEXT,
          next_expected_date TEXT,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE subscription_history (
          id INTEGER PRIMARY KEY,
          subscription_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          event_date TEXT NOT NULL
        );
        INSERT INTO subscriptions VALUES
          (1, 'stream', 'Stream', NULL, NULL, 'monthly', NULL, 50, NULL, .9, '2026-01-01', '2026-07-01', '2026-08-01', 'cancelled', '2026-07-20'),
          (2, 'gym', 'Gym', NULL, NULL, 'monthly', NULL, 120, NULL, .8, '2026-01-02', '2026-07-02', '2026-08-02', 'paused', '2026-07-21'),
          (3, 'cloud', 'Cloud', NULL, 'yearly', 'monthly', 240, 20, 15, .8, '2026-01-03', '2026-07-03', '2026-08-03', 'keep', '2026-07-22'),
          (4, 'news', 'News', NULL, NULL, 'monthly', NULL, 10, NULL, .7, '2026-01-04', '2026-07-04', '2026-08-04', 'review', '2026-07-23');
        INSERT INTO subscription_history VALUES
          (1, 1, 'status_change', '2026-06-15'),
          (2, 1, 'status_change', '2026-07-15');
        PRAGMA user_version = 6;
      `);

      const result = runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });
      assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM financial_patterns').get().count, 4);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM financial_corrections').get().count, 3);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM subscriptions WHERE financial_pattern_id IS NOT NULL').get().count, 4);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM financial_corrections WHERE source_key = 'subscription:4'").get().count, 0);
      assert.deepEqual(
        db.prepare("SELECT action, effective_date FROM financial_corrections WHERE source_key = 'subscription:1'").get(),
        { action: 'end_pattern', effective_date: '2026-07-15' },
      );
      assert.deepEqual(
        JSON.parse(db.prepare("SELECT overrides_json FROM financial_corrections WHERE source_key = 'subscription:3'").get().overrides_json),
        { amount: 240, frequency: 'yearly', billingDay: 15, confirmed: true },
      );
      assert.equal(db.prepare('SELECT revision FROM financial_truth_state WHERE id = 1').get().revision, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'presentation_dismissals'").get().count, 1);
    }),

  'financial-truth-service-roundtrip': () =>
    withDatabase((db, dbPath) => {
      db.exec(`
        CREATE TABLE category_definitions (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
        CREATE TABLE transactions (
          identifier TEXT NOT NULL,
          vendor TEXT NOT NULL,
          date TEXT NOT NULL,
          name TEXT,
          merchant_name TEXT,
          price REAL NOT NULL,
          category_type TEXT NOT NULL,
          category_definition_id INTEGER,
          status TEXT NOT NULL,
          PRIMARY KEY (identifier, vendor)
        );
        CREATE TABLE transaction_pairing_exclusions (
          transaction_identifier TEXT NOT NULL,
          transaction_vendor TEXT NOT NULL
        );
        CREATE TABLE subscriptions (
          id INTEGER PRIMARY KEY,
          pattern_key TEXT,
          display_name TEXT NOT NULL,
          category_definition_id INTEGER,
          user_frequency TEXT,
          detected_frequency TEXT,
          user_amount REAL,
          detected_amount REAL,
          billing_day INTEGER,
          consistency_score REAL,
          first_detected_date TEXT,
          last_charge_date TEXT,
          next_expected_date TEXT,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE subscription_history (
          id INTEGER PRIMARY KEY,
          subscription_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          event_date TEXT NOT NULL
        );
        INSERT INTO category_definitions VALUES (5, 'Media');
        INSERT INTO transactions VALUES
          ('tx-1', 'card-a', '2026-05-05', 'Example Stream', 'Example Stream', -49, 'expense', 5, 'completed'),
          ('tx-2', 'card-b', '2026-06-05', 'Example Stream', 'Example Stream', -50, 'expense', 5, 'completed'),
          ('tx-3', 'card-a', '2026-07-05', 'Example Stream', 'Example Stream', -51, 'expense', 5, 'completed'),
          ('tx-4', 'card-c', '2026-05-19', 'Example Stream', 'Example Stream', -199, 'expense', 5, 'completed'),
          ('tx-5', 'card-c', '2026-06-19', 'Example Stream', 'Example Stream', -200, 'expense', 5, 'completed'),
          ('tx-6', 'card-d', '2026-07-19', 'Example Stream', 'Example Stream', -201, 'expense', 5, 'completed');
        PRAGMA user_version = 6;
      `);
      runSchemaMigrations(db, { dbPath, logger: { log: () => {} } });
      const truth = require('../../server/services/financial-truth.js');

      const detected = truth.getProjectionSnapshot({ db });
      assert.equal(detected.patterns.length, 2);
      assert.ok(detected.patterns.every((pattern) => pattern.frequency === 'monthly'));
      assert.deepEqual(detected.patterns.map((pattern) => Math.round(pattern.amount)).sort((a, b) => a - b), [50, 200]);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 6);
      const patternId = detected.patterns.find((pattern) => pattern.amount < 100).id;
      const beforeRevision = detected.truthRevision;

      const result = truth.createCorrection({
        requestId: 'roundtrip-suppress',
        target: { kind: 'pattern', patternId },
        action: 'suppress_pattern',
        scope: 'ongoing',
        reasonCode: 'not_recurring',
        source: { feature: 'dashboard', sourceKey: 'forecast-card:stream' },
      }, { db });
      assert.ok(result.truthRevision > beforeRevision);
      assert.equal(truth.getProjectionSnapshot({ db }).patterns.find((pattern) => pattern.id === patternId).state, 'suppressed');
      assert.deepEqual(truth.buildRecurringOccurrences(
        truth.getProjectionSnapshot({ db }), '2026-08-01', '2027-01-31',
      ).filter((occurrence) => occurrence.patternId === patternId), []);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 6);

      const duplicate = truth.createCorrection({
        requestId: 'roundtrip-suppress',
        target: { kind: 'pattern', patternId },
        action: 'suppress_pattern',
        scope: 'ongoing',
        reasonCode: 'not_recurring',
        source: { feature: 'dashboard' },
      }, { db });
      assert.equal(duplicate.correction.id, result.correction.id);
      assert.equal(duplicate.truthRevision, result.truthRevision);

      const restored = truth.revertCorrection(result.correction.id, { db });
      assert.equal(restored.correction.status, 'reverted');
      assert.equal(truth.getProjectionSnapshot({ db }).patterns.find((pattern) => pattern.id === patternId).state, 'active');
      assert.ok(truth.buildRecurringOccurrences(
        truth.getProjectionSnapshot({ db }), '2026-08-01', '2026-10-31',
      ).filter((occurrence) => occurrence.patternId === patternId).length > 0);

      truth.setPresentationDismissal('notification:stream', { hidden: true }, { db });
      assert.deepEqual([...truth.getHiddenSourceKeys({ db })], ['notification:stream']);
      truth.setPresentationDismissal('notification:stream', { hidden: false }, { db });
      assert.deepEqual([...truth.getHiddenSourceKeys({ db })], []);

      const stablePatternIds = truth.getProjectionSnapshot({ db }).patterns.map((pattern) => pattern.id).sort();
      const revisionBeforeImportChange = truth.getProjectionSnapshot({ db }).truthRevision;
      db.prepare("UPDATE transactions SET price = -52 WHERE identifier = 'tx-3' AND vendor = 'card-a'").run();
      assert.equal(db.prepare('SELECT materialized_transaction_signature FROM financial_truth_state WHERE id = 1').get().materialized_transaction_signature, null);
      const rematerialized = truth.getProjectionSnapshot({ db });
      assert.ok(rematerialized.truthRevision > revisionBeforeImportChange);
      assert.deepEqual(rematerialized.patterns.map((pattern) => pattern.id).sort(), stablePatternIds);
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
