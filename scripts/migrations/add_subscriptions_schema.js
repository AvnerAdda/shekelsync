#!/usr/bin/env node
/**
 * Migration Script: Add subscription management tables and indexes.
 *
 * Usage:
 *   node scripts/migrations/add_subscriptions_schema.js [--db dist/clarify.db]
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
      console.log(`Usage: node scripts/migrations/add_subscriptions_schema.js [options]

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

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    detected_frequency TEXT CHECK(detected_frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'yearly', 'variable')),
    detected_amount REAL,
    amount_is_fixed INTEGER DEFAULT 0 CHECK(amount_is_fixed IN (0, 1)),
    consistency_score REAL CHECK(consistency_score >= 0 AND consistency_score <= 1),
    user_frequency TEXT CHECK(user_frequency IS NULL OR user_frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'yearly', 'variable')),
    user_amount REAL,
    billing_day INTEGER CHECK(billing_day IS NULL OR (billing_day >= 1 AND billing_day <= 31)),
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cancelled', 'keep', 'review')),
    category_definition_id INTEGER,
    first_detected_date TEXT,
    last_charge_date TEXT,
    next_expected_date TEXT,
    is_manual INTEGER DEFAULT 0 CHECK(is_manual IN (0, 1)),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
  );`,
  `CREATE TABLE IF NOT EXISTS subscription_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('price_change', 'status_change', 'frequency_change', 'charge')),
    old_value TEXT,
    new_value TEXT,
    amount REAL,
    transaction_identifier TEXT,
    transaction_vendor TEXT,
    event_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_identifier, transaction_vendor) REFERENCES transactions(identifier, vendor) ON DELETE SET NULL
  );`,
  `CREATE TABLE IF NOT EXISTS subscription_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL,
    alert_type TEXT NOT NULL CHECK(alert_type IN ('price_increase', 'price_decrease', 'missed_charge', 'duplicate', 'unused', 'upcoming_renewal', 'cancelled_still_charging')),
    severity TEXT DEFAULT 'info' CHECK(severity IN ('info', 'warning', 'critical')),
    title TEXT NOT NULL,
    description TEXT,
    old_amount REAL,
    new_amount REAL,
    percentage_change REAL,
    is_dismissed INTEGER DEFAULT 0 CHECK(is_dismissed IN (0, 1)),
    dismissed_at TEXT,
    is_actioned INTEGER DEFAULT 0 CHECK(is_actioned IN (0, 1)),
    actioned_at TEXT,
    action_taken TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
  );`,
];

const INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_pattern_key ON subscriptions(pattern_key);',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_frequency ON subscriptions(detected_frequency);',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_category ON subscriptions(category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_next_expected ON subscriptions(next_expected_date);',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_last_charge ON subscriptions(last_charge_date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_is_manual ON subscriptions(is_manual);',
  'CREATE INDEX IF NOT EXISTS idx_subscription_history_subscription_id ON subscription_history(subscription_id, event_date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_subscription_history_event_type ON subscription_history(event_type);',
  'CREATE INDEX IF NOT EXISTS idx_subscription_history_event_date ON subscription_history(event_date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_subscription_alerts_subscription_id ON subscription_alerts(subscription_id);',
  'CREATE INDEX IF NOT EXISTS idx_subscription_alerts_type ON subscription_alerts(alert_type);',
  'CREATE INDEX IF NOT EXISTS idx_subscription_alerts_dismissed ON subscription_alerts(is_dismissed);',
  'CREATE INDEX IF NOT EXISTS idx_subscription_alerts_severity ON subscription_alerts(severity);',
  'CREATE INDEX IF NOT EXISTS idx_subscription_alerts_created ON subscription_alerts(created_at DESC);',
];

function main() {
  const { dbPath } = parseArgs();

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    process.exit(1);
  }

  console.log(`\n=== Subscriptions Schema Migration ===\n`);
  console.log(`Database: ${dbPath}`);

  const Database = resolveDatabaseCtor();
  if (Database?.error) {
    console.warn('WARN: better-sqlite3 unavailable; using sqlite3 CLI instead.');
    if (Database.error?.message) {
      console.warn(`WARN: ${Database.error.message}`);
    }
    try {
      runWithSqliteCli(dbPath);
      console.log('OK: Subscriptions tables and indexes are up to date.\n');
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
      console.log('OK: Subscriptions tables and indexes are up to date.\n');
    } catch (cliError) {
      console.error('ERROR: Migration failed:', cliError.message);
      process.exitCode = 1;
    }
    return;
  }

  try {
    db.pragma('foreign_keys = ON');
    db.exec('BEGIN');

    for (const statement of TABLE_STATEMENTS) {
      db.exec(statement);
    }

    for (const statement of INDEX_STATEMENTS) {
      db.exec(statement);
    }

    db.exec('COMMIT');
    console.log('OK: Subscriptions tables and indexes are up to date.\n');
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('ERROR: Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();

function runWithSqliteCli(dbPath) {
  const sqliteBin = process.env.SQLITE3_BIN || 'sqlite3';
  const sql = [
    'PRAGMA foreign_keys = ON;',
    'BEGIN;',
    ...TABLE_STATEMENTS,
    ...INDEX_STATEMENTS,
    'COMMIT;',
  ].join('\n');

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
