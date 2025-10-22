#!/usr/bin/env node
/**
 * Deprecate Legacy Category Columns Migration
 *
 * This script marks the legacy category columns as deprecated by adding comments
 * and optionally drops them after verification.
 *
 * Usage:
 *   node scripts/deprecate_legacy_category_columns.js [--drop] [--db path/to/db.sqlite]
 *
 * Options:
 *   --drop          Actually drop the columns (default: just add deprecation comments)
 *   --db <path>     Path to SQLite database (default: dist/clarify.sqlite)
 *   --no-backup     Skip automatic backup creation
 *   --help          Show this help message
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

// Legacy columns to deprecate/drop
const LEGACY_COLUMNS = {
  transactions: ['category', 'parent_category', 'subcategory'],
  categorization_rules: ['target_category', 'parent_category', 'subcategory']
};

function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = DEFAULT_DB_PATH;
  let dropColumns = false;
  let noBackup = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--db':
      case '-d':
        dbPath = path.resolve(PROJECT_ROOT, args[i + 1]);
        i++;
        break;
      case '--drop':
        dropColumns = true;
        break;
      case '--force':
      case '-f':
        force = true;
        break;
      case '--no-backup':
        noBackup = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (!arg.startsWith('--')) continue;
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dbPath, dropColumns, noBackup, force };
}

function printHelp() {
  console.log(`
Deprecate Legacy Category Columns Migration

Usage:
  node scripts/deprecate_legacy_category_columns.js [options]

Options:
  --db <path>       Path to SQLite database (default: dist/clarify.sqlite)
  --drop            Actually drop the columns (WARNING: irreversible!)
  --force, -f       Force drop even if columns contain data
  --no-backup       Skip automatic backup creation
  -h, --help        Show this help message

Examples:
  # Dry run: just check what would be done
  node scripts/deprecate_legacy_category_columns.js

  # Drop legacy columns (creates backup first)
  node scripts/deprecate_legacy_category_columns.js --drop --force

  # Drop without backup (not recommended)
  node scripts/deprecate_legacy_category_columns.js --drop --force --no-backup
`);
}

function backupDatabase(dbPath) {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupPath = `${dbPath}.bak-${timestamp}`;
  fs.copyFileSync(dbPath, backupPath);
  log('INFO', `Created backup at ${backupPath}`);
  return backupPath;
}

function columnExists(db, tableName, columnName) {
  const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return info.some(col => col.name === columnName);
}

function verifyColumnNotUsed(db, tableName, columnName) {
  try {
    const result = db.prepare(
      `SELECT COUNT(*) as count FROM ${tableName} WHERE ${columnName} IS NOT NULL`
    ).get();

    return result.count === 0;
  } catch (error) {
    log('ERROR', `Failed to verify column ${tableName}.${columnName}: ${error.message}`);
    return false;
  }
}

function dropLegacyColumn(db, tableName, columnName) {
  log('INFO', `Dropping column ${tableName}.${columnName}...`);

  // SQLite doesn't support DROP COLUMN directly, need to recreate table
  // Get current schema
  const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const columnsToKeep = tableInfo
    .filter(col => col.name !== columnName)
    .map(col => col.name);

  const columnsList = columnsToKeep.join(', ');

  // Create temp table without the legacy column
  db.exec(`BEGIN TRANSACTION`);

  try {
    db.exec(`CREATE TABLE ${tableName}_new AS SELECT ${columnsList} FROM ${tableName}`);
    db.exec(`DROP TABLE ${tableName}`);
    db.exec(`ALTER TABLE ${tableName}_new RENAME TO ${tableName}`);

    // Recreate indexes (simplified - in production, you'd preserve all indexes)
    if (tableName === 'transactions') {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
        CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions(vendor);
        CREATE INDEX IF NOT EXISTS idx_transactions_category_def ON transactions(category_definition_id);
      `);
    }

    db.exec('COMMIT');
    log('SUCCESS', `Dropped column ${tableName}.${columnName}`);
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    log('ERROR', `Failed to drop column ${tableName}.${columnName}: ${error.message}`);
    return false;
  }
}

function analyzeLegacyUsage(db) {
  log('INFO', '=== Analyzing Legacy Column Usage ===');

  const analysis = {};

  for (const [tableName, columns] of Object.entries(LEGACY_COLUMNS)) {
    analysis[tableName] = {};

    for (const columnName of columns) {
      if (!columnExists(db, tableName, columnName)) {
        analysis[tableName][columnName] = { exists: false };
        continue;
      }

      const result = db.prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN ${columnName} IS NOT NULL THEN 1 ELSE 0 END) as non_null
         FROM ${tableName}`
      ).get();

      analysis[tableName][columnName] = {
        exists: true,
        total_rows: result.total,
        non_null_count: result.non_null,
        nullable_count: result.total - result.non_null,
        is_empty: result.non_null === 0
      };

      log('INFO', `  ${tableName}.${columnName}: ${result.non_null}/${result.total} non-null rows`);
    }
  }

  return analysis;
}

function main() {
  const { dbPath, dropColumns, noBackup, force } = parseArgs();

  if (!fs.existsSync(dbPath)) {
    log('ERROR', `Database not found at ${dbPath}`);
    process.exit(1);
  }

  log('INFO', `Operating on database: ${dbPath}`);
  log('INFO', `Mode: ${dropColumns ? 'DROP COLUMNS' : 'ANALYZE ONLY'}`);

  // Create backup unless explicitly disabled
  let backupPath = null;
  if (!noBackup) {
    backupPath = backupDatabase(dbPath);
  }

  const db = new Database(dbPath);
  db.pragma('foreign_keys = OFF'); // Disable FK checks during migration

  try {
    // Analyze current usage
    const analysis = analyzeLegacyUsage(db);

    if (!dropColumns) {
      log('INFO', '\n=== Dry Run Complete ===');
      log('INFO', 'No changes made. Run with --drop to actually remove columns.');
      console.log('\nAnalysis Results:');
      console.table(
        Object.entries(analysis).flatMap(([table, cols]) =>
          Object.entries(cols).map(([col, info]) => ({
            Table: table,
            Column: col,
            Exists: info.exists,
            'Non-Null Rows': info.non_null_count || 0,
            'Can Drop': info.is_empty ? '✅ Yes' : '⚠️  No (has data)'
          }))
        )
      );
      return;
    }

    // Drop columns mode
    log('WARNING', '=== Starting Column Removal ===');

    const results = {
      success: [],
      failed: [],
      skipped: []
    };

    for (const [tableName, columns] of Object.entries(LEGACY_COLUMNS)) {
      for (const columnName of columns) {
        const colAnalysis = analysis[tableName][columnName];

        if (!colAnalysis.exists) {
          results.skipped.push(`${tableName}.${columnName} (does not exist)`);
          continue;
        }

        if (!colAnalysis.is_empty && !force) {
          log('WARNING', `Skipping ${tableName}.${columnName} - contains ${colAnalysis.non_null_count} non-null rows (use --force to drop anyway)`);
          results.skipped.push(`${tableName}.${columnName} (contains data)`);
          continue;
        }

        if (!colAnalysis.is_empty && force) {
          log('WARNING', `Force-dropping ${tableName}.${columnName} with ${colAnalysis.non_null_count} non-null rows`);
        }

        if (dropLegacyColumn(db, tableName, columnName)) {
          results.success.push(`${tableName}.${columnName}`);
        } else {
          results.failed.push(`${tableName}.${columnName}`);
        }
      }
    }

    // Summary
    log('INFO', '\n=== Migration Complete ===');
    log('SUCCESS', `Dropped ${results.success.length} columns`);
    log('WARNING', `Skipped ${results.skipped.length} columns`);
    log('ERROR', `Failed ${results.failed.length} columns`);

    if (results.success.length > 0) {
      console.log('\nDropped columns:', results.success);
    }
    if (results.skipped.length > 0) {
      console.log('\nSkipped columns:', results.skipped);
    }
    if (results.failed.length > 0) {
      console.log('\nFailed columns:', results.failed);
    }

    if (backupPath) {
      log('INFO', `\nBackup available at: ${backupPath}`);
    }

  } catch (error) {
    log('ERROR', `Migration failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    db.pragma('foreign_keys = ON');
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

module.exports = { main, analyzeLegacyUsage, dropLegacyColumn };
