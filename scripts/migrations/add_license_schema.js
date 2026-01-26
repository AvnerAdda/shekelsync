#!/usr/bin/env node
/**
 * Migration Script: Add license table for licensing system.
 *
 * Creates the license table to store local license data including
 * teudat_zehut, device_hash, trial dates, and sync status.
 *
 * Usage:
 *   node scripts/migrations/add_license_schema.js [--db dist/clarify.db]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  path.join(PROJECT_ROOT, 'dist', 'clarify.db'),
  path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite'),
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
      console.log(`Usage: node scripts/migrations/add_license_schema.js [options]

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

const TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS license (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  unique_id TEXT NOT NULL UNIQUE,
  teudat_zehut TEXT NOT NULL,
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

  console.log(`\n=== License Schema Migration ===\n`);
  console.log(`Database: ${dbPath}`);

  const Database = resolveDatabaseCtor();
  if (Database?.error) {
    console.warn('WARN: better-sqlite3 unavailable; using sqlite3 CLI instead.');
    if (Database.error?.message) {
      console.warn(`WARN: ${Database.error.message}`);
    }
    try {
      runWithSqliteCli(dbPath);
      console.log('OK: License table is up to date.\n');
    } catch (error) {
      console.error('ERROR: Migration failed:', error.message);
      process.exitCode = 1;
    }
    return;
  }

  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
  } catch (error) {
    console.warn('WARN: better-sqlite3 failed to load; using sqlite3 CLI instead.');
    if (error?.message) {
      console.warn(`WARN: ${error.message}`);
    }
    try {
      runWithSqliteCli(dbPath);
      console.log('OK: License table is up to date.\n');
    } catch (cliError) {
      console.error('ERROR: Migration failed:', cliError.message);
      process.exitCode = 1;
    }
    return;
  }

  try {
    // Check if table already exists
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='license'`
    ).get();

    if (tableExists) {
      console.log('INFO: License table already exists, skipping creation.');
    } else {
      db.exec(TABLE_STATEMENT);
      console.log('OK: License table created successfully.');
    }

    console.log('OK: License table is up to date.\n');
  } catch (error) {
    console.error('ERROR: Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();

function runWithSqliteCli(dbPath) {
  const sqliteBin = process.env.SQLITE3_BIN || 'sqlite3';
  const sql = TABLE_STATEMENT;

  const result = spawnSync(sqliteBin, [dbPath], {
    input: sql,
    encoding: 'utf8',
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`sqlite3 CLI not found. Set SQLITE3_BIN or install sqlite3.`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(stderr || `sqlite3 exited with status ${result.status}`);
  }
}
