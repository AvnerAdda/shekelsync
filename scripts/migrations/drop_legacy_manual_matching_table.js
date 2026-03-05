#!/usr/bin/env node
/**
 * Drop legacy manual-matching table that is no longer used.
 *
 * Usage:
 *   node scripts/migrations/drop_legacy_manual_matching_table.js [--db dist/shekelsync.sqlite] [--dry-run]
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

const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'shekelsync.sqlite');

function resolvePath(input) {
  if (!input) return null;
  return path.isAbsolute(input) ? input : path.resolve(PROJECT_ROOT, input);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = null;
  let dryRun = false;

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
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/migrations/drop_legacy_manual_matching_table.js [options]

Options:
  -d, --db <path>   Path to SQLite database file (default: dist/shekelsync.sqlite)
      --dry-run     Show what would be dropped without changing DB
  -h, --help        Show this help message
`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!dbPath) {
    const envPath = resolvePath(process.env.SQLITE_DB_PATH);
    dbPath = envPath || DEFAULT_DB_PATH;
  }

  return { dbPath, dryRun };
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return Boolean(row);
}

function indexExists(db, indexName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
    .get(indexName);
  return Boolean(row);
}

function runWithSqliteCli({ dbPath, dryRun }) {
  const legacyTable = 'credit_card_expense_matches';
  const legacyIndexes = [
    'idx_cc_matches_repayment',
    'idx_cc_matches_expense',
    'idx_cc_matches_dates',
    'idx_cc_matches_method',
  ];

  const dryRunSql = `
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${legacyTable}')
  THEN 'present'
  ELSE 'missing'
END AS table_status;
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${legacyTable}')
  THEN (SELECT COUNT(*) FROM ${legacyTable})
  ELSE 0
END AS row_count;
SELECT COUNT(*) AS legacy_indexes_present
FROM sqlite_master
WHERE type = 'index'
  AND name IN (${legacyIndexes.map((idx) => `'${idx}'`).join(', ')});
`;

  const migrationSql = `
BEGIN;
${legacyIndexes.map((idx) => `DROP INDEX IF EXISTS ${idx};`).join('\n')}
DROP TABLE IF EXISTS ${legacyTable};
COMMIT;
`;

  const sql = dryRun ? dryRunSql : `${dryRunSql}\n${migrationSql}`;
  const result = spawnSync('sqlite3', [dbPath, '-batch'], {
    input: sql,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(stderr || `sqlite3 exited with status ${result.status}`);
  }

  const rows = String(result.stdout || '').trim().split('\n').filter(Boolean);
  const tableStatus = rows[0] || 'unknown';
  const rowCount = Number(rows[1] || 0);
  const legacyIndexCount = Number(rows[2] || 0);

  return {
    tableStatus,
    rowCount,
    legacyIndexCount,
  };
}

function main() {
  const { dbPath, dryRun } = parseArgs();

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`);
    process.exit(1);
  }

  const Database = resolveDatabaseCtor();
  if (Database?.error) {
    console.warn('WARN: better-sqlite3 unavailable; using sqlite3 CLI fallback.');
    if (Database.error?.message) {
      console.warn(`WARN: ${Database.error.message}`);
    }
    try {
      const summary = runWithSqliteCli({ dbPath, dryRun });
      console.log('=== Legacy Manual-Matching Cleanup ===');
      console.log(`Database: ${dbPath}`);
      console.log(`Table credit_card_expense_matches: ${summary.tableStatus}`);
      console.log(`Rows in credit_card_expense_matches: ${summary.rowCount}`);
      console.log(`Legacy indexes present: ${summary.legacyIndexCount}`);
      console.log(dryRun ? 'Dry run mode: no changes applied.' : 'Cleanup complete: legacy manual-matching schema removed.');
      return;
    } catch (error) {
      console.error('Cleanup failed:', error.message || error);
      process.exitCode = 1;
      return;
    }
  }

  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });
  } catch (error) {
    console.warn('WARN: better-sqlite3 failed to open DB; using sqlite3 CLI fallback.');
    if (error?.message) {
      console.warn(`WARN: ${error.message}`);
    }
    try {
      const summary = runWithSqliteCli({ dbPath, dryRun });
      console.log('=== Legacy Manual-Matching Cleanup ===');
      console.log(`Database: ${dbPath}`);
      console.log(`Table credit_card_expense_matches: ${summary.tableStatus}`);
      console.log(`Rows in credit_card_expense_matches: ${summary.rowCount}`);
      console.log(`Legacy indexes present: ${summary.legacyIndexCount}`);
      console.log(dryRun ? 'Dry run mode: no changes applied.' : 'Cleanup complete: legacy manual-matching schema removed.');
      return;
    } catch (fallbackError) {
      console.error('Cleanup failed:', fallbackError.message || fallbackError);
      process.exitCode = 1;
      return;
    }
  }
  const legacyTable = 'credit_card_expense_matches';
  const legacyIndexes = [
    'idx_cc_matches_repayment',
    'idx_cc_matches_expense',
    'idx_cc_matches_dates',
    'idx_cc_matches_method',
  ];

  try {
    db.pragma('foreign_keys = ON');

    const hasLegacyTable = tableExists(db, legacyTable);
    const rowCount = hasLegacyTable
      ? Number(db.prepare(`SELECT COUNT(*) AS count FROM ${legacyTable}`).get()?.count || 0)
      : 0;
    const existingIndexes = legacyIndexes.filter((indexName) => indexExists(db, indexName));

    console.log('=== Legacy Manual-Matching Cleanup ===');
    console.log(`Database: ${dbPath}`);
    console.log(`Table ${legacyTable}: ${hasLegacyTable ? 'present' : 'missing'}`);
    if (hasLegacyTable) {
      console.log(`Rows in ${legacyTable}: ${rowCount}`);
    }
    console.log(`Legacy indexes present: ${existingIndexes.length}`);

    if (dryRun) {
      console.log('Dry run mode: no changes applied.');
      return;
    }

    if (!hasLegacyTable && existingIndexes.length === 0) {
      console.log('No cleanup needed.');
      return;
    }

    db.exec('BEGIN');
    for (const indexName of legacyIndexes) {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    }
    db.exec(`DROP TABLE IF EXISTS ${legacyTable}`);
    db.exec('COMMIT');

    console.log('Cleanup complete: legacy manual-matching schema removed.');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors.
    }
    console.error('Cleanup failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
