#!/usr/bin/env node

/**
 * Add performance indexes to existing database
 * These indexes optimize common query patterns used throughout the application
 *
 * Usage: node scripts/add-performance-indexes.js [--db-path path/to/db.sqlite]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATH = process.env.SQLITE_DB_PATH || path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

// Parse command line arguments
const args = process.argv.slice(2);
let dbPath = DEFAULT_DB_PATH;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db-path' && i + 1 < args.length) {
    dbPath = path.resolve(args[i + 1]);
    i++;
  }
}

if (!fs.existsSync(dbPath)) {
  console.error(`❌ Database not found at: ${dbPath}`);
  process.exit(1);
}

// Load better-sqlite3
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const ROOT_NODE_MODULES = path.join(PROJECT_ROOT, 'node_modules');
const baseNodeModules = fs.existsSync(APP_NODE_MODULES)
  ? APP_NODE_MODULES
  : ROOT_NODE_MODULES;
const Database = require(path.join(baseNodeModules, 'better-sqlite3'));

const db = new Database(dbPath);

console.log(`📊 Adding performance indexes to: ${dbPath}`);

// Helper to check if index exists
function indexExists(indexName) {
  const result = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
    )
    .get(indexName);
  return !!result;
}

// Helper to create index if it doesn't exist
function createIndexIfNotExists(indexName, sql) {
  if (indexExists(indexName)) {
    console.log(`  ⏭️  Index ${indexName} already exists, skipping`);
    return false;
  }

  try {
    db.exec(sql);
    console.log(`  ✅ Created index: ${indexName}`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to create index ${indexName}:`, error.message);
    return false;
  }
}

let createdCount = 0;

console.log('\n📈 Transactions table indexes:');

// Transactions - date queries (dashboard, analytics)
if (createIndexIfNotExists('idx_transactions_date',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC)'
)) createdCount++;

// Transactions - account lookups
if (createIndexIfNotExists('idx_transactions_account_id',
  'CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id)'
)) createdCount++;

// Transactions - category filtering (breakdown, analytics)
if (createIndexIfNotExists('idx_transactions_category',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_definition_id)'
)) createdCount++;

// Transactions - date + account composite (common filter combination)
if (createIndexIfNotExists('idx_transactions_date_account',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_account ON transactions(date DESC, account_id)'
)) createdCount++;

// Transactions - date + category composite (category trends over time)
if (createIndexIfNotExists('idx_transactions_date_category',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_category ON transactions(date DESC, category_definition_id)'
)) createdCount++;

// Transactions - transaction type filtering
if (createIndexIfNotExists('idx_transactions_type',
  'CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type)'
)) createdCount++;

// Transactions - vendor + date + category composite (common filter combination for analytics)
if (createIndexIfNotExists('idx_transactions_vendor_date_category',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor_date_category ON transactions(vendor, date DESC, category_definition_id)'
)) createdCount++;

// Transactions - status + date + vendor composite (filtering pending/completed)
if (createIndexIfNotExists('idx_transactions_status_date_vendor',
  'CREATE INDEX IF NOT EXISTS idx_transactions_status_date_vendor ON transactions(status, date DESC, vendor)'
)) createdCount++;

// Transactions - partial index for active/completed transactions only (most common queries)
if (createIndexIfNotExists('idx_transactions_active_date',
  `CREATE INDEX IF NOT EXISTS idx_transactions_active_date ON transactions(date DESC) WHERE status = 'completed'`
)) createdCount++;

// Transactions - category type + date composite (expense/income filtering)
if (createIndexIfNotExists('idx_transactions_cattype_date',
  'CREATE INDEX IF NOT EXISTS idx_transactions_cattype_date ON transactions(category_type, date DESC)'
)) createdCount++;

console.log('\n🏦 Accounts table indexes:');

// Accounts - institution lookups
if (createIndexIfNotExists('idx_accounts_institution',
  'CREATE INDEX IF NOT EXISTS idx_accounts_institution ON accounts(institution_id)'
)) createdCount++;

// Accounts - account type filtering
if (createIndexIfNotExists('idx_accounts_type',
  'CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(account_type)'
)) createdCount++;

console.log('\n💳 Credentials table indexes:');

// Credentials - institution lookups
if (createIndexIfNotExists('idx_credentials_institution',
  'CREATE INDEX IF NOT EXISTS idx_credentials_institution ON credentials(institution_id)'
)) createdCount++;

// Credentials - status filtering (failed sync detection)
if (createIndexIfNotExists('idx_credentials_status',
  'CREATE INDEX IF NOT EXISTS idx_credentials_status ON credentials(status)'
)) createdCount++;

// Credentials - last sync time (stale sync detection)
if (createIndexIfNotExists('idx_credentials_last_sync',
  'CREATE INDEX IF NOT EXISTS idx_credentials_last_sync ON credentials(last_successful_sync_at)'
)) createdCount++;

console.log('\n📊 Investment holdings indexes:');

// Investment holdings - account lookups
if (createIndexIfNotExists('idx_holdings_account',
  'CREATE INDEX IF NOT EXISTS idx_holdings_account ON investment_holdings(account_id)'
)) createdCount++;

// Investment holdings - date for historical tracking
if (createIndexIfNotExists('idx_holdings_date',
  'CREATE INDEX IF NOT EXISTS idx_holdings_date ON investment_holdings(as_of_date DESC)'
)) createdCount++;

// Investment holdings - composite for portfolio timeline
if (createIndexIfNotExists('idx_holdings_account_date',
  'CREATE INDEX IF NOT EXISTS idx_holdings_account_date ON investment_holdings(account_id, as_of_date DESC)'
)) createdCount++;

// Investment holdings - account + date + type composite (portfolio queries with type filter)
if (createIndexIfNotExists('idx_holdings_account_date_type',
  'CREATE INDEX IF NOT EXISTS idx_holdings_account_date_type ON investment_holdings(account_id, as_of_date DESC, holding_type)'
)) createdCount++;

// Investment holdings - partial index for active holdings
if (createIndexIfNotExists('idx_holdings_active_account_date',
  `CREATE INDEX IF NOT EXISTS idx_holdings_active_account_date ON investment_holdings(account_id, as_of_date DESC) WHERE status = 'active'`
)) createdCount++;

console.log('\n🏷️  Category definitions indexes:');

// Category definitions - parent category lookups (hierarchy queries)
if (createIndexIfNotExists('idx_categories_parent',
  'CREATE INDEX IF NOT EXISTS idx_categories_parent ON category_definitions(parent_id)'
)) createdCount++;

// Category definitions - type filtering
if (createIndexIfNotExists('idx_categories_type',
  'CREATE INDEX IF NOT EXISTS idx_categories_type ON category_definitions(type)'
)) createdCount++;

console.log('\n💰 Budgets table indexes:');

// Budgets - category lookups
if (createIndexIfNotExists('idx_budgets_category',
  'CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category_definition_id)'
)) createdCount++;

// Budgets - period filtering
if (createIndexIfNotExists('idx_budgets_period',
  'CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period_start, period_end)'
)) createdCount++;

console.log('\n🔔 Notifications table indexes:');

// Notifications - read status filtering
if (createIndexIfNotExists('idx_notifications_read',
  'CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)'
)) createdCount++;

// Notifications - created date for chronological display
if (createIndexIfNotExists('idx_notifications_created',
  'CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)'
)) createdCount++;

console.log('\n🔍 Account pairings indexes:');

// Account pairings - account lookups
if (createIndexIfNotExists('idx_pairings_primary',
  'CREATE INDEX IF NOT EXISTS idx_pairings_primary ON account_pairings(primary_account_id)'
)) createdCount++;

if (createIndexIfNotExists('idx_pairings_paired',
  'CREATE INDEX IF NOT EXISTS idx_pairings_paired ON account_pairings(paired_account_id)'
)) createdCount++;

console.log('\n📝 Conversation messages indexes:');

// Conversation messages - conversation lookups
if (createIndexIfNotExists('idx_messages_conversation',
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id)'
)) createdCount++;

// Conversation messages - timestamp ordering
if (createIndexIfNotExists('idx_messages_timestamp',
  'CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON conversation_messages(timestamp DESC)'
)) createdCount++;

console.log('\n═════════════════════════════════════════');
console.log(`✅ Index creation complete!`);
console.log(`   Created: ${createdCount} new indexes`);
console.log(`   Skipped: ${24 - createdCount} existing indexes`);
console.log('═════════════════════════════════════════\n');

// Analyze tables for query planner optimization
console.log('🔍 Running ANALYZE to update query planner statistics...');
db.exec('ANALYZE');
console.log('✅ ANALYZE complete\n');

// Show database size
const stats = fs.statSync(dbPath);
const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
console.log(`📊 Database size: ${sizeMB} MB`);

db.close();
console.log('\n✅ All done! Your database is now optimized.\n');
