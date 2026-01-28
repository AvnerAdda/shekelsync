#!/usr/bin/env node
/**
 * Seed realistic demo data matching real DB structure
 * This script creates a complete demo database with:
 * - All missing tables (chat, subscriptions, savings_goals, license, etc.)
 * - FTS5 full-text search tables and triggers
 * - Performance indexes
 * - Realistic transactions, scrape events, account pairings
 * - Sample data for new features
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', 'app', 'node_modules', 'better-sqlite3'));
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'dist', 'clarify-anonymized.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log(`\n🗄️  Seeding database: ${DB_PATH}\n`);

// ============================================
// STEP 0: CLEANUP EXISTING DEMO DATA
// ============================================
console.log('🧹 Cleaning up existing demo data...');

// Delete demo transactions (those with 'demo-' or 'txn_new_' prefix from seed scripts)
db.exec("DELETE FROM transactions WHERE identifier LIKE 'demo-%' OR identifier LIKE 'txn_new_%'");

// Clear tables that we fully control (will be recreated)
const TABLES_TO_CLEAR = [
  'savings_goal_contributions',
  'savings_goals',
  'subscription_alerts',
  'subscription_history',
  'subscriptions',
  'chat_messages',
  'chat_conversations',
  'scrape_events',
  'account_pairings',
  'category_budgets',
  'investment_holdings',
  'investment_accounts',
  'vendor_credentials',
  'license',
];

TABLES_TO_CLEAR.forEach((table) => {
  try {
    db.exec(`DELETE FROM ${table}`);
  } catch (e) {
    // Table might not exist yet
  }
});

console.log('  Cleaned up demo data');

// ============================================
// STEP 1: CREATE MISSING TABLES
// ============================================
console.log('📋 Creating missing tables...');

const MISSING_TABLES = [
  // License table
  `CREATE TABLE IF NOT EXISTS license (
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
  )`,

  // Chat Conversations Table
  `CREATE TABLE IF NOT EXISTS chat_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    total_tokens_used INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    metadata TEXT
  )`,

  // Chat Messages Table
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_call_id TEXT,
    tokens_used INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT,
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
  )`,

  // Subscriptions table
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
  )`,

  // Subscription history table
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
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
  )`,

  // Subscription alerts table
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
  )`,

  // Savings goals table
  `CREATE TABLE IF NOT EXISTS savings_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    target_amount REAL NOT NULL CHECK (target_amount > 0),
    current_amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'ILS',
    target_date TEXT,
    start_date TEXT NOT NULL DEFAULT (date('now')),
    category_definition_id INTEGER,
    icon TEXT DEFAULT 'savings',
    color TEXT DEFAULT '#4CAF50',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 0,
    is_recurring INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0, 1)),
    recurring_amount REAL,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
  )`,

  // Savings goal contributions table
  `CREATE TABLE IF NOT EXISTS savings_goal_contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    contribution_type TEXT NOT NULL DEFAULT 'manual' CHECK (contribution_type IN ('manual', 'auto', 'interest', 'adjustment')),
    transaction_identifier TEXT,
    transaction_vendor TEXT,
    note TEXT,
    date TEXT NOT NULL DEFAULT (date('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (goal_id) REFERENCES savings_goals(id) ON DELETE CASCADE
  )`,

  // Transaction pairing exclusions table
  `CREATE TABLE IF NOT EXISTS transaction_pairing_exclusions (
    transaction_identifier TEXT NOT NULL,
    transaction_vendor TEXT NOT NULL,
    pairing_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (transaction_identifier, transaction_vendor, pairing_id),
    FOREIGN KEY (transaction_identifier, transaction_vendor)
      REFERENCES transactions(identifier, vendor)
      ON DELETE CASCADE,
    FOREIGN KEY (pairing_id) REFERENCES account_pairings(id) ON DELETE CASCADE
  )`,
];

MISSING_TABLES.forEach((sql) => {
  try {
    db.exec(sql);
  } catch (e) {
    // Table might already exist
  }
});

// Add discrepancy_acknowledged column if missing
try {
  db.exec('ALTER TABLE account_pairings ADD COLUMN discrepancy_acknowledged INTEGER DEFAULT 0');
} catch (e) {
  // Column already exists
}

console.log('  Created 9 missing tables');

// ============================================
// STEP 2: CREATE FTS5 TABLES AND TRIGGERS
// ============================================
console.log('📋 Creating FTS5 tables and triggers...');

const FTS5_STATEMENTS = [
  // Transactions FTS
  `CREATE VIRTUAL TABLE IF NOT EXISTS transactions_fts USING fts5(
    name, memo, vendor, merchant_name,
    tokenize='unicode61 remove_diacritics 2'
  )`,

  // Categorization rules FTS
  `CREATE VIRTUAL TABLE IF NOT EXISTS categorization_rules_fts USING fts5(
    name_pattern,
    tokenize='unicode61 remove_diacritics 2'
  )`,

  // Category definitions FTS
  `CREATE VIRTUAL TABLE IF NOT EXISTS category_definitions_fts USING fts5(
    name, name_en, name_fr,
    tokenize='unicode61 remove_diacritics 2'
  )`,
];

FTS5_STATEMENTS.forEach((sql) => {
  try {
    db.exec(sql);
  } catch (e) {
    // Table might already exist
  }
});

// Create FTS triggers
const FTS_TRIGGERS = [
  // Transactions FTS triggers
  `DROP TRIGGER IF EXISTS transactions_fts_insert`,
  `CREATE TRIGGER transactions_fts_insert AFTER INSERT ON transactions BEGIN
    INSERT INTO transactions_fts(rowid, name, memo, vendor, merchant_name)
    VALUES (NEW.rowid, NEW.name, NEW.memo, NEW.vendor, NEW.merchant_name);
  END`,
  `DROP TRIGGER IF EXISTS transactions_fts_delete`,
  `CREATE TRIGGER transactions_fts_delete AFTER DELETE ON transactions BEGIN
    DELETE FROM transactions_fts WHERE rowid = OLD.rowid;
  END`,
  `DROP TRIGGER IF EXISTS transactions_fts_update`,
  `CREATE TRIGGER transactions_fts_update AFTER UPDATE ON transactions BEGIN
    DELETE FROM transactions_fts WHERE rowid = OLD.rowid;
    INSERT INTO transactions_fts(rowid, name, memo, vendor, merchant_name)
    VALUES (NEW.rowid, NEW.name, NEW.memo, NEW.vendor, NEW.merchant_name);
  END`,

  // Categorization rules FTS triggers
  `DROP TRIGGER IF EXISTS categorization_rules_fts_insert`,
  `CREATE TRIGGER categorization_rules_fts_insert AFTER INSERT ON categorization_rules BEGIN
    INSERT INTO categorization_rules_fts(rowid, name_pattern) VALUES (NEW.id, NEW.name_pattern);
  END`,
  `DROP TRIGGER IF EXISTS categorization_rules_fts_delete`,
  `CREATE TRIGGER categorization_rules_fts_delete AFTER DELETE ON categorization_rules BEGIN
    DELETE FROM categorization_rules_fts WHERE rowid = OLD.id;
  END`,
  `DROP TRIGGER IF EXISTS categorization_rules_fts_update`,
  `CREATE TRIGGER categorization_rules_fts_update AFTER UPDATE ON categorization_rules BEGIN
    DELETE FROM categorization_rules_fts WHERE rowid = OLD.id;
    INSERT INTO categorization_rules_fts(rowid, name_pattern) VALUES (NEW.id, NEW.name_pattern);
  END`,

  // Category definitions FTS triggers
  `DROP TRIGGER IF EXISTS category_definitions_fts_insert`,
  `CREATE TRIGGER category_definitions_fts_insert AFTER INSERT ON category_definitions BEGIN
    INSERT INTO category_definitions_fts(rowid, name, name_en, name_fr) VALUES (NEW.id, NEW.name, NEW.name_en, NEW.name_fr);
  END`,
  `DROP TRIGGER IF EXISTS category_definitions_fts_delete`,
  `CREATE TRIGGER category_definitions_fts_delete AFTER DELETE ON category_definitions BEGIN
    DELETE FROM category_definitions_fts WHERE rowid = OLD.id;
  END`,
  `DROP TRIGGER IF EXISTS category_definitions_fts_update`,
  `CREATE TRIGGER category_definitions_fts_update AFTER UPDATE ON category_definitions BEGIN
    DELETE FROM category_definitions_fts WHERE rowid = OLD.id;
    INSERT INTO category_definitions_fts(rowid, name, name_en, name_fr) VALUES (NEW.id, NEW.name, NEW.name_en, NEW.name_fr);
  END`,
];

FTS_TRIGGERS.forEach((sql) => {
  try {
    db.exec(sql);
  } catch (e) {
    console.error('  FTS trigger error:', e.message);
  }
});

console.log('  Created 3 FTS5 tables and 9 triggers');

// ============================================
// STEP 3: ADD PERFORMANCE INDEXES
// ============================================
console.log('📋 Adding performance indexes...');

const INDEXES = [
  // Transaction indexes
  'CREATE INDEX IF NOT EXISTS idx_transactions_processed_date ON transactions (processed_date)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_status_date ON transactions (status, date)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_definition_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_category ON transactions(date DESC, category_definition_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor_date_category ON transactions(vendor, date DESC, category_definition_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_status_date_vendor ON transactions(status, date DESC, vendor)',
  "CREATE INDEX IF NOT EXISTS idx_transactions_active_date ON transactions(date DESC) WHERE status = 'completed'",
  'CREATE INDEX IF NOT EXISTS idx_transactions_cattype_date ON transactions(category_type, date DESC)',

  // Subscription indexes
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)',
  'CREATE INDEX IF NOT EXISTS idx_subscriptions_pattern_key ON subscriptions(pattern_key)',
  'CREATE INDEX IF NOT EXISTS idx_subscription_history_subscription_id ON subscription_history(subscription_id)',
  'CREATE INDEX IF NOT EXISTS idx_subscription_alerts_subscription_id ON subscription_alerts(subscription_id)',
  'CREATE INDEX IF NOT EXISTS idx_subscription_alerts_dismissed ON subscription_alerts(is_dismissed)',

  // Savings goals indexes
  'CREATE INDEX IF NOT EXISTS idx_savings_goals_status ON savings_goals(status)',
  'CREATE INDEX IF NOT EXISTS idx_savings_goals_target_date ON savings_goals(target_date)',
  'CREATE INDEX IF NOT EXISTS idx_savings_goals_priority ON savings_goals(priority DESC)',
  'CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal_id ON savings_goal_contributions(goal_id)',
  'CREATE INDEX IF NOT EXISTS idx_goal_contributions_date ON savings_goal_contributions(date DESC)',

  // Chat indexes
  'CREATE INDEX IF NOT EXISTS idx_chat_conversations_external_id ON chat_conversations(external_id)',
  'CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at)',

  // Pairing exclusions index
  'CREATE INDEX IF NOT EXISTS idx_pairing_exclusions_pairing_id ON transaction_pairing_exclusions(pairing_id)',
];

INDEXES.forEach((sql) => {
  try {
    db.exec(sql);
  } catch (e) {
    // Index might already exist
  }
});

console.log(`  Added ${INDEXES.length} indexes`);

// ============================================
// STEP 4: SEED VENDOR CREDENTIALS
// ============================================
console.log('📋 Seeding vendor credentials...');

const DEMO_CREDENTIALS = [
  { vendor: 'max', nickname: 'Max - כרטיס ראשי', username: 'demo_max', institution_id: null },
  { vendor: 'visaCal', nickname: 'Cal - כרטיס משני', username: 'demo_cal', institution_id: null },
  { vendor: 'discount', nickname: 'דיסקונט - עו"ש', username: 'demo_discount', bank_account_number: '0123456789', institution_id: null },
];

const insertCredential = db.prepare(`
  INSERT OR IGNORE INTO vendor_credentials (vendor, nickname, username, bank_account_number, institution_id, last_scrape_status)
  VALUES (@vendor, @nickname, @username, @bankAccount, @institutionId, 'success')
`);

DEMO_CREDENTIALS.forEach((cred) => {
  insertCredential.run({
    vendor: cred.vendor,
    nickname: cred.nickname,
    username: cred.username,
    bankAccount: cred.bank_account_number || null,
    institutionId: cred.institution_id,
  });
});
console.log(`  Inserted ${DEMO_CREDENTIALS.length} vendor credentials`);

// ============================================
// STEP 5: SEED SCRAPE EVENTS
// ============================================
console.log('📋 Seeding scrape events...');

const insertScrapeEvent = db.prepare(`
  INSERT INTO scrape_events (triggered_by, vendor, start_date, status, message, created_at, credential_id)
  VALUES (@triggeredBy, @vendor, @startDate, @status, @message, @createdAt, @credentialId)
`);

const SCRAPE_EVENTS = [
  // Discount scrapes
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2025-09-01', status: 'success', message: 'Scraped 45 transactions', createdAt: '2025-09-05T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2025-09-15', status: 'success', message: 'Scraped 38 transactions', createdAt: '2025-09-15T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'manual', vendor: 'discount', startDate: '2025-09-20', status: 'success', message: 'Scraped 12 transactions', createdAt: '2025-09-20T14:30:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2025-10-01', status: 'success', message: 'Scraped 52 transactions', createdAt: '2025-10-01T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2025-10-15', status: 'success', message: 'Scraped 41 transactions', createdAt: '2025-10-15T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2025-11-01', status: 'success', message: 'Scraped 47 transactions', createdAt: '2025-11-01T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'manual', vendor: 'discount', startDate: '2025-11-10', status: 'failed', message: 'Connection timeout', createdAt: '2025-11-10T10:15:00Z', credentialId: 1 },
  { triggeredBy: 'manual', vendor: 'discount', startDate: '2025-11-10', status: 'success', message: 'Scraped 15 transactions', createdAt: '2025-11-10T10:20:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2025-11-15', status: 'success', message: 'Scraped 39 transactions', createdAt: '2025-11-15T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2025-12-01', status: 'success', message: 'Scraped 58 transactions', createdAt: '2025-12-01T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2025-12-15', status: 'success', message: 'Scraped 43 transactions', createdAt: '2025-12-15T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'manual', vendor: 'discount', startDate: '2025-12-20', status: 'success', message: 'Scraped 22 transactions', createdAt: '2025-12-20T16:45:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2026-01-01', status: 'success', message: 'Scraped 61 transactions', createdAt: '2026-01-01T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2026-01-05', status: 'success', message: 'Scraped 35 transactions', createdAt: '2026-01-05T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2026-01-10', status: 'success', message: 'Scraped 28 transactions', createdAt: '2026-01-10T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: '2026-01-15', status: 'success', message: 'Scraped 42 transactions', createdAt: '2026-01-15T08:00:00Z', credentialId: 1 },
  { triggeredBy: 'manual', vendor: 'discount', startDate: '2026-01-20', status: 'success', message: 'Scraped 19 transactions', createdAt: '2026-01-20T11:30:00Z', credentialId: 1 },

  // Max scrapes
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-09-01', status: 'success', message: 'Scraped 28 transactions', createdAt: '2025-09-05T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-09-10', status: 'success', message: 'Scraped 31 transactions', createdAt: '2025-09-10T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-09-20', status: 'success', message: 'Scraped 25 transactions', createdAt: '2025-09-20T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'manual', vendor: 'max', startDate: '2025-09-25', status: 'success', message: 'Scraped 18 transactions', createdAt: '2025-09-25T15:00:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-10-01', status: 'success', message: 'Scraped 34 transactions', createdAt: '2025-10-01T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-10-10', status: 'success', message: 'Scraped 29 transactions', createdAt: '2025-10-10T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-10-20', status: 'success', message: 'Scraped 27 transactions', createdAt: '2025-10-20T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-11-01', status: 'success', message: 'Scraped 33 transactions', createdAt: '2025-11-01T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-11-10', status: 'failed', message: 'Invalid credentials', createdAt: '2025-11-10T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'manual', vendor: 'max', startDate: '2025-11-10', status: 'success', message: 'Scraped 21 transactions', createdAt: '2025-11-10T09:00:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-11-20', status: 'success', message: 'Scraped 30 transactions', createdAt: '2025-11-20T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-12-01', status: 'success', message: 'Scraped 38 transactions', createdAt: '2025-12-01T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-12-10', status: 'success', message: 'Scraped 35 transactions', createdAt: '2025-12-10T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2025-12-20', status: 'success', message: 'Scraped 42 transactions', createdAt: '2025-12-20T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'manual', vendor: 'max', startDate: '2025-12-25', status: 'success', message: 'Scraped 15 transactions', createdAt: '2025-12-25T12:00:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2026-01-01', status: 'success', message: 'Scraped 45 transactions', createdAt: '2026-01-01T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2026-01-05', status: 'success', message: 'Scraped 32 transactions', createdAt: '2026-01-05T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2026-01-10', status: 'success', message: 'Scraped 28 transactions', createdAt: '2026-01-10T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2026-01-15', status: 'success', message: 'Scraped 36 transactions', createdAt: '2026-01-15T08:30:00Z', credentialId: 2 },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: '2026-01-20', status: 'success', message: 'Scraped 24 transactions', createdAt: '2026-01-20T08:30:00Z', credentialId: 2 },

  // VisaCal scrapes
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2025-09-05', status: 'success', message: 'Scraped 12 transactions', createdAt: '2025-09-05T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2025-09-20', status: 'success', message: 'Scraped 15 transactions', createdAt: '2025-09-20T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2025-10-05', status: 'success', message: 'Scraped 18 transactions', createdAt: '2025-10-05T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2025-10-20', status: 'success', message: 'Scraped 14 transactions', createdAt: '2025-10-20T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2025-11-05', status: 'success', message: 'Scraped 16 transactions', createdAt: '2025-11-05T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'manual', vendor: 'visaCal', startDate: '2025-11-15', status: 'failed', message: 'Captcha required', createdAt: '2025-11-15T14:00:00Z', credentialId: 3 },
  { triggeredBy: 'manual', vendor: 'visaCal', startDate: '2025-11-15', status: 'success', message: 'Scraped 8 transactions', createdAt: '2025-11-15T14:15:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2025-12-05', status: 'success', message: 'Scraped 19 transactions', createdAt: '2025-12-05T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2025-12-20', status: 'success', message: 'Scraped 22 transactions', createdAt: '2025-12-20T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2026-01-05', status: 'success', message: 'Scraped 17 transactions', createdAt: '2026-01-05T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2026-01-10', status: 'success', message: 'Scraped 13 transactions', createdAt: '2026-01-10T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2026-01-15', status: 'success', message: 'Scraped 20 transactions', createdAt: '2026-01-15T09:00:00Z', credentialId: 3 },
  { triggeredBy: 'scheduled', vendor: 'visaCal', startDate: '2026-01-20', status: 'success', message: 'Scraped 11 transactions', createdAt: '2026-01-20T09:00:00Z', credentialId: 3 },
];

SCRAPE_EVENTS.forEach((event) => {
  try {
    insertScrapeEvent.run(event);
  } catch (e) {
    // Ignore duplicates
  }
});
console.log(`  Inserted ${SCRAPE_EVENTS.length} scrape events`);

// ============================================
// STEP 6: SEED ACCOUNT PAIRINGS
// ============================================
console.log('📋 Seeding account pairings...');

const insertPairing = db.prepare(`
  INSERT OR IGNORE INTO account_pairings (credit_card_vendor, credit_card_account_number, bank_vendor, bank_account_number, match_patterns, is_active, discrepancy_acknowledged)
  VALUES (@ccVendor, @ccAccount, @bankVendor, @bankAccount, @patterns, @isActive, @acknowledged)
`);

const ACCOUNT_PAIRINGS = [
  { ccVendor: 'max', ccAccount: '1234', bankVendor: 'discount', bankAccount: '0123456789', patterns: '["מקס", "MAX", "כרטיס אשראי"]', isActive: 1, acknowledged: 0 },
  { ccVendor: 'max', ccAccount: '5678', bankVendor: 'discount', bankAccount: '0123456789', patterns: '["מקס", "MAX", "כרטיס אשראי"]', isActive: 1, acknowledged: 0 },
  { ccVendor: 'visaCal', ccAccount: '9012', bankVendor: 'discount', bankAccount: '0123456789', patterns: '["ויזה", "VISA", "כאל", "CAL"]', isActive: 1, acknowledged: 0 },
  { ccVendor: 'max', ccAccount: null, bankVendor: 'discount', bankAccount: '0123456789', patterns: '["מקס", "MAX"]', isActive: 1, acknowledged: 0 },
  { ccVendor: 'visaCal', ccAccount: null, bankVendor: 'discount', bankAccount: '0123456789', patterns: '["ויזה", "כאל"]', isActive: 1, acknowledged: 0 },
  { ccVendor: 'max', ccAccount: '1234', bankVendor: 'discount', bankAccount: null, patterns: '["מקס"]', isActive: 0, acknowledged: 1 },
  { ccVendor: 'visaCal', ccAccount: '9012', bankVendor: 'discount', bankAccount: null, patterns: '["ויזה"]', isActive: 0, acknowledged: 1 },
  { ccVendor: 'max', ccAccount: '5678', bankVendor: 'discount', bankAccount: null, patterns: '["חיוב כרטיס"]', isActive: 1, acknowledged: 0 },
  { ccVendor: 'visaCal', ccAccount: null, bankVendor: 'discount', bankAccount: null, patterns: '["חיוב ויזה"]', isActive: 1, acknowledged: 0 },
];

ACCOUNT_PAIRINGS.forEach((p) => {
  try {
    insertPairing.run(p);
  } catch (e) {
    // Ignore duplicates
  }
});
console.log(`  Inserted ${ACCOUNT_PAIRINGS.length} account pairings`);

// ============================================
// STEP 7: SEED ADDITIONAL CATEGORIZATION RULES
// ============================================
console.log('📋 Seeding additional categorization rules...');

const insertRule = db.prepare(`
  INSERT OR IGNORE INTO categorization_rules (name_pattern, target_category, priority, is_active, category_definition_id, category_type)
  VALUES (@pattern, @category, @priority, 1, @categoryId, 'expense')
`);

const ADDITIONAL_RULES = [
  // Supermarkets (category_definition_id = 3)
  { pattern: 'רמי לוי', category: 'סופרמרקט', priority: 100, categoryId: 3 },
  { pattern: 'שופרסל', category: 'סופרמרקט', priority: 100, categoryId: 3 },
  { pattern: 'יוחננוף', category: 'סופרמרקט', priority: 100, categoryId: 3 },
  { pattern: 'AM:PM', category: 'סופרמרקט', priority: 95, categoryId: 3 },
  { pattern: 'ויקטורי', category: 'סופרמרקט', priority: 100, categoryId: 3 },
  { pattern: 'מחסני השוק', category: 'סופרמרקט', priority: 100, categoryId: 3 },
  { pattern: 'סופר פארם', category: 'סופרמרקט', priority: 90, categoryId: 3 },
  { pattern: 'BE', category: 'סופרמרקט', priority: 80, categoryId: 3 },
  { pattern: 'TIVTAAM', category: 'סופרמרקט', priority: 95, categoryId: 3 },
  { pattern: 'SUPERSOL', category: 'סופרמרקט', priority: 100, categoryId: 3 },

  // Restaurants (category_definition_id = 4)
  { pattern: 'גריל בר', category: 'מסעדות', priority: 90, categoryId: 4 },
  { pattern: 'שיפודי', category: 'מסעדות', priority: 90, categoryId: 4 },
  { pattern: 'פיצה', category: 'מסעדות', priority: 85, categoryId: 4 },
  { pattern: 'סושי', category: 'מסעדות', priority: 85, categoryId: 4 },
  { pattern: 'מוזס', category: 'מסעדות', priority: 90, categoryId: 4 },
  { pattern: 'בורגר', category: 'מסעדות', priority: 85, categoryId: 4 },
  { pattern: 'הבשר של', category: 'מסעדות', priority: 90, categoryId: 4 },
  { pattern: 'MCDONALDS', category: 'מסעדות', priority: 95, categoryId: 4 },
  { pattern: 'KFC', category: 'מסעדות', priority: 95, categoryId: 4 },

  // Coffee (category_definition_id = 5)
  { pattern: 'קפה לנדוור', category: 'קפה ומאפה', priority: 95, categoryId: 5 },
  { pattern: 'ארומה', category: 'קפה ומאפה', priority: 95, categoryId: 5 },
  { pattern: 'קופי בר', category: 'קפה ומאפה', priority: 90, categoryId: 5 },
  { pattern: 'קפה קפה', category: 'קפה ומאפה', priority: 95, categoryId: 5 },
  { pattern: 'נחת', category: 'קפה ומאפה', priority: 85, categoryId: 5 },
  { pattern: 'נאנו בר', category: 'קפה ומאפה', priority: 85, categoryId: 5 },
  { pattern: 'COFIX', category: 'קפה ומאפה', priority: 95, categoryId: 5 },
  { pattern: 'COFFEE', category: 'קפה ומאפה', priority: 75, categoryId: 5 },

  // Delivery (category_definition_id = 6)
  { pattern: 'וולט', category: 'משלוחים', priority: 95, categoryId: 6 },
  { pattern: 'WOLT', category: 'משלוחים', priority: 95, categoryId: 6 },
  { pattern: 'תן ביס', category: 'משלוחים', priority: 95, categoryId: 6 },
  { pattern: 'TENBIS', category: 'משלוחים', priority: 95, categoryId: 6 },
  { pattern: 'DELIVEROO', category: 'משלוחים', priority: 90, categoryId: 6 },

  // Fuel (category_definition_id = 11)
  { pattern: 'דלק', category: 'דלק', priority: 95, categoryId: 11 },
  { pattern: 'פז', category: 'דלק', priority: 95, categoryId: 11 },
  { pattern: 'סונול', category: 'דלק', priority: 95, categoryId: 11 },
  { pattern: 'דור אלון', category: 'דלק', priority: 95, categoryId: 11 },
  { pattern: 'DELEK', category: 'דלק', priority: 95, categoryId: 11 },
  { pattern: 'TEN', category: 'דלק', priority: 85, categoryId: 11 },

  // Public transport (category_definition_id = 12)
  { pattern: 'רב קו', category: 'תחבורה ציבורית', priority: 95, categoryId: 12 },
  { pattern: 'RAV-KAV', category: 'תחבורה ציבורית', priority: 95, categoryId: 12 },
  { pattern: 'רכבת ישראל', category: 'תחבורה ציבורית', priority: 95, categoryId: 12 },
  { pattern: 'ISRAEL RAIL', category: 'תחבורה ציבורית', priority: 95, categoryId: 12 },

  // Parking (category_definition_id = 13)
  { pattern: 'חניון', category: 'חניה', priority: 90, categoryId: 13 },
  { pattern: 'PARKING', category: 'חניה', priority: 85, categoryId: 13 },
  { pattern: 'אחוזות', category: 'חניה', priority: 90, categoryId: 13 },

  // Taxi/Ride (category_definition_id = 14)
  { pattern: 'גט', category: 'מוניות', priority: 95, categoryId: 14 },
  { pattern: 'UBER', category: 'מוניות', priority: 95, categoryId: 14 },
  { pattern: 'GETT', category: 'מוניות', priority: 95, categoryId: 14 },
  { pattern: 'BOLT', category: 'מוניות', priority: 95, categoryId: 14 },
  { pattern: 'YANGO', category: 'מוניות', priority: 95, categoryId: 14 },
];

ADDITIONAL_RULES.forEach((r) => {
  try {
    insertRule.run(r);
  } catch (e) {
    // Ignore duplicates
  }
});
console.log(`  Added ${ADDITIONAL_RULES.length} categorization rules`);

// ============================================
// STEP 8: SEED LICENSE
// ============================================
console.log('📋 Seeding license...');

try {
  db.prepare(`
    INSERT OR REPLACE INTO license (id, unique_id, teudat_zehut, device_hash, installation_date, trial_start_date, license_type, app_version)
    VALUES (1, 'demo-user-12345-67890', '000000000', 'demo-device-hash-abc123', '2025-09-01T10:00:00Z', '2025-09-01T10:00:00Z', 'pro', '1.5.0')
  `).run();
  console.log('  Inserted license record');
} catch (e) {
  console.log('  License already exists');
}

// ============================================
// STEP 9: SEED CHAT CONVERSATIONS
// ============================================
console.log('📋 Seeding chat conversations...');

const insertConversation = db.prepare(`
  INSERT OR IGNORE INTO chat_conversations (external_id, title, created_at, updated_at, last_message_at, message_count, total_tokens_used, is_archived)
  VALUES (@externalId, @title, @createdAt, @updatedAt, @lastMessageAt, @messageCount, @tokensUsed, @isArchived)
`);

const insertMessage = db.prepare(`
  INSERT INTO chat_messages (conversation_id, role, content, tokens_used, created_at)
  VALUES (@conversationId, @role, @content, @tokensUsed, @createdAt)
`);

const CONVERSATIONS = [
  { externalId: 'conv-001', title: 'Monthly spending analysis', createdAt: '2025-11-15T10:00:00Z', updatedAt: '2025-11-15T10:15:00Z', lastMessageAt: '2025-11-15T10:15:00Z', messageCount: 4, tokensUsed: 1250, isArchived: 0 },
  { externalId: 'conv-002', title: 'Budget planning for December', createdAt: '2025-12-01T14:30:00Z', updatedAt: '2025-12-01T14:45:00Z', lastMessageAt: '2025-12-01T14:45:00Z', messageCount: 6, tokensUsed: 2100, isArchived: 0 },
  { externalId: 'conv-003', title: 'Investment portfolio questions', createdAt: '2025-12-10T09:00:00Z', updatedAt: '2025-12-10T09:20:00Z', lastMessageAt: '2025-12-10T09:20:00Z', messageCount: 8, tokensUsed: 3500, isArchived: 1 },
];

CONVERSATIONS.forEach((c) => {
  try {
    insertConversation.run(c);
  } catch (e) {
    // Ignore duplicates
  }
});

const MESSAGES = [
  { conversationId: 1, role: 'user', content: 'How much did I spend on restaurants this month?', tokensUsed: 25, createdAt: '2025-11-15T10:00:00Z' },
  { conversationId: 1, role: 'assistant', content: 'Based on your transactions, you spent 1,245 ILS on restaurants this month. This is 15% higher than last month.', tokensUsed: 180, createdAt: '2025-11-15T10:00:30Z' },
  { conversationId: 1, role: 'user', content: 'What about supermarkets?', tokensUsed: 15, createdAt: '2025-11-15T10:10:00Z' },
  { conversationId: 1, role: 'assistant', content: 'Your supermarket spending this month totals 2,890 ILS. Rami Levy accounts for 45% of that spending.', tokensUsed: 165, createdAt: '2025-11-15T10:10:25Z' },
  { conversationId: 2, role: 'user', content: 'Can you help me plan my December budget?', tokensUsed: 20, createdAt: '2025-12-01T14:30:00Z' },
  { conversationId: 2, role: 'assistant', content: 'Based on your spending patterns, here is a suggested budget for December: Food & Groceries: 4,500 ILS, Transportation: 800 ILS, Entertainment: 1,200 ILS.', tokensUsed: 250, createdAt: '2025-12-01T14:30:45Z' },
  { conversationId: 3, role: 'user', content: 'How is my investment portfolio performing?', tokensUsed: 18, createdAt: '2025-12-10T09:00:00Z' },
  { conversationId: 3, role: 'assistant', content: 'Your portfolio summary: Total Value: 125,000 ILS, Monthly Return: +2.3%, YTD Return: +12.5%.', tokensUsed: 180, createdAt: '2025-12-10T09:00:40Z' },
];

MESSAGES.forEach((m) => {
  try {
    insertMessage.run(m);
  } catch (e) {
    // Ignore duplicates
  }
});
console.log(`  Inserted ${CONVERSATIONS.length} conversations and ${MESSAGES.length} messages`);

// ============================================
// STEP 10: SEED SUBSCRIPTIONS
// ============================================
console.log('📋 Seeding subscriptions...');

const insertSubscription = db.prepare(`
  INSERT OR IGNORE INTO subscriptions (pattern_key, display_name, detected_frequency, detected_amount, amount_is_fixed, consistency_score, status, first_detected_date, last_charge_date, next_expected_date, is_manual)
  VALUES (@patternKey, @displayName, @frequency, @amount, @isFixed, @score, @status, @firstDetected, @lastCharge, @nextExpected, @isManual)
`);

const SUBSCRIPTIONS = [
  { patternKey: 'NETFLIX.COM', displayName: 'Netflix', frequency: 'monthly', amount: 49.90, isFixed: 1, score: 0.98, status: 'active', firstDetected: '2025-09-01', lastCharge: '2025-12-01', nextExpected: '2026-01-01', isManual: 0 },
  { patternKey: 'SPOTIFY', displayName: 'Spotify Premium', frequency: 'monthly', amount: 29.90, isFixed: 1, score: 0.99, status: 'active', firstDetected: '2025-09-01', lastCharge: '2025-12-01', nextExpected: '2026-01-01', isManual: 0 },
  { patternKey: 'APPLE.COM/BILL', displayName: 'Apple iCloud', frequency: 'monthly', amount: 19.90, isFixed: 1, score: 0.97, status: 'active', firstDetected: '2025-09-05', lastCharge: '2025-12-05', nextExpected: '2026-01-05', isManual: 0 },
  { patternKey: 'AMAZON PRIME', displayName: 'Amazon Prime', frequency: 'monthly', amount: 14.90, isFixed: 1, score: 0.95, status: 'review', firstDetected: '2025-09-10', lastCharge: '2025-12-10', nextExpected: '2026-01-10', isManual: 0 },
  { patternKey: 'YOUTUBE PREMIUM', displayName: 'YouTube Premium', frequency: 'monthly', amount: 29.90, isFixed: 1, score: 0.96, status: 'active', firstDetected: '2025-10-15', lastCharge: '2025-12-15', nextExpected: '2026-01-15', isManual: 0 },
  { patternKey: 'HOT MOBILE', displayName: 'Hot Mobile Plan', frequency: 'monthly', amount: 99.90, isFixed: 1, score: 0.99, status: 'keep', firstDetected: '2025-09-25', lastCharge: '2025-12-25', nextExpected: '2026-01-25', isManual: 0 },
  { patternKey: 'GYM_MEMBERSHIP', displayName: 'Gym Membership', frequency: 'monthly', amount: 189.00, isFixed: 1, score: 0.92, status: 'active', firstDetected: '2025-09-01', lastCharge: '2025-12-01', nextExpected: '2026-01-01', isManual: 1 },
];

SUBSCRIPTIONS.forEach((s) => {
  try {
    insertSubscription.run(s);
  } catch (e) {
    // Ignore duplicates
  }
});

// Insert subscription history
const insertSubHistory = db.prepare(`
  INSERT INTO subscription_history (subscription_id, event_type, old_value, new_value, amount, event_date)
  VALUES (@subId, @eventType, @oldValue, @newValue, @amount, @eventDate)
`);

const SUB_HISTORY = [
  { subId: 1, eventType: 'charge', oldValue: null, newValue: null, amount: 49.90, eventDate: '2025-09-01' },
  { subId: 1, eventType: 'charge', oldValue: null, newValue: null, amount: 49.90, eventDate: '2025-10-01' },
  { subId: 1, eventType: 'charge', oldValue: null, newValue: null, amount: 49.90, eventDate: '2025-11-01' },
  { subId: 1, eventType: 'charge', oldValue: null, newValue: null, amount: 49.90, eventDate: '2025-12-01' },
  { subId: 2, eventType: 'charge', oldValue: null, newValue: null, amount: 29.90, eventDate: '2025-09-01' },
  { subId: 2, eventType: 'charge', oldValue: null, newValue: null, amount: 29.90, eventDate: '2025-10-01' },
  { subId: 4, eventType: 'status_change', oldValue: 'active', newValue: 'review', amount: null, eventDate: '2025-12-15' },
  { subId: 6, eventType: 'price_change', oldValue: '89.90', newValue: '99.90', amount: 99.90, eventDate: '2025-11-01' },
];

SUB_HISTORY.forEach((h) => {
  try {
    insertSubHistory.run(h);
  } catch (e) {
    // Ignore
  }
});

// Insert subscription alerts
const insertSubAlert = db.prepare(`
  INSERT INTO subscription_alerts (subscription_id, alert_type, severity, title, description, old_amount, new_amount, percentage_change, is_dismissed)
  VALUES (@subId, @alertType, @severity, @title, @description, @oldAmount, @newAmount, @percentChange, @isDismissed)
`);

const SUB_ALERTS = [
  { subId: 4, alertType: 'unused', severity: 'warning', title: 'Amazon Prime not used', description: 'You have not made an Amazon purchase in 2 months.', oldAmount: null, newAmount: null, percentChange: null, isDismissed: 0 },
  { subId: 6, alertType: 'price_increase', severity: 'info', title: 'Hot Mobile price increased', description: 'Your mobile plan increased from 89.90 to 99.90 (11% increase).', oldAmount: 89.90, newAmount: 99.90, percentChange: 11.1, isDismissed: 1 },
];

SUB_ALERTS.forEach((a) => {
  try {
    insertSubAlert.run(a);
  } catch (e) {
    // Ignore
  }
});

console.log(`  Inserted ${SUBSCRIPTIONS.length} subscriptions with history and alerts`);

// ============================================
// STEP 11: SEED SAVINGS GOALS
// ============================================
console.log('📋 Seeding savings goals...');

const insertGoal = db.prepare(`
  INSERT OR IGNORE INTO savings_goals (name, description, target_amount, current_amount, currency, target_date, start_date, icon, color, status, priority, is_recurring, recurring_amount)
  VALUES (@name, @description, @targetAmount, @currentAmount, @currency, @targetDate, @startDate, @icon, @color, @status, @priority, @isRecurring, @recurringAmount)
`);

const SAVINGS_GOALS = [
  { name: 'Emergency Fund', description: 'Build 6 months of expenses as safety net', targetAmount: 50000.00, currentAmount: 23500.00, currency: 'ILS', targetDate: '2026-06-01', startDate: '2025-09-01', icon: 'savings', color: '#4CAF50', status: 'active', priority: 1, isRecurring: 1, recurringAmount: 2500.00 },
  { name: 'Summer Vacation', description: 'Trip to Europe with family', targetAmount: 15000.00, currentAmount: 8750.00, currency: 'ILS', targetDate: '2026-07-15', startDate: '2025-10-01', icon: 'flight', color: '#2196F3', status: 'active', priority: 2, isRecurring: 1, recurringAmount: 1250.00 },
  { name: 'New Laptop', description: 'MacBook Pro for work', targetAmount: 8000.00, currentAmount: 8000.00, currency: 'ILS', targetDate: '2025-12-31', startDate: '2025-09-15', icon: 'laptop', color: '#9C27B0', status: 'completed', priority: 3, isRecurring: 0, recurringAmount: null },
  { name: 'Home Renovation', description: 'Kitchen upgrade project', targetAmount: 35000.00, currentAmount: 5000.00, currency: 'ILS', targetDate: '2026-12-01', startDate: '2025-11-01', icon: 'home', color: '#FF9800', status: 'paused', priority: 4, isRecurring: 0, recurringAmount: null },
];

SAVINGS_GOALS.forEach((g) => {
  insertGoal.run(g);
});

// Get actual goal IDs by name
const getGoalId = db.prepare('SELECT id FROM savings_goals WHERE name = ?');
const goalIds = {
  emergency: getGoalId.get('Emergency Fund')?.id,
  vacation: getGoalId.get('Summer Vacation')?.id,
  laptop: getGoalId.get('New Laptop')?.id,
  renovation: getGoalId.get('Home Renovation')?.id,
};

const insertContribution = db.prepare(`
  INSERT INTO savings_goal_contributions (goal_id, amount, contribution_type, note, date)
  VALUES (@goalId, @amount, @type, @note, @date)
`);

// Contributions that sum to match current_amount for each goal:
// Emergency Fund: 5000 + 2500 + 2500 + 3000 + 2500 + 8000 = 23,500
// Summer Vacation: 2500 + 1250 + 1250 + 3750 = 8,750
// New Laptop: 3000 + 2500 + 2500 = 8,000
// Home Renovation: 5000 = 5,000
const CONTRIBUTIONS = [
  { goalId: goalIds.emergency, amount: 5000.00, type: 'manual', note: 'Initial deposit', date: '2025-09-01' },
  { goalId: goalIds.emergency, amount: 2500.00, type: 'auto', note: 'Monthly transfer', date: '2025-10-01' },
  { goalId: goalIds.emergency, amount: 2500.00, type: 'auto', note: 'Monthly transfer', date: '2025-11-01' },
  { goalId: goalIds.emergency, amount: 3000.00, type: 'manual', note: 'Bonus allocation', date: '2025-11-15' },
  { goalId: goalIds.emergency, amount: 2500.00, type: 'auto', note: 'Monthly transfer', date: '2025-12-01' },
  { goalId: goalIds.emergency, amount: 8000.00, type: 'manual', note: 'Year-end bonus', date: '2025-12-31' },
  { goalId: goalIds.vacation, amount: 2500.00, type: 'manual', note: 'Initial deposit', date: '2025-10-01' },
  { goalId: goalIds.vacation, amount: 1250.00, type: 'auto', note: 'Monthly transfer', date: '2025-11-01' },
  { goalId: goalIds.vacation, amount: 1250.00, type: 'auto', note: 'Monthly transfer', date: '2025-12-01' },
  { goalId: goalIds.vacation, amount: 3750.00, type: 'manual', note: 'Holiday gift money', date: '2025-12-25' },
  { goalId: goalIds.laptop, amount: 3000.00, type: 'manual', note: 'Initial savings', date: '2025-09-15' },
  { goalId: goalIds.laptop, amount: 2500.00, type: 'manual', note: 'From salary', date: '2025-10-15' },
  { goalId: goalIds.laptop, amount: 2500.00, type: 'manual', note: 'Completed!', date: '2025-11-15' },
  { goalId: goalIds.renovation, amount: 5000.00, type: 'manual', note: 'Started saving', date: '2025-11-01' },
];

CONTRIBUTIONS.forEach((c) => {
  if (c.goalId) {
    insertContribution.run(c);
  }
});

console.log(`  Inserted ${SAVINGS_GOALS.length} savings goals with ${CONTRIBUTIONS.length} contributions`);

// ============================================
// STEP 12: SEED TRANSACTIONS (original logic)
// ============================================
console.log('📋 Seeding transactions...');

const EXPENSE_TRANSACTIONS = [
  // Supermarket (category 3)
  { name: 'שופרסל דיל', vendor: 'max', account: '1234', category: 3, minAmount: 80, maxAmount: 450 },
  { name: 'רמי לוי', vendor: 'max', account: '1234', category: 3, minAmount: 100, maxAmount: 600 },
  { name: 'יינות ביתן', vendor: 'visaCal', account: '9012', category: 3, minAmount: 50, maxAmount: 300 },
  { name: 'אושר עד', vendor: 'max', account: '5678', category: 3, minAmount: 60, maxAmount: 250 },
  { name: 'ויקטורי', vendor: 'max', account: '1234', category: 3, minAmount: 40, maxAmount: 200 },
  
  // Restaurants (category 4)
  { name: 'WOLT', vendor: 'max', account: '1234', category: 4, minAmount: 45, maxAmount: 180 },
  { name: 'ארומה', vendor: 'visaCal', account: '9012', category: 4, minAmount: 25, maxAmount: 80 },
  { name: 'מקדונלדס', vendor: 'max', account: '5678', category: 4, minAmount: 35, maxAmount: 120 },
  { name: 'גרג קפה', vendor: 'max', account: '1234', category: 4, minAmount: 30, maxAmount: 90 },
  { name: 'שיפודי התקווה', vendor: 'visaCal', account: '9012', category: 4, minAmount: 80, maxAmount: 250 },
  
  // Coffee & Bakery (category 5)
  { name: 'קפה קפה', vendor: 'max', account: '1234', category: 5, minAmount: 20, maxAmount: 65 },
  { name: 'רולדין', vendor: 'max', account: '5678', category: 5, minAmount: 25, maxAmount: 80 },
  { name: 'לחמנינה', vendor: 'visaCal', account: '9012', category: 5, minAmount: 15, maxAmount: 50 },
  
  // Delivery (category 6)
  { name: 'וולט משלוחים', vendor: 'max', account: '1234', category: 6, minAmount: 50, maxAmount: 150 },
  { name: 'תן ביס', vendor: 'max', account: '5678', category: 6, minAmount: 40, maxAmount: 120 },
  
  // Fuel (category 11)
  { name: 'פז', vendor: 'max', account: '1234', category: 11, minAmount: 150, maxAmount: 450 },
  { name: 'דלק', vendor: 'visaCal', account: '9012', category: 11, minAmount: 120, maxAmount: 400 },
  { name: 'סונול', vendor: 'max', account: '5678', category: 11, minAmount: 100, maxAmount: 350 },
  
  // Public Transport (category 12)
  { name: 'רב קו', vendor: 'max', account: '1234', category: 12, minAmount: 50, maxAmount: 150 },
  { name: 'אגד', vendor: 'visaCal', account: '9012', category: 12, minAmount: 10, maxAmount: 50 },
  
  // Parking (category 13)
  { name: 'אחוזות החוף', vendor: 'max', account: '1234', category: 13, minAmount: 15, maxAmount: 60 },
  { name: 'פנגו', vendor: 'max', account: '5678', category: 13, minAmount: 10, maxAmount: 40 },
  
  // Taxi (category 14)
  { name: 'גט טקסי', vendor: 'max', account: '1234', category: 14, minAmount: 25, maxAmount: 120 },
  { name: 'יאנגו', vendor: 'visaCal', account: '9012', category: 14, minAmount: 20, maxAmount: 100 },
  
  // Digital Wallets (category 30)
  { name: 'BIT', vendor: 'max', account: '1234', category: 30, minAmount: 20, maxAmount: 500 },
  { name: 'פייבוקס', vendor: 'max', account: '5678', category: 30, minAmount: 15, maxAmount: 300 },
  
  // Shopping - Clothing (category 56)
  { name: 'H&M', vendor: 'max', account: '1234', category: 56, minAmount: 100, maxAmount: 500 },
  { name: 'זארה', vendor: 'visaCal', account: '9012', category: 56, minAmount: 150, maxAmount: 600 },
  { name: 'קסטרו', vendor: 'max', account: '5678', category: 56, minAmount: 80, maxAmount: 400 },
  
  // Shopping Electronics (category 60)
  { name: 'KSP', vendor: 'max', account: '1234', category: 60, minAmount: 50, maxAmount: 800 },
  { name: 'BUG', vendor: 'visaCal', account: '9012', category: 60, minAmount: 80, maxAmount: 600 },
  { name: 'איביי', vendor: 'max', account: '5678', category: 60, minAmount: 30, maxAmount: 400 },
  
  // Home & Maintenance (category 79)
  { name: 'איקאה', vendor: 'max', account: '1234', category: 79, minAmount: 100, maxAmount: 1500 },
  { name: 'הום סנטר', vendor: 'visaCal', account: '9012', category: 79, minAmount: 50, maxAmount: 500 },
  { name: 'ACE', vendor: 'max', account: '5678', category: 79, minAmount: 30, maxAmount: 300 },
  
  // Pharmacy (category 41)
  { name: 'סופר פארם', vendor: 'max', account: '5678', category: 41, minAmount: 30, maxAmount: 200 },
  { name: 'בי פארם', vendor: 'max', account: '1234', category: 41, minAmount: 20, maxAmount: 150 },
  
  // Health & Wellness - Medical (category 39)
  { name: 'מכבי', vendor: 'discount', account: '0123456789', category: 39, minAmount: 25, maxAmount: 80 },
  { name: 'כללית', vendor: 'discount', account: '0123456789', category: 39, minAmount: 30, maxAmount: 100 },
  
  // Mobile & Communications (category 25)
  { name: 'פלאפון', vendor: 'discount', account: '0123456789', category: 25, minAmount: 60, maxAmount: 120 },
  { name: 'הוט', vendor: 'discount', account: '0123456789', category: 25, minAmount: 150, maxAmount: 250 },
  { name: 'פרטנר', vendor: 'discount', account: '0123456789', category: 25, minAmount: 50, maxAmount: 100 },
  
  // Utilities - Electricity (category 26)
  { name: 'חברת החשמל', vendor: 'discount', account: '0123456789', category: 26, minAmount: 200, maxAmount: 600 },
  
  // Utilities - Water (category 27)
  { name: 'מי אביבים', vendor: 'discount', account: '0123456789', category: 27, minAmount: 80, maxAmount: 200 },
  
  // Rent & Mortgage (category 23)
  { name: 'שכירות', vendor: 'discount', account: '0123456789', category: 23, minAmount: 6500, maxAmount: 7500 },
  
  // Municipal Taxes / Arnona (category 36)
  { name: 'עיריית תל אביב', vendor: 'discount', account: '0123456789', category: 36, minAmount: 400, maxAmount: 800 },
  
  // Kindergarten & Schools (category 75)
  { name: 'מעון יום', vendor: 'discount', account: '0123456789', category: 75, minAmount: 2500, maxAmount: 3500 },
  { name: 'משפחתון', vendor: 'discount', account: '0123456789', category: 75, minAmount: 2000, maxAmount: 3000 },
  
  // Streaming Services (category 49)
  { name: 'נטפליקס', vendor: 'max', account: '1234', category: 49, minAmount: 35, maxAmount: 55 },
  { name: 'ספוטיפיי', vendor: 'visaCal', account: '9012', category: 49, minAmount: 20, maxAmount: 35 },
  
  // Gym & Fitness (category 44)
  { name: 'חוגי ספורט', vendor: 'discount', account: '0123456789', category: 44, minAmount: 200, maxAmount: 500 },
  { name: 'חדר כושר', vendor: 'max', account: '1234', category: 44, minAmount: 150, maxAmount: 300 },
  
  // Insurance (category 35)
  { name: 'ביטוח בריאות', vendor: 'discount', account: '0123456789', category: 35, minAmount: 150, maxAmount: 400 },
];

const INCOME_TRANSACTIONS = [
  { name: 'משכורת - חברת הייטק', vendor: 'discount', account: '0123456789', category: 90, minAmount: 25000, maxAmount: 30000 },
  { name: 'משכורת - חברת הייטק', vendor: 'discount', account: '0123456789', category: 90, minAmount: 10000, maxAmount: 14000 },
  { name: 'ביטוח לאומי - קצבת ילדים', vendor: 'discount', account: '0123456789', category: 94, minAmount: 150, maxAmount: 200 },
];

const INVESTMENT_TRANSACTIONS = [
  { name: 'העברה לקרן השתלמות', vendor: 'discount', account: '0123456789', category: 100, minAmount: 500, maxAmount: 2000 },
  { name: 'הפרשה לפנסיה', vendor: 'discount', account: '0123456789', category: 100, minAmount: 1000, maxAmount: 3000 },
];

function randomBetween(min, max) { return Math.random() * (max - min) + min; }
function randomInt(min, max) { return Math.floor(randomBetween(min, max + 1)); }
function generateId(i) { return 'demo-' + Date.now() + '-' + i + '-' + Math.random().toString(16).slice(2, 8); }

const insertStmt = db.prepare(`
  INSERT INTO transactions (identifier, vendor, vendor_nickname, date, name, price, type, status, auto_categorized, confidence_score, account_number, category_definition_id, category_type, transaction_datetime)
  VALUES (@id, @vendor, @nickname, @date, @name, @price, @type, 'completed', 1, @confidence, @account, @categoryId, @categoryType, @datetime)
`);

const now = new Date();
const txns = [];

// Generate 5 months of data
for (let month = 0; month < 5; month++) {
  const monthDate = new Date(now);
  monthDate.setMonth(monthDate.getMonth() - month);
  
  // Income: 2 salaries + 1 child benefit per month
  INCOME_TRANSACTIONS.forEach((t, i) => {
    const txDate = new Date(monthDate);
    txDate.setDate(i < 2 ? 10 : 1);
    txDate.setHours(randomInt(8, 18), randomInt(1, 59), 0, 0);
    txns.push({
      ...t,
      date: txDate.toISOString(),
      amount: randomBetween(t.minAmount, t.maxAmount),
      txType: 'income'
    });
  });
  
  // Investment: 2 per month
  INVESTMENT_TRANSACTIONS.forEach((t) => {
    const txDate = new Date(monthDate);
    txDate.setDate(15);
    txDate.setHours(randomInt(9, 17), randomInt(1, 59), 0, 0);
    txns.push({
      ...t,
      date: txDate.toISOString(),
      amount: -randomBetween(t.minAmount, t.maxAmount),
      txType: 'investment'
    });
  });
  
  // Expenses: ~80-100 per month
  const expenseCount = randomInt(80, 100);
  for (let i = 0; i < expenseCount; i++) {
    const t = EXPENSE_TRANSACTIONS[randomInt(0, EXPENSE_TRANSACTIONS.length - 1)];
    const txDate = new Date(monthDate);
    txDate.setDate(randomInt(1, 28));
    txDate.setHours(randomInt(8, 22), randomInt(1, 59), 0, 0);
    txns.push({
      ...t,
      date: txDate.toISOString(),
      amount: -randomBetween(t.minAmount, t.maxAmount),
      txType: 'expense'
    });
  }
}

// Insert all transactions
const insertTxn = db.transaction(() => {
  txns.forEach((t, i) => {
    try {
      insertStmt.run({
        id: generateId(i),
        vendor: t.vendor,
        nickname: t.vendor === 'discount' ? 'Discount' : t.vendor === 'max' ? 'Max' : 'Cal',
        date: t.date,
        name: t.name,
        price: t.amount,
        type: t.txType === 'income' ? 'transfer' : 'card',
        confidence: randomBetween(0.7, 0.99),
        account: t.account,
        categoryId: t.category,
        categoryType: t.txType,
        datetime: t.date
      });
    } catch (e) {
      // Ignore duplicate key errors
    }
  });
});

try {
  insertTxn();
  console.log(`  Inserted ${txns.length} transactions`);
} catch (e) {
  console.log('  Transactions already exist or error:', e.message);
}

// ============================================
// STEP 13: SEED USER PROFILE & INVESTMENTS
// ============================================
console.log('📋 Seeding user profile and investments...');

db.prepare(`
  INSERT OR REPLACE INTO user_profile (id, username, marital_status, age, occupation, monthly_income, family_status, location, industry, birth_date, children_count, household_size, home_ownership, education_level, employment_status)
  VALUES (1, 'Demo User', 'married', 35, 'Software Engineer', 40000, 'married_with_children', 'Tel Aviv', 'Technology', '1991-03-15', 2, 4, 'renting', 'masters', 'employed')
`).run();

const INVESTMENT_ACCOUNTS = [
  { name: 'קרן השתלמות - מיטב', type: 'hishtalmut', institution: 'meitav', currency: 'ILS', is_liquid: 0, category: 'long_term' },
  { name: 'פנסיה - הראל', type: 'pension', institution: 'harel', currency: 'ILS', is_liquid: 0, category: 'long_term' },
  { name: 'קופת גמל - כלל', type: 'gemel', institution: 'clal', currency: 'ILS', is_liquid: 0, category: 'long_term' },
  { name: 'תיק השקעות - IBI', type: 'brokerage', institution: 'ibi', currency: 'ILS', is_liquid: 1, category: 'liquid' },
  { name: 'Interactive Brokers', type: 'brokerage', institution: 'interactive_brokers', currency: 'USD', is_liquid: 1, category: 'liquid' },
  { name: 'פיקדון בנקאי - דיסקונט', type: 'deposit', institution: 'discount', currency: 'ILS', is_liquid: 1, category: 'liquid' },
  { name: 'Bit2C - קריפטו', type: 'crypto', institution: 'bit2c', currency: 'ILS', is_liquid: 1, category: 'liquid' },
];

const insertAccount = db.prepare(`
  INSERT OR IGNORE INTO investment_accounts (account_name, account_type, institution, currency, is_active, is_liquid, investment_category)
  VALUES (@name, @type, @institution, @currency, 1, @isLiquid, @category)
`);

INVESTMENT_ACCOUNTS.forEach((acc) => {
  insertAccount.run({
    name: acc.name,
    type: acc.type,
    institution: acc.institution,
    currency: acc.currency,
    isLiquid: acc.is_liquid,
    category: acc.category,
  });
});
console.log(`  Inserted user profile and ${INVESTMENT_ACCOUNTS.length} investment accounts`);

// ============================================
// STEP 14: SEED CATEGORY BUDGETS
// ============================================
console.log('📋 Seeding category budgets...');

const BUDGETS = [
  { categoryId: 3, limit: 2500, period: 'monthly' },   // Supermarket
  { categoryId: 4, limit: 1200, period: 'monthly' },   // Restaurants
  { categoryId: 5, limit: 400, period: 'monthly' },    // Coffee
  { categoryId: 11, limit: 800, period: 'monthly' },   // Fuel
  { categoryId: 56, limit: 1000, period: 'monthly' },  // Clothing
  { categoryId: 60, limit: 500, period: 'monthly' },   // Electronics
  { categoryId: 49, limit: 150, period: 'monthly' },   // Streaming
];

const insertBudget = db.prepare(`
  INSERT OR IGNORE INTO category_budgets (category_definition_id, period_type, budget_limit, is_active)
  VALUES (@categoryId, @period, @limit, 1)
`);

BUDGETS.forEach((b) => {
  insertBudget.run({
    categoryId: b.categoryId,
    period: b.period,
    limit: b.limit,
  });
});
console.log(`  Inserted ${BUDGETS.length} category budgets`);

// ============================================
// STEP 15: POPULATE FTS INDEXES
// ============================================
console.log('📋 Populating FTS indexes...');

try {
  db.exec('DELETE FROM transactions_fts');
  db.exec('INSERT INTO transactions_fts(rowid, name, memo, vendor, merchant_name) SELECT rowid, name, memo, vendor, merchant_name FROM transactions');
  const txnFtsCount = db.prepare('SELECT COUNT(*) as cnt FROM transactions_fts').get();
  console.log(`  Populated transactions_fts: ${txnFtsCount.cnt} rows`);
} catch (e) {
  console.log('  transactions_fts population skipped:', e.message);
}

try {
  db.exec('DELETE FROM categorization_rules_fts');
  db.exec('INSERT INTO categorization_rules_fts(rowid, name_pattern) SELECT id, name_pattern FROM categorization_rules');
  const rulesFtsCount = db.prepare('SELECT COUNT(*) as cnt FROM categorization_rules_fts').get();
  console.log(`  Populated categorization_rules_fts: ${rulesFtsCount.cnt} rows`);
} catch (e) {
  console.log('  categorization_rules_fts population skipped:', e.message);
}

try {
  db.exec('DELETE FROM category_definitions_fts');
  db.exec('INSERT INTO category_definitions_fts(rowid, name, name_en, name_fr) SELECT id, name, name_en, name_fr FROM category_definitions');
  const catFtsCount = db.prepare('SELECT COUNT(*) as cnt FROM category_definitions_fts').get();
  console.log(`  Populated category_definitions_fts: ${catFtsCount.cnt} rows`);
} catch (e) {
  console.log('  category_definitions_fts population skipped:', e.message);
}

// ============================================
// STEP 16: RUN ANALYZE
// ============================================
console.log('📋 Running ANALYZE...');
db.exec('ANALYZE');
console.log('  ANALYZE complete');

// ============================================
// SUMMARY
// ============================================
console.log('\n' + '='.repeat(50));
console.log('DATABASE SEEDING COMPLETE');
console.log('='.repeat(50));

const summary = {
  transactions: db.prepare('SELECT COUNT(*) as cnt FROM transactions').get().cnt,
  categorization_rules: db.prepare('SELECT COUNT(*) as cnt FROM categorization_rules').get().cnt,
  scrape_events: db.prepare('SELECT COUNT(*) as cnt FROM scrape_events').get().cnt,
  account_pairings: db.prepare('SELECT COUNT(*) as cnt FROM account_pairings').get().cnt,
  subscriptions: db.prepare('SELECT COUNT(*) as cnt FROM subscriptions').get().cnt,
  savings_goals: db.prepare('SELECT COUNT(*) as cnt FROM savings_goals').get().cnt,
  chat_conversations: db.prepare('SELECT COUNT(*) as cnt FROM chat_conversations').get().cnt,
};

console.log('\nData summary:');
console.table(summary);

const dateRange = db.prepare('SELECT MIN(date) as min_date, MAX(date) as max_date FROM transactions').get();
console.log(`\nDate range: ${dateRange.min_date} to ${dateRange.max_date}`);

db.close();
console.log('\nDone!');
