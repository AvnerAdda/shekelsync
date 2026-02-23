#!/usr/bin/env node
/**
 * Migration Script: Add donation tables for donation-first monetization.
 *
 * Usage:
 *   node scripts/migrations/add_donation_schema.js [--db dist/shekelsync.sqlite]
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

function resolvePath(input) {
  if (!input) return null;
  return path.isAbsolute(input) ? input : path.resolve(PROJECT_ROOT, input);
}

const DEFAULT_DB_PATHS = [
  path.join(PROJECT_ROOT, 'dist', 'shekelsync.sqlite'),
  path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite'),
  path.join(PROJECT_ROOT, 'dist', 'clarify.db'),
];

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
      console.log(`Usage: node scripts/migrations/add_donation_schema.js [options]

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

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS donation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_ils REAL NOT NULL CHECK (amount_ils > 0),
    donated_at TEXT NOT NULL,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
  `CREATE INDEX IF NOT EXISTS idx_donation_events_donated_at
     ON donation_events (donated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS donation_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_reminder_month_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
  `INSERT INTO donation_meta (id, last_reminder_month_key, created_at, updated_at)
   VALUES (1, NULL, datetime('now'), datetime('now'))
   ON CONFLICT(id) DO NOTHING;`,
];

function runWithSqliteCli(dbPath) {
  const sqliteBin = process.env.SQLITE3_BIN || 'sqlite3';
  const sql = STATEMENTS.join('\n');
  const result = spawnSync(sqliteBin, [dbPath], {
    input: sql,
    encoding: 'utf8',
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('sqlite3 CLI not found. Set SQLITE3_BIN or install sqlite3.');
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || '').trim() || `sqlite3 exited with status ${result.status}`);
  }
}

function main() {
  const { dbPath } = parseArgs();
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    process.exit(1);
  }

  console.log('\n=== Donation Schema Migration ===\n');
  console.log(`Database: ${dbPath}`);

  const Database = resolveDatabaseCtor();
  if (Database?.error) {
    console.warn('WARN: better-sqlite3 unavailable, trying sqlite3 CLI fallback.');
    try {
      runWithSqliteCli(dbPath);
      console.log('OK: Donation tables are up to date.\n');
    } catch (error) {
      console.error('ERROR: Migration failed:', error.message);
      process.exitCode = 1;
    }
    return;
  }

  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    STATEMENTS.forEach((statement) => db.exec(statement));
    console.log('OK: Donation tables are up to date.\n');
  } catch (error) {
    console.warn('WARN: better-sqlite3 execution failed, trying sqlite3 CLI fallback.');
    if (db) {
      try {
        db.close();
      } catch {
        // ignore close failures
      }
    }
    try {
      runWithSqliteCli(dbPath);
      console.log('OK: Donation tables are up to date (via sqlite3 CLI).\n');
    } catch (fallbackError) {
      console.error('ERROR: Migration failed:', fallbackError.message);
      process.exitCode = 1;
    }
    return;
  }

  db.close();
}

main();
