#!/usr/bin/env node
/**
 * Diagnose trigger issues in the database
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');

const {
  isSqlCipherEnabled,
  resolveSqlCipherKey,
  formatKeyClause,
} = require(path.join(PROJECT_ROOT, 'app', 'lib', 'sqlcipher-utils.js'));

const useSqlCipher = isSqlCipherEnabled();
const defaultDbPath = useSqlCipher
  ? (process.env.SQLCIPHER_DB_PATH || path.join(PROJECT_ROOT, 'dist', 'clarify.sqlcipher'))
  : (process.env.SQLITE_DB_PATH || path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite'));

const dbPath = process.argv[2] || defaultDbPath;

console.log('Diagnosing database triggers...');
console.log('Database path:', dbPath);
console.log('SQLCipher enabled:', useSqlCipher);
console.log('');

const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));
const db = new Database(dbPath);

if (useSqlCipher) {
  const keyInfo = resolveSqlCipherKey({ requireKey: true });
  db.pragma(formatKeyClause(keyInfo));
}

// Get all triggers
console.log('=== ALL TRIGGERS ===');
const triggers = db.prepare(`
  SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'
`).all();

for (const trigger of triggers) {
  console.log(`\nTrigger: ${trigger.name}`);
  console.log(`On table: ${trigger.tbl_name}`);
  console.log('SQL:');
  console.log(trigger.sql);
  console.log('---');
}

// Check for references to old table
console.log('\n=== REFERENCES TO smart_action_items_old ===');
const oldRefs = db.prepare(`
  SELECT name, type, sql FROM sqlite_master
  WHERE sql LIKE '%smart_action_items_old%'
`).all();

if (oldRefs.length === 0) {
  console.log('No references found in sqlite_master');
} else {
  for (const ref of oldRefs) {
    console.log(`\n${ref.type}: ${ref.name}`);
    console.log('SQL:', ref.sql);
  }
}

// Check smart_action_items table
console.log('\n=== smart_action_items TABLE ===');
const tableInfo = db.prepare(`
  SELECT * FROM sqlite_master WHERE type = 'table' AND name = 'smart_action_items'
`).get();

if (tableInfo) {
  console.log('Table exists');
  console.log('SQL:', tableInfo.sql);
} else {
  console.log('Table does NOT exist!');
}

// Check action_item_history table
console.log('\n=== action_item_history TABLE ===');
const historyInfo = db.prepare(`
  SELECT * FROM sqlite_master WHERE type = 'table' AND name = 'action_item_history'
`).get();

if (historyInfo) {
  console.log('Table exists');
  console.log('SQL:', historyInfo.sql);
} else {
  console.log('Table does NOT exist!');
}

// Check if smart_action_items_old table exists
console.log('\n=== smart_action_items_old TABLE ===');
const oldTableInfo = db.prepare(`
  SELECT * FROM sqlite_master WHERE type = 'table' AND name = 'smart_action_items_old'
`).get();

if (oldTableInfo) {
  console.log('OLD TABLE STILL EXISTS!');
  console.log('SQL:', oldTableInfo.sql);
} else {
  console.log('Table does NOT exist (expected)');
}

// Check all views too
console.log('\n=== VIEWS REFERENCING smart_action_items ===');
const views = db.prepare(`
  SELECT name, sql FROM sqlite_master
  WHERE type = 'view' AND sql LIKE '%smart_action_items%'
`).all();

if (views.length === 0) {
  console.log('No views found');
} else {
  for (const view of views) {
    console.log(`\nView: ${view.name}`);
    console.log('SQL:', view.sql);
  }
}

db.close();
console.log('\nDiagnosis complete.');
