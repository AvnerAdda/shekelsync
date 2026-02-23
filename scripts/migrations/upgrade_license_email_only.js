#!/usr/bin/env node
/**
 * Migration Script: Rebuild license table to be email-only.
 *
 * Drops legacy teudat_zehut column by rebuilding the table.
 * Safely copies existing records, mapping email from email/teudat_zehut.
 *
 * Usage:
 *   node scripts/migrations/upgrade_license_email_only.js [--db dist/shekelsync.sqlite]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const ROOT_NODE_MODULES = path.join(PROJECT_ROOT, 'node_modules');

function resolveDatabaseCtor() {
  const candidates = [
    path.join(APP_NODE_MODULES, 'better-sqlite3'),
    path.join(ROOT_NODE_MODULES, 'better-sqlite3'),
    'better-sqlite3',
  ];
  let lastError = null;

  for (const candidate of candidates) {
    try {
      if (candidate !== 'better-sqlite3' && !fs.existsSync(candidate)) {
        continue;
      }
      const resolved = require(candidate);
      return resolved.default ?? resolved;
    } catch (error) {
      lastError = error;
    }
  }

  return { error: lastError || new Error('better-sqlite3 not found') };
}

const DEFAULT_DB_PATHS = [
  path.join(PROJECT_ROOT, 'dist', 'shekelsync.sqlite'),
  path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite'),
  path.join(PROJECT_ROOT, 'dist', 'clarify.db'),
];

function resolvePath(input) {
  if (!input) return null;
  return path.isAbsolute(input) ? input : path.resolve(PROJECT_ROOT, input);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--db' || arg === '--path' || arg === '-d') {
      if (i + 1 >= args.length) {
        throw new Error(`Missing value after ${arg}`);
      }
      dbPath = resolvePath(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/migrations/upgrade_license_email_only.js [options]

Options:
  -d, --db <path>   Path to SQLite database file
  -h, --help        Show this help message
`);
      process.exit(0);
    }
  }

  if (!dbPath) {
    const envPath = resolvePath(process.env.SQLITE_DB_PATH);
    if (envPath) {
      dbPath = envPath;
    } else {
      dbPath = DEFAULT_DB_PATHS.find((candidate) => fs.existsSync(candidate)) || DEFAULT_DB_PATHS[0];
    }
  }

  return { dbPath };
}

const EMAIL_ONLY_SCHEMA = `CREATE TABLE license_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  unique_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  installation_date TEXT NOT NULL DEFAULT (datetime('now')),
  trial_start_date TEXT NOT NULL DEFAULT (datetime('now')),
  subscription_date TEXT,
  license_type TEXT NOT NULL DEFAULT 'trial' CHECK (license_type IN ('trial', 'pro', 'expired')),
  last_online_validation TEXT,
  offline_grace_start TEXT,
  is_synced_to_cloud INTEGER NOT NULL DEFAULT 0 CHECK (is_synced_to_cloud IN (0,1)),
  sync_error_message TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

function main() {
  const { dbPath } = parseArgs();

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    process.exit(1);
  }

  console.log(`\n=== License Email-Only Migration ===\n`);
  console.log(`Database: ${dbPath}`);

  const Database = resolveDatabaseCtor();
  if (Database?.error) {
    console.error('ERROR: better-sqlite3 unavailable:', Database.error.message);
    process.exit(1);
  }

  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
  } catch (error) {
    console.error('ERROR: Failed to open database:', error.message);
    process.exit(1);
  }

  try {
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='license'`
    ).get();

    if (!tableExists) {
      console.log('INFO: License table not found, creating email-only schema.');
      db.exec(EMAIL_ONLY_SCHEMA);
      console.log('OK: License table created.');
      return;
    }

    const columns = db.prepare('PRAGMA table_info(license)').all();
    const hasLegacy = columns.some((col) => col.name === 'teudat_zehut');
    if (!hasLegacy) {
      console.log('INFO: License table already email-only. Nothing to do.');
      return;
    }

    db.exec('BEGIN');
    db.exec(EMAIL_ONLY_SCHEMA);
    db.exec(`
      INSERT INTO license_new (
        id, unique_id, email, device_hash,
        installation_date, trial_start_date, subscription_date,
        license_type, last_online_validation, offline_grace_start,
        is_synced_to_cloud, sync_error_message, app_version,
        created_at, updated_at
      )
      SELECT
        id,
        unique_id,
        COALESCE(email, teudat_zehut, ''),
        device_hash,
        installation_date,
        trial_start_date,
        subscription_date,
        license_type,
        last_online_validation,
        offline_grace_start,
        is_synced_to_cloud,
        sync_error_message,
        app_version,
        created_at,
        updated_at
      FROM license
    `);
    db.exec('DROP TABLE license');
    db.exec('ALTER TABLE license_new RENAME TO license');
    db.exec('COMMIT');

    console.log('OK: License table rebuilt without teudat_zehut.');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    console.error('ERROR: Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}
