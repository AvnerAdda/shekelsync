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
  {
    // Existing ShekelSync databases may already carry PRAGMA user_version 5
    // from the pre-registry migration path. This must therefore be v6 rather
    // than v2 or those databases would silently skip the optimizer schema.
    version: 6,
    name: 'optimizer-v2-review-scope-action',
    mutatesSchema: true,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS optimizer_v2_review_groups (
          group_key TEXT PRIMARY KEY CHECK(group_key IN (
            'household', 'cash_flow', 'banking', 'investments', 'real_estate'
          )),
          fingerprint TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('confirmed', 'excluded')),
          confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS optimizer_v2_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_uuid TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('complete', 'failed')),
          primary_scope TEXT NOT NULL,
          extra_scopes_json TEXT NOT NULL DEFAULT '[]',
          constraints_json TEXT NOT NULL,
          review_fingerprints_json TEXT NOT NULL,
          timings_json TEXT NOT NULL DEFAULT '{}',
          checked_areas_json TEXT NOT NULL DEFAULT '[]',
          source_metadata_json TEXT NOT NULL DEFAULT '[]',
          research_status TEXT NOT NULL DEFAULT 'not_requested',
          score_version TEXT NOT NULL DEFAULT 'optimizer-v2-score-1',
          openai_model TEXT,
          error_codes_json TEXT NOT NULL DEFAULT '[]',
          generated_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS optimizer_v2_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL,
          action_id TEXT NOT NULL,
          smart_action_item_id INTEGER,
          scope TEXT NOT NULL,
          provider TEXT,
          product TEXT,
          title TEXT NOT NULL,
          rationale TEXT NOT NULL,
          next_action TEXT NOT NULL,
          caveat TEXT,
          eligibility_status TEXT NOT NULL CHECK(eligibility_status IN ('matched', 'possible', 'ineligible')),
          eligibility_json TEXT NOT NULL DEFAULT '{}',
          one_time_low REAL NOT NULL DEFAULT 0,
          one_time_high REAL NOT NULL DEFAULT 0,
          monthly_low REAL NOT NULL DEFAULT 0,
          monthly_high REAL NOT NULL DEFAULT 0,
          annual_low REAL NOT NULL DEFAULT 0,
          annual_high REAL NOT NULL DEFAULT 0,
          score REAL NOT NULL,
          confidence TEXT NOT NULL CHECK(confidence IN ('low', 'medium', 'high')),
          effort TEXT NOT NULL CHECK(effort IN ('low', 'medium', 'high')),
          evidence_json TEXT NOT NULL DEFAULT '[]',
          public_terms_json TEXT NOT NULL DEFAULT '{}',
          source_urls_json TEXT NOT NULL DEFAULT '[]',
          retrieved_at TEXT,
          valid_until TEXT,
          reverify_required INTEGER NOT NULL DEFAULT 0 CHECK(reverify_required IN (0, 1)),
          lifecycle_state TEXT NOT NULL DEFAULT 'candidate' CHECK(lifecycle_state IN (
            'candidate', 'added', 'started', 'snoozed', 'done', 'dismissed'
          )),
          feedback_code TEXT CHECK(feedback_code IS NULL OR feedback_code IN ('useful', 'not_useful', 'unsure')),
          feedback_reasons_json TEXT NOT NULL DEFAULT '[]',
          outcome_band TEXT CHECK(outcome_band IS NULL OR outcome_band IN (
            'none', 'below_estimate', 'within_estimate', 'above_estimate', 'unknown'
          )),
          snooze_preset TEXT CHECK(snooze_preset IS NULL OR snooze_preset IN ('1_week', '1_month', '3_months')),
          dismiss_reason TEXT,
          source_verified_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(run_id, action_id),
          FOREIGN KEY (run_id) REFERENCES optimizer_v2_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (smart_action_item_id) REFERENCES smart_action_items(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS optimizer_v2_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL,
          candidate_id INTEGER,
          url TEXT NOT NULL,
          domain TEXT NOT NULL,
          title TEXT,
          trust_tier TEXT NOT NULL CHECK(trust_tier IN ('regulator', 'provider', 'established', 'lead')),
          retrieved_at TEXT NOT NULL,
          valid_until TEXT,
          verified_at TEXT,
          availability_status TEXT NOT NULL DEFAULT 'unverified' CHECK(availability_status IN (
            'unverified', 'available', 'unavailable'
          )),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (run_id) REFERENCES optimizer_v2_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (candidate_id) REFERENCES optimizer_v2_candidates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_review_status
          ON optimizer_v2_review_groups(status);
        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_runs_generated
          ON optimizer_v2_runs(generated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_candidates_run_score
          ON optimizer_v2_candidates(run_id, score DESC);
        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_candidates_lifecycle
          ON optimizer_v2_candidates(lifecycle_state);
        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_sources_run
          ON optimizer_v2_sources(run_id);
      `);
    },
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
