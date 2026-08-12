const fs = require('fs');
const path = require('path');

/**
 * Versioned schema migrations, tracked with SQLite's PRAGMA user_version.
 *
 * Rules for adding a migration:
 * - Append a new entry to MIGRATIONS with the next integer version.
 * - Migrations must be idempotent. Fresh databases created by
 *   scripts/init_sqlite_db.js already contain the latest schema but start at
 *   user_version 0, so every migration re-runs against a schema where its
 *   change may already exist. Guard column adds with a PRAGMA table_info
 *   check and DDL with IF NOT EXISTS.
 * - Never edit or delete a shipped migration; released versions have already
 *   been stamped on user databases.
 *
 * Each pending migration runs inside its own IMMEDIATE transaction and the
 * version stamp is written in the same transaction, so a failure rolls back
 * both the schema change and the stamp. A file-level backup of the database
 * is taken before the first pending migration is applied.
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline-v0.1.33',
    // Pure version stamp: no schema change, so no pre-migration backup is
    // needed. Schemas up to v0.1.33 are converged by init_sqlite_db.js (fresh
    // installs) and the idempotent startup fixes in sqlite-pool.js (existing
    // installs), which run before this.
    mutatesSchema: false,
    up: () => {},
  },
];

const CURRENT_SCHEMA_VERSION = MIGRATIONS.length
  ? MIGRATIONS[MIGRATIONS.length - 1].version
  : 0;

function getSchemaVersion(db) {
  const value = db.pragma('user_version', { simple: true });
  return Number.isInteger(value) ? value : Number(value) || 0;
}

function validateMigrations(migrations) {
  let previousVersion = 0;
  for (const migration of migrations) {
    if (!migration || !Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(
        `[schema-migrations] invalid migration version: ${migration && migration.version}`,
      );
    }
    if (migration.version <= previousVersion) {
      throw new Error(
        `[schema-migrations] migration versions must be strictly ascending; ` +
        `found v${migration.version} after v${previousVersion}`,
      );
    }
    if (typeof migration.up !== 'function') {
      throw new Error(`[schema-migrations] migration v${migration.version} has no up() function`);
    }
    previousVersion = migration.version;
  }
}

function createPreMigrationBackup(dbPath, fromVersion, toVersion) {
  const parsedPath = path.parse(dbPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(parsedPath.dir, 'backups');
  const backupPath = path.join(
    backupDir,
    `${parsedPath.name || 'shekelsync'}-pre-migration-v${fromVersion}-to-v${toVersion}-${timestamp}${parsedPath.ext || '.sqlite'}`,
  );

  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(dbPath, backupPath);

  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) {
    fs.copyFileSync(walPath, `${backupPath}-wal`);
  }
  if (fs.existsSync(shmPath)) {
    fs.copyFileSync(shmPath, `${backupPath}-shm`);
  }

  return backupPath;
}

/**
 * Apply all migrations newer than the database's current user_version.
 * Throws (after rolling back the failing migration) so callers fail closed
 * instead of serving a half-migrated database.
 *
 * @param {import('better-sqlite3').Database} db open database handle
 * @param {object} [options]
 * @param {string} [options.dbPath] file path, enables the pre-migration backup
 * @param {object} [options.logger] console-like logger
 * @param {Array} [options.migrations] override registry (tests only)
 * @returns {{fromVersion: number, toVersion: number, applied: string[], backupPath: string|null}}
 */
function runSchemaMigrations(db, options = {}) {
  const { dbPath = null, logger = console, migrations = MIGRATIONS } = options;
  validateMigrations(migrations);

  const fromVersion = getSchemaVersion(db);
  const pending = migrations.filter((migration) => migration.version > fromVersion);
  if (pending.length === 0) {
    return { fromVersion, toVersion: fromVersion, applied: [], backupPath: null };
  }

  const targetVersion = pending[pending.length - 1].version;

  // Back up only when a pending migration actually changes the database.
  // Pure version stamps (mutatesSchema === false) have nothing to lose.
  const needsBackup = pending.some((migration) => migration.mutatesSchema !== false);

  let backupPath = null;
  if (needsBackup && dbPath && fs.existsSync(dbPath)) {
    // Fail closed: if we cannot secure a backup, do not touch the schema.
    backupPath = createPreMigrationBackup(dbPath, fromVersion, targetVersion);
  }

  const applied = [];
  for (const migration of pending) {
    try {
      db.exec('BEGIN IMMEDIATE');
      // Another connection may have migrated while we waited for the lock.
      if (getSchemaVersion(db) >= migration.version) {
        db.exec('ROLLBACK');
        continue;
      }
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      if (db.inTransaction) {
        try {
          db.exec('ROLLBACK');
        } catch (_rollbackError) {
          // Preserve the original migration error.
        }
      }
      error.message =
        `[schema-migrations] migration v${migration.version} (${migration.name}) failed: ` +
        `${error.message}. Database left at schema version ${getSchemaVersion(db)}.` +
        (backupPath ? ` Pre-migration backup: ${backupPath}` : '');
      throw error;
    }
    applied.push(`v${migration.version} ${migration.name}`);
  }

  if (applied.length > 0) {
    logger.log(
      `[schema-migrations] migrated ${fromVersion} -> ${targetVersion}: ${applied.join(', ')}`,
    );
  }

  return { fromVersion, toVersion: targetVersion, applied, backupPath };
}

module.exports = {
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  runSchemaMigrations,
};
module.exports.default = module.exports;
