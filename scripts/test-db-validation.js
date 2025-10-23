#!/usr/bin/env node
/**
 * Database Validation Script for ShekelSync
 * Tests database integrity, table structure, and data counts
 */

const path = require('path');
const Database = require('../app/node_modules/better-sqlite3/lib');

const DB_PATH = path.join(__dirname, 'dist', 'clarify.sqlite');

console.log('========================================');
console.log('ShekelSync Database Validation Report');
console.log('========================================\n');

try {
  // Open database
  const db = new Database(DB_PATH, { readonly: true });
  console.log(`✅ Database opened successfully: ${DB_PATH}\n`);

  // Test 1: List all tables
  console.log('--- Tables ---');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    ORDER BY name
  `).all();

  tables.forEach(t => console.log(`  - ${t.name}`));
  console.log(`Total tables: ${tables.length}\n`);

  // Test 2: Check table row counts
  console.log('--- Row Counts ---');
  const tableCounts = {};
  tables.forEach(t => {
    if (t.name !== 'sqlite_sequence') {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${t.name}`).get();
      tableCounts[t.name] = count.count;
      console.log(`  ${t.name}: ${count.count} rows`);
    }
  });
  console.log();

  // Test 3: Transactions table details
  if (tableCounts.transactions) {
    console.log('--- Transactions Analysis ---');
    const transactionStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT vendor) as unique_vendors,
        COUNT(DISTINCT category) as unique_categories,
        MIN(processed_date) as earliest_date,
        MAX(processed_date) as latest_date,
        SUM(CASE WHEN price < 0 THEN 1 ELSE 0 END) as expenses_count,
        SUM(CASE WHEN price > 0 THEN 1 ELSE 0 END) as income_count,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses,
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income
      FROM transactions
    `).get();

    console.log(`  Total transactions: ${transactionStats.total}`);
    console.log(`  Unique vendors: ${transactionStats.unique_vendors}`);
    console.log(`  Unique categories: ${transactionStats.unique_categories}`);
    console.log(`  Date range: ${transactionStats.earliest_date} to ${transactionStats.latest_date}`);
    console.log(`  Expenses: ${transactionStats.expenses_count} transactions, ${transactionStats.total_expenses.toFixed(2)} ILS`);
    console.log(`  Income: ${transactionStats.income_count} transactions, ${transactionStats.total_income.toFixed(2)} ILS`);
    console.log();
  }

  // Test 4: Categories breakdown
  if (tableCounts.transactions) {
    console.log('--- Top 10 Categories by Transaction Count ---');
    const topCategories = db.prepare(`
      SELECT
        category,
        COUNT(*) as count,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_spent
      FROM transactions
      WHERE category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY count DESC
      LIMIT 10
    `).all();

    topCategories.forEach(c => {
      console.log(`  ${c.category}: ${c.count} transactions (${c.total_spent.toFixed(2)} ILS spent)`);
    });
    console.log();
  }

  // Test 5: Indexes
  console.log('--- Indexes on transactions table ---');
  const indexes = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type='index'
    AND tbl_name='transactions'
    ORDER BY name
  `).all();

  console.log(`Total indexes: ${indexes.length}`);
  indexes.forEach(idx => {
    if (idx.sql) {
      console.log(`  - ${idx.name}`);
    }
  });
  console.log();

  // Test 6: Vendor credentials (without exposing sensitive data)
  if (tableCounts.vendor_credentials) {
    console.log('--- Vendor Credentials ---');
    const credentials = db.prepare(`
      SELECT vendor, nickname, last_scrape_status, last_scrape_success, current_balance, created_at
      FROM vendor_credentials
      ORDER BY created_at DESC
    `).all();

    credentials.forEach(c => {
      const status = c.last_scrape_status || 'never';
      const balance = c.current_balance ? `${c.current_balance.toFixed(2)} ILS` : 'N/A';
      console.log(`  - ${c.vendor} (${c.nickname || 'no nickname'}) - Status: ${status}, Balance: ${balance}`);
    });
    console.log();
  }

  // Test 7: Categorization rules
  if (tableCounts.categorization_rules) {
    console.log('--- Categorization Rules ---');
    const rules = db.prepare(`
      SELECT name_pattern, target_category, is_active, priority
      FROM categorization_rules
      WHERE is_active = 1
      ORDER BY priority DESC
    `).all();

    console.log(`Total active rules: ${rules.length}`);
    rules.slice(0, 10).forEach(r => {
      console.log(`  - "${r.name_pattern}" → ${r.target_category} (priority: ${r.priority || 0})`);
    });
    if (rules.length > 10) {
      console.log(`  ... and ${rules.length - 10} more rules`);
    }
    console.log();
  }

  // Test 8: Scrape events
  if (tableCounts.scrape_events) {
    console.log('--- Recent Scrape Events (last 5) ---');
    const events = db.prepare(`
      SELECT vendor, status, message, created_at
      FROM scrape_events
      ORDER BY created_at DESC
      LIMIT 5
    `).all();

    events.forEach(e => {
      console.log(`  - ${e.created_at}: ${e.vendor} - ${e.status} (${e.message || 'no message'})`);
    });
    console.log();
  }

  // Test 9: Database integrity check
  console.log('--- Database Integrity ---');
  const integrityCheck = db.pragma('integrity_check');
  if (integrityCheck[0] === 'ok' || (typeof integrityCheck[0] === 'object' && integrityCheck[0].integrity_check === 'ok')) {
    console.log('  ✅ Database integrity check: PASSED');
  } else {
    console.log('  ❌ Database integrity check: FAILED');
    console.log(integrityCheck);
  }

  // Test 10: Check pragma settings
  console.log('\n--- Database Settings ---');
  const journalMode = db.pragma('journal_mode', { simple: true });
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  console.log(`  Journal mode: ${journalMode}`);
  console.log(`  Foreign keys: ${foreignKeys ? 'ON' : 'OFF'}`);

  // Close database
  db.close();
  console.log('\n✅ Database closed successfully');

  console.log('\n========================================');
  console.log('Validation Complete!');
  console.log('========================================\n');

  // Exit with success
  process.exit(0);

} catch (error) {
  console.error('\n❌ Error during validation:', error.message);
  console.error(error.stack);
  process.exit(1);
}
