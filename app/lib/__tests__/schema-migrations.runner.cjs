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
