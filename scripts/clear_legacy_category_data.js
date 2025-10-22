#!/usr/bin/env node
/**
 * Clear Legacy Category Data
 *
 * This script NULLs out the legacy category columns before dropping them.
 * This is safe because all APIs now use category_definition_id.
 *
 * Usage:
 *   node scripts/clear_legacy_category_data.js [--db path/to/db.sqlite]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = DEFAULT_DB_PATH;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--db' || arg === '-d') {
      dbPath = path.resolve(PROJECT_ROOT, args[i + 1]);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Clear Legacy Category Data

Usage:
  node scripts/clear_legacy_category_data.js [--db <path>]

Options:
  --db <path>   Path to SQLite database (default: dist/clarify.sqlite)
  -h, --help    Show this help message

This script sets all legacy category columns to NULL, preparing them for removal.
It's safe to run because all APIs now use category_definition_id.
`);
      process.exit(0);
    }
  }

  return { dbPath };
}

function backupDatabase(dbPath) {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backupPath = `${dbPath}.bak-${timestamp}`;
  fs.copyFileSync(dbPath, backupPath);
  log('INFO', `Created backup at ${backupPath}`);
  return backupPath;
}

function main() {
  const { dbPath } = parseArgs();

  if (!fs.existsSync(dbPath)) {
    log('ERROR', `Database not found at ${dbPath}`);
    process.exit(1);
  }

  log('INFO', `Operating on database: ${dbPath}`);

  // Create backup
  const backupPath = backupDatabase(dbPath);

  const db = new Database(dbPath);

  try {
    log('INFO', '=== Clearing Legacy Category Data ===');

    // Start transaction
    db.exec('BEGIN TRANSACTION');

    // Clear transactions table legacy columns
    log('INFO', 'Clearing transactions.category...');
    const txnCat = db.prepare('UPDATE transactions SET category = NULL WHERE category IS NOT NULL').run();
    log('SUCCESS', `Cleared ${txnCat.changes} rows in transactions.category`);

    log('INFO', 'Clearing transactions.parent_category...');
    const txnParent = db.prepare('UPDATE transactions SET parent_category = NULL WHERE parent_category IS NOT NULL').run();
    log('SUCCESS', `Cleared ${txnParent.changes} rows in transactions.parent_category`);

    log('INFO', 'Clearing transactions.subcategory...');
    const txnSub = db.prepare('UPDATE transactions SET subcategory = NULL WHERE subcategory IS NOT NULL').run();
    log('SUCCESS', `Cleared ${txnSub.changes} rows in transactions.subcategory`);

    // Clear categorization_rules table legacy columns
    log('INFO', 'Clearing categorization_rules.target_category...');
    const ruleTarget = db.prepare('UPDATE categorization_rules SET target_category = NULL WHERE target_category IS NOT NULL').run();
    log('SUCCESS', `Cleared ${ruleTarget.changes} rows in categorization_rules.target_category`);

    log('INFO', 'Clearing categorization_rules.parent_category...');
    const ruleParent = db.prepare('UPDATE categorization_rules SET parent_category = NULL WHERE parent_category IS NOT NULL').run();
    log('SUCCESS', `Cleared ${ruleParent.changes} rows in categorization_rules.parent_category`);

    log('INFO', 'Clearing categorization_rules.subcategory...');
    const ruleSub = db.prepare('UPDATE categorization_rules SET subcategory = NULL WHERE subcategory IS NOT NULL').run();
    log('SUCCESS', `Cleared ${ruleSub.changes} rows in categorization_rules.subcategory`);

    // Commit transaction
    db.exec('COMMIT');

    log('SUCCESS', '\n=== Legacy Data Cleared Successfully ===');
    log('INFO', `Backup available at: ${backupPath}`);
    log('INFO', '\nNext step: Run deprecate_legacy_category_columns.js --drop');

  } catch (error) {
    db.exec('ROLLBACK');
    log('ERROR', `Failed to clear legacy data: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
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

module.exports = { main };
