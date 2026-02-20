#!/usr/bin/env node
/**
 * Seed realistic demo data matching real DB structure
 * This script creates a complete demo database with:
 * - All missing tables (chat, subscriptions, license, donations, etc.)
 * - FTS5 full-text search tables and triggers
 * - Performance indexes
 * - Realistic transactions, scrape events, account pairings
 * - Sample data for new features
 */
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require(path.join(__dirname, '..', 'app', 'node_modules', 'better-sqlite3'));
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'dist', 'clarify-anonymized.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const BASE_DATE = new Date(process.env.DEMO_BASE_DATE || '2026-02-06T12:00:00Z');
const SEED = Number(process.env.DEMO_SEED || 42);
const USD_ILS_RATE = Number(process.env.DEMO_USD_ILS_RATE || 3.7);
const ID_BASE = BASE_DATE.getTime();
function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(Number.isFinite(SEED) ? SEED : 42);
function randomBetween(min, max) { return rng() * (max - min) + min; }
function randomInt(min, max) { return Math.floor(randomBetween(min, max + 1)); }
function pick(list) { return list[randomInt(0, list.length - 1)]; }
function money(amount) { return Math.round(amount * 100) / 100; }
function variance(base, spread) { return money(randomBetween(base - spread, base + spread)); }
function monthKeyFrom(dateObj) { return dateObj.toISOString().slice(0, 7); }
function monthDateFromBase(offset) {
  return new Date(Date.UTC(BASE_DATE.getUTCFullYear(), BASE_DATE.getUTCMonth() + offset, 1, 12, 0, 0));
}
function dateOnly(dateObj) { return dateObj.toISOString().slice(0, 10); }
function addMonths(dateObj, months) {
  const next = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate(), 12, 0, 0));
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}
function isSameUtcMonth(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}
function capDayForBaseMonth(monthDate, day) {
  if (!isSameUtcMonth(monthDate, BASE_DATE)) return day;
  return Math.min(day, BASE_DATE.getUTCDate());
}
function dateInMonth(monthDate, day, hourRange) {
  const safeDay = capDayForBaseMonth(monthDate, Math.min(day, 28));
  const [startHour, endHour] = hourRange || [8, 20];
  const date = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), safeDay, 0, 0, 0));
  date.setUTCHours(randomInt(startHour, endHour), randomInt(0, 59), 0, 0);
  return date.toISOString();
}
function dateRandomInMonth(monthDate, dayRange, hourRange) {
  const [dayStart, dayEnd] = dayRange || [1, 28];
  const cappedEnd = capDayForBaseMonth(monthDate, dayEnd);
  const cappedStart = Math.min(dayStart, cappedEnd);
  return dateInMonth(monthDate, randomInt(cappedStart, cappedEnd), hourRange);
}
function dateAtUtc(dateObj, hour, minute) {
  const safeMinute = Number.isFinite(minute) ? minute : 0;
  const date = new Date(Date.UTC(
    dateObj.getUTCFullYear(),
    dateObj.getUTCMonth(),
    dateObj.getUTCDate(),
    hour,
    safeMinute,
    0,
  ));
  return date.toISOString();
}
function generateId(i) { return `demo-${ID_BASE}-${i}`; }

console.log(`\n🗄️  Seeding database: ${DB_PATH}\n`);

// ============================================
// STEP 0: CLEANUP EXISTING DEMO DATA
// ============================================
console.log('🧹 Cleaning up existing demo data...');

// Guard against legacy FTS schema pointing to a non-existent transactions.id
try {
  const ftsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions_fts'").get();
  if (ftsSql && /content_rowid\s*=\s*'id'/i.test(ftsSql.sql || '')) {
    db.exec('DROP TRIGGER IF EXISTS transactions_fts_insert');
    db.exec('DROP TRIGGER IF EXISTS transactions_fts_delete');
    db.exec('DROP TRIGGER IF EXISTS transactions_fts_update');
    db.exec('DROP TABLE IF EXISTS transactions_fts');
  }
} catch (e) {
  // Ignore and proceed with cleanup
}

// Delete demo transactions (those with 'demo-' or 'txn_new_' prefix from seed scripts)
db.exec("DELETE FROM transactions WHERE identifier LIKE 'demo-%' OR identifier LIKE 'txn_new_%'");

// Clear tables that we fully control (will be recreated)
const TABLES_TO_CLEAR = [
  'subscription_alerts',
  'subscription_history',
  'subscriptions',
  'chat_messages',
  'chat_conversations',
  'scrape_events',
  'account_pairings',
  'category_budgets',
  'investment_holdings',
  'investment_assets',
  'investment_accounts',
  'vendor_credentials',
  'license',
  'donation_events',
  'donation_meta',
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
    email TEXT NOT NULL,
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

  // Donations tables
  `CREATE TABLE IF NOT EXISTS donation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_ils REAL NOT NULL CHECK (amount_ils > 0),
    donated_at TEXT NOT NULL,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS donation_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_reminder_month_key TEXT,
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

console.log(`  Created ${MISSING_TABLES.length} missing tables`);

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

  // Chat indexes
  'CREATE INDEX IF NOT EXISTS idx_chat_conversations_external_id ON chat_conversations(external_id)',
  'CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at)',

  // Pairing exclusions index
  'CREATE INDEX IF NOT EXISTS idx_pairing_exclusions_pairing_id ON transaction_pairing_exclusions(pairing_id)',

  // Donation indexes
  'CREATE INDEX IF NOT EXISTS idx_donation_events_donated_at ON donation_events(donated_at DESC)',
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

// Note: username, id_number, password, identification_code are encrypted fields
// They must be NULL for demo data, otherwise decryption will fail at runtime
const DEMO_CREDENTIALS = [
  { vendor: 'max', nickname: 'Max - כרטיס ראשי', username: null, institution_id: null },
  { vendor: 'visaCal', nickname: 'Cal - כרטיס משני', username: null, institution_id: null },
  { vendor: 'discount', nickname: 'דיסקונט - עו"ש', username: null, bank_account_number: '0123456789', institution_id: null },
];

const insertCredential = db.prepare(`
  INSERT OR IGNORE INTO vendor_credentials (vendor, nickname, username, bank_account_number, institution_id, last_scrape_status)
  VALUES (@vendor, @nickname, @username, @bankAccount, @institutionId, 'never')
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

const demoVendors = DEMO_CREDENTIALS.map((cred) => cred.vendor);
const vendorPlaceholders = demoVendors.map(() => '?').join(', ');
const credentialIdByVendor = new Map(
  db
    .prepare(`SELECT id, vendor FROM vendor_credentials WHERE vendor IN (${vendorPlaceholders})`)
    .all(...demoVendors)
    .map((row) => [row.vendor, row.id])
);

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

const syncNow = new Date();
const latestSyncDay = dateOnly(syncNow);
const twoDaysAgo = new Date(syncNow.getTime() - 2 * 24 * 60 * 60 * 1000);
const twoDaysAgoSyncDay = dateOnly(twoDaysAgo);
const RECENT_SCRAPE_EVENTS = [
  { triggeredBy: 'scheduled', vendor: 'discount', startDate: latestSyncDay, status: 'success', message: 'Scraped 17 transactions', createdAt: syncNow.toISOString() },
  { triggeredBy: 'scheduled', vendor: 'max', startDate: twoDaysAgoSyncDay, status: 'success', message: 'Scraped 12 transactions', createdAt: twoDaysAgo.toISOString() },
];

const NEVER_SYNCED_VENDOR = 'visaCal';
const preparedScrapeEvents = SCRAPE_EVENTS
  .concat(RECENT_SCRAPE_EVENTS)
  .filter((event) => event.vendor !== NEVER_SYNCED_VENDOR)
  .map((event) => {
    const credentialId = credentialIdByVendor.get(event.vendor);
    if (!credentialId) return null;
    return { ...event, credentialId };
  })
  .filter(Boolean);

preparedScrapeEvents.forEach((event) => {
  try {
    insertScrapeEvent.run(event);
  } catch (e) {
    // Ignore duplicates
  }
});
console.log(`  Inserted ${preparedScrapeEvents.length} scrape events`);
console.log('  Demo sync states: discount = now, max = 2 days ago, visaCal = never');

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
    INSERT OR REPLACE INTO license (id, unique_id, email, device_hash, installation_date, trial_start_date, license_type, app_version)
    VALUES (1, 'demo-user-12345-67890', 'demo@example.com', 'demo-device-hash-abc123', '2025-09-01T10:00:00Z', '2025-09-01T10:00:00Z', 'pro', '1.5.0')
  `).run();
  console.log('  Inserted license record');
} catch (e) {
  console.log('  License already exists');
}

// ============================================
// STEP 8B: SEED DONATION DEFAULTS
// ============================================
console.log('📋 Seeding donation defaults...');

const DONATION_DEMO_MONTH_KEY = monthKeyFrom(BASE_DATE);
const DONATION_META_DEFAULT_MONTH =
  process.env.DEMO_DONATION_MARK_REMINDER === 'true' ? DONATION_DEMO_MONTH_KEY : null;

db.prepare(`
  INSERT OR REPLACE INTO donation_meta (id, last_reminder_month_key, created_at, updated_at)
  VALUES (1, @lastReminderMonthKey, datetime('now'), datetime('now'))
`).run({
  lastReminderMonthKey: DONATION_META_DEFAULT_MONTH,
});

if (process.env.DEMO_DONOR === 'true') {
  const donorAmount = Number(process.env.DEMO_DONATION_AMOUNT_ILS || 60);
  const safeAmount = Number.isFinite(donorAmount) && donorAmount > 0 ? money(donorAmount) : 60;
  db.prepare(`
    INSERT INTO donation_events (amount_ils, donated_at, note, source, created_at)
    VALUES (@amount, @donatedAt, @note, 'manual', @createdAt)
  `).run({
    amount: safeAmount,
    donatedAt: BASE_DATE.toISOString(),
    note: 'Demo donor fixture',
    createdAt: BASE_DATE.toISOString(),
  });
  console.log(`  Inserted donor fixture (₪${safeAmount})`);
} else {
  console.log('  Non-donor default seeded');
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
  { externalId: 'conv-001', role: 'user', content: 'How much did I spend on restaurants this month?', tokensUsed: 25, createdAt: '2025-11-15T10:00:00Z' },
  { externalId: 'conv-001', role: 'assistant', content: 'Based on your transactions, you spent 1,245 ILS on restaurants this month. This is 15% higher than last month.', tokensUsed: 180, createdAt: '2025-11-15T10:00:30Z' },
  { externalId: 'conv-001', role: 'user', content: 'What about supermarkets?', tokensUsed: 15, createdAt: '2025-11-15T10:10:00Z' },
  { externalId: 'conv-001', role: 'assistant', content: 'Your supermarket spending this month totals 2,890 ILS. Rami Levy accounts for 45% of that spending.', tokensUsed: 165, createdAt: '2025-11-15T10:10:25Z' },
  { externalId: 'conv-002', role: 'user', content: 'Can you help me plan my December budget?', tokensUsed: 20, createdAt: '2025-12-01T14:30:00Z' },
  { externalId: 'conv-002', role: 'assistant', content: 'Based on your spending patterns, here is a suggested budget for December: Food & Groceries: 4,500 ILS, Transportation: 800 ILS, Entertainment: 1,200 ILS.', tokensUsed: 250, createdAt: '2025-12-01T14:30:45Z' },
  { externalId: 'conv-003', role: 'user', content: 'How is my investment portfolio performing?', tokensUsed: 18, createdAt: '2025-12-10T09:00:00Z' },
  { externalId: 'conv-003', role: 'assistant', content: 'Your portfolio summary: Total Value: 125,000 ILS, Monthly Return: +2.3%, YTD Return: +12.5%.', tokensUsed: 180, createdAt: '2025-12-10T09:00:40Z' },
];

const convoIdByExternal = new Map(
  db.prepare('SELECT id, external_id FROM chat_conversations').all().map((row) => [row.external_id, row.id])
);

MESSAGES.forEach((m) => {
  try {
    const convoId = convoIdByExternal.get(m.externalId);
    if (!convoId) return;
    insertMessage.run({
      conversationId: convoId,
      role: m.role,
      content: m.content,
      tokensUsed: m.tokensUsed,
      createdAt: m.createdAt,
    });
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

const BUDGETS = [
  { categoryId: 3, limit: 2500, period: 'monthly' },   // Supermarket
  { categoryId: 4, limit: 1200, period: 'monthly' },   // Restaurants
  { categoryId: 5, limit: 400, period: 'monthly' },    // Coffee
  { categoryId: 11, limit: 900, period: 'monthly' },   // Fuel
  { categoryId: 56, limit: 800, period: 'monthly' },   // Clothing
  { categoryId: 60, limit: 1200, period: 'monthly' },  // Electronics
  { categoryId: 49, limit: 200, period: 'monthly' },   // Streaming
];
const BUDGET_LIMITS = new Map(BUDGETS.map((b) => [b.categoryId, b.limit]));

// ============================================
// STEP 11: SEED TRANSACTIONS (realistic household model)
// ============================================
console.log('📋 Seeding transactions...');

const MERCHANTS = {
  groceries: [
    { name: 'רמי לוי', vendor: 'max', account: '1234', category: 3, minAmount: 110, maxAmount: 320 },
    { name: 'רמי לוי', vendor: 'max', account: '1234', category: 3, minAmount: 110, maxAmount: 320 },
    { name: 'שופרסל דיל', vendor: 'max', account: '1234', category: 3, minAmount: 90, maxAmount: 300 },
    { name: 'אושר עד', vendor: 'max', account: '5678', category: 3, minAmount: 80, maxAmount: 260 },
    { name: 'ויקטורי', vendor: 'max', account: '1234', category: 3, minAmount: 70, maxAmount: 240 },
    { name: 'יינות ביתן', vendor: 'visaCal', account: '9012', category: 3, minAmount: 60, maxAmount: 220 },
  ],
  restaurants: [
    { name: 'WOLT', vendor: 'max', account: '1234', category: 4, minAmount: 55, maxAmount: 160 },
    { name: 'ארומה', vendor: 'visaCal', account: '9012', category: 4, minAmount: 30, maxAmount: 85 },
    { name: 'מקדונלדס', vendor: 'max', account: '5678', category: 4, minAmount: 40, maxAmount: 120 },
    { name: 'גרג קפה', vendor: 'max', account: '1234', category: 4, minAmount: 35, maxAmount: 95 },
    { name: 'שיפודי התקווה', vendor: 'visaCal', account: '9012', category: 4, minAmount: 90, maxAmount: 220 },
  ],
  coffee: [
    { name: 'קפה קפה', vendor: 'max', account: '1234', category: 5, minAmount: 20, maxAmount: 55 },
    { name: 'רולדין', vendor: 'max', account: '5678', category: 5, minAmount: 25, maxAmount: 70 },
    { name: 'לחמנינה', vendor: 'visaCal', account: '9012', category: 5, minAmount: 18, maxAmount: 50 },
  ],
  delivery: [
    { name: 'וולט משלוחים', vendor: 'max', account: '1234', category: 6, minAmount: 70, maxAmount: 160 },
    { name: 'תן ביס', vendor: 'max', account: '5678', category: 6, minAmount: 60, maxAmount: 140 },
  ],
  fuel: [
    { name: 'פז', vendor: 'max', account: '1234', category: 11, minAmount: 140, maxAmount: 210 },
    { name: 'דלק', vendor: 'visaCal', account: '9012', category: 11, minAmount: 130, maxAmount: 200 },
    { name: 'סונול', vendor: 'max', account: '5678', category: 11, minAmount: 120, maxAmount: 190 },
  ],
  publicTransport: [
    { name: 'רב קו', vendor: 'max', account: '1234', category: 12, minAmount: 15, maxAmount: 60 },
    { name: 'אגד', vendor: 'visaCal', account: '9012', category: 12, minAmount: 10, maxAmount: 45 },
  ],
  parking: [
    { name: 'אחוזות החוף', vendor: 'max', account: '1234', category: 13, minAmount: 15, maxAmount: 60 },
    { name: 'פנגו', vendor: 'max', account: '5678', category: 13, minAmount: 12, maxAmount: 45 },
  ],
  taxi: [
    { name: 'גט טקסי', vendor: 'max', account: '1234', category: 14, minAmount: 35, maxAmount: 120 },
    { name: 'יאנגו', vendor: 'visaCal', account: '9012', category: 14, minAmount: 30, maxAmount: 110 },
  ],
  wallets: [
    { name: 'BIT', vendor: 'max', account: '1234', category: 30, minAmount: 40, maxAmount: 220 },
    { name: 'פייבוקס', vendor: 'max', account: '5678', category: 30, minAmount: 35, maxAmount: 200 },
  ],
  clothing: [
    { name: 'H&M', vendor: 'max', account: '1234', category: 56, minAmount: 180, maxAmount: 550 },
    { name: 'זארה', vendor: 'visaCal', account: '9012', category: 56, minAmount: 220, maxAmount: 650 },
    { name: 'קסטרו', vendor: 'max', account: '5678', category: 56, minAmount: 160, maxAmount: 480 },
  ],
  electronics: [
    { name: 'KSP', vendor: 'max', account: '1234', category: 60, minAmount: 400, maxAmount: 1200 },
    { name: 'BUG', vendor: 'visaCal', account: '9012', category: 60, minAmount: 350, maxAmount: 1000 },
    { name: 'איביי', vendor: 'max', account: '5678', category: 60, minAmount: 300, maxAmount: 900 },
  ],
  home: [
    { name: 'איקאה', vendor: 'max', account: '1234', category: 79, minAmount: 250, maxAmount: 900 },
    { name: 'הום סנטר', vendor: 'visaCal', account: '9012', category: 79, minAmount: 200, maxAmount: 700 },
    { name: 'ACE', vendor: 'max', account: '5678', category: 79, minAmount: 180, maxAmount: 650 },
  ],
  pharmacy: [
    { name: 'סופר פארם', vendor: 'max', account: '5678', category: 41, minAmount: 40, maxAmount: 160 },
    { name: 'בי פארם', vendor: 'max', account: '1234', category: 41, minAmount: 35, maxAmount: 140 },
  ],
  health: [
    { name: 'מכבי', vendor: 'discount', account: '0123456789', category: 39, minAmount: 60, maxAmount: 160 },
    { name: 'כללית', vendor: 'discount', account: '0123456789', category: 39, minAmount: 50, maxAmount: 140 },
  ],
};

const SUBSCRIPTION_CHARGES = [
  { name: 'NETFLIX.COM', vendor: 'max', account: '1234', category: 49, amount: 49.90, day: 1 },
  { name: 'SPOTIFY', vendor: 'visaCal', account: '9012', category: 49, amount: 29.90, day: 1 },
  { name: 'APPLE.COM/BILL', vendor: 'max', account: '1234', category: 49, amount: 19.90, day: 5 },
  { name: 'AMAZON PRIME', vendor: 'visaCal', account: '9012', category: 49, amount: 14.90, day: 10 },
  { name: 'YOUTUBE PREMIUM', vendor: 'max', account: '1234', category: 49, amount: 29.90, day: 15 },
  { name: 'HOT MOBILE', vendor: 'discount', account: '0123456789', category: 25, amount: 99.90, day: 25 },
  { name: 'GYM_MEMBERSHIP', vendor: 'max', account: '1234', category: 44, amount: 189.00, day: 1 },
];

const FIXED_BILLS = [
  { name: 'שכירות', vendor: 'discount', account: '0123456789', category: 23, amount: 7000, variance: 150, day: 1, cadence: 'monthly' },
  { name: 'מעון יום', vendor: 'discount', account: '0123456789', category: 75, amount: 2800, variance: 200, day: 5, cadence: 'monthly' },
  { name: 'ביטוח בריאות', vendor: 'discount', account: '0123456789', category: 35, amount: 320, variance: 40, day: 2, cadence: 'monthly' },
  { name: 'תקשורת ביתית', vendor: 'discount', account: '0123456789', category: 25, amount: 210, variance: 30, day: 8, cadence: 'monthly' },
  { name: 'עיריית תל אביב', vendor: 'discount', account: '0123456789', category: 36, amount: 700, variance: 80, day: 15, cadence: 'bimonthly', offset: 0 },
  { name: 'חברת החשמל', vendor: 'discount', account: '0123456789', category: 26, amount: 420, variance: 80, day: 12, cadence: 'bimonthly', offset: 0 },
  { name: 'מי אביבים', vendor: 'discount', account: '0123456789', category: 27, amount: 160, variance: 30, day: 20, cadence: 'bimonthly', offset: 1 },
];

const INCOME_SOURCES = [
  { name: 'משכורת - חברת הייטק', vendor: 'discount', account: '0123456789', category: 90, amount: 28000, variance: 600, day: 10 },
  { name: 'משכורת - חברת מוצר', vendor: 'discount', account: '0123456789', category: 90, amount: 22000, variance: 500, day: 25 },
  { name: 'ביטוח לאומי - קצבת ילדים', vendor: 'discount', account: '0123456789', category: 94, amount: 400, variance: 40, day: 20 },
];

const INVESTMENT_TRANSFERS = [
  { name: 'הפרשה לפנסיה', vendor: 'discount', account: '0123456789', category: 100, amount: 2600, variance: 200, day: 16 },
  { name: 'העברה לקרן השתלמות', vendor: 'discount', account: '0123456789', category: 100, amount: 1800, variance: 150, day: 16 },
  { name: 'העברה לתיק השקעות', vendor: 'discount', account: '0123456789', category: 100, amount: 1500, variance: 300, day: 22 },
];

const VARIABLE_PLANS = [
  { merchants: MERCHANTS.groceries, count: [9, 12], dayRange: [1, 28], hourRange: [9, 20] },
  { merchants: MERCHANTS.restaurants, count: [4, 7], dayRange: [1, 28], hourRange: [11, 22] },
  { merchants: MERCHANTS.coffee, count: [6, 10], dayRange: [1, 28], hourRange: [7, 18] },
  { merchants: MERCHANTS.delivery, count: [2, 4], dayRange: [1, 28], hourRange: [18, 22] },
  { merchants: MERCHANTS.fuel, count: [4, 5], dayRange: [1, 28], hourRange: [8, 20] },
  { merchants: MERCHANTS.publicTransport, count: [4, 8], dayRange: [1, 28], hourRange: [6, 20] },
  { merchants: MERCHANTS.parking, count: [2, 5], dayRange: [1, 28], hourRange: [7, 21] },
  { merchants: MERCHANTS.taxi, count: [1, 3], dayRange: [1, 28], hourRange: [9, 23] },
  { merchants: MERCHANTS.wallets, count: [3, 6], dayRange: [1, 28], hourRange: [9, 21] },
  { merchants: MERCHANTS.pharmacy, count: [1, 3], dayRange: [1, 28], hourRange: [9, 20] },
  { merchants: MERCHANTS.health, count: [1, 2], dayRange: [1, 28], hourRange: [9, 18] },
  { merchants: MERCHANTS.clothing, count: [1, 1], probability: 0.6, dayRange: [5, 25], hourRange: [10, 20] },
  { merchants: MERCHANTS.electronics, count: [1, 1], probability: 0.35, dayRange: [5, 25], hourRange: [10, 20] },
  { merchants: MERCHANTS.home, count: [1, 1], probability: 0.3, dayRange: [5, 25], hourRange: [10, 20] },
];

const insertStmt = db.prepare(`
  INSERT INTO transactions (identifier, vendor, vendor_nickname, date, name, price, type, status, auto_categorized, confidence_score, account_number, category_definition_id, category_type, transaction_datetime)
  VALUES (@id, @vendor, @nickname, @date, @name, @price, @type, 'completed', 1, @confidence, @account, @categoryId, @categoryType, @datetime)
`);

const txns = [];
const monthlyBudgetSpend = new Map();

function getBudgetSpend(monthKey, categoryId) {
  const monthMap = monthlyBudgetSpend.get(monthKey);
  if (!monthMap) return 0;
  return monthMap.get(categoryId) || 0;
}

function addBudgetSpend(monthKey, categoryId, amount) {
  let monthMap = monthlyBudgetSpend.get(monthKey);
  if (!monthMap) {
    monthMap = new Map();
    monthlyBudgetSpend.set(monthKey, monthMap);
  }
  monthMap.set(categoryId, (monthMap.get(categoryId) || 0) + amount);
}

function addTransaction({ name, vendor, account, category, categoryType, amount, date, transactionType, confidence }) {
  const signedAmount = categoryType === 'income' ? Math.abs(amount) : -Math.abs(amount);
  txns.push({
    name,
    vendor,
    account,
    category,
    amount: signedAmount,
    txType: categoryType,
    date,
    transactionType: transactionType || (vendor === 'discount' ? 'transfer' : 'card'),
    confidence: confidence || randomBetween(0.85, 0.98),
  });
}

function addExpense(monthKey, item, amount, dateIso, options = {}) {
  const categoryId = options.categoryId || item.category;
  const minAmount = options.minAmount || item.minAmount || 0;
  let finalAmount = amount;
  if (!options.ignoreBudget) {
    const budget = BUDGET_LIMITS.get(categoryId);
    if (budget) {
      const spent = getBudgetSpend(monthKey, categoryId);
      const remaining = budget - spent;
      if (remaining <= 0) return false;
      finalAmount = Math.min(finalAmount, remaining);
      if (minAmount && finalAmount < minAmount * 0.75) return false;
    }
  }
  addTransaction({
    name: item.name,
    vendor: item.vendor,
    account: item.account,
    category: categoryId,
    categoryType: 'expense',
    amount: finalAmount,
    date: dateIso,
    transactionType: options.transactionType,
    confidence: options.confidence,
  });
  if (!options.ignoreBudget) {
    const budget = BUDGET_LIMITS.get(categoryId);
    if (budget) addBudgetSpend(monthKey, categoryId, finalAmount);
  }
  return true;
}

for (let month = 0; month < 5; month++) {
  const monthDate = monthDateFromBase(-month);
  const monthKey = monthKeyFrom(monthDate);

  INCOME_SOURCES.forEach((income) => {
    const txDate = dateInMonth(monthDate, income.day, [8, 12]);
    addTransaction({
      name: income.name,
      vendor: income.vendor,
      account: income.account,
      category: income.category,
      categoryType: 'income',
      amount: variance(income.amount, income.variance),
      date: txDate,
      transactionType: 'transfer',
      confidence: randomBetween(0.9, 0.99),
    });
  });

  INVESTMENT_TRANSFERS.forEach((investment) => {
    const txDate = dateInMonth(monthDate, investment.day, [9, 16]);
    addTransaction({
      name: investment.name,
      vendor: investment.vendor,
      account: investment.account,
      category: investment.category,
      categoryType: 'investment',
      amount: variance(investment.amount, investment.variance),
      date: txDate,
      transactionType: 'transfer',
      confidence: randomBetween(0.9, 0.99),
    });
  });

  FIXED_BILLS.forEach((bill) => {
    const shouldAdd = bill.cadence === 'monthly' || (bill.cadence === 'bimonthly' && month % 2 === bill.offset);
    if (!shouldAdd) return;
    const txDate = dateInMonth(monthDate, bill.day, [8, 14]);
    addExpense(monthKey, bill, variance(bill.amount, bill.variance), txDate, { confidence: randomBetween(0.9, 0.98) });
  });

  SUBSCRIPTION_CHARGES.forEach((sub) => {
    const txDate = dateInMonth(monthDate, sub.day, [6, 12]);
    addExpense(monthKey, sub, sub.amount, txDate, { confidence: randomBetween(0.93, 0.99) });
  });

  VARIABLE_PLANS.forEach((plan) => {
    if (plan.probability && rng() > plan.probability) return;
    const targetCount = randomInt(plan.count[0], plan.count[1]);
    let added = 0;
    let attempts = 0;
    while (added < targetCount && attempts < targetCount * 3) {
      attempts += 1;
      const item = pick(plan.merchants);
      const amount = money(randomBetween(item.minAmount, item.maxAmount));
      const txDate = dateRandomInMonth(monthDate, plan.dayRange, plan.hourRange);
      if (addExpense(monthKey, item, amount, txDate, { confidence: randomBetween(0.78, 0.95) })) {
        added += 1;
      }
    }
  });
}

// Insert all transactions (avoid explicit BEGIN; WAL on this FS rejects manual transactions)
let insertErrors = 0;
let firstError = null;
txns.forEach((t, i) => {
  try {
    insertStmt.run({
      id: generateId(i),
      vendor: t.vendor,
      nickname: t.vendor === 'discount' ? 'Discount' : t.vendor === 'max' ? 'Max' : 'Cal',
      date: t.date,
      name: t.name,
      price: t.amount,
      type: t.transactionType,
      confidence: t.confidence,
      account: t.account,
      categoryId: t.category,
      categoryType: t.txType,
      datetime: t.date
    });
  } catch (e) {
    insertErrors += 1;
    if (!firstError) firstError = e.message;
  }
});
if (insertErrors > 0) {
  console.log(`  Transaction insert warnings: ${insertErrors} failed (first: ${firstError})`);
}
console.log(`  Inserted ${txns.length - insertErrors} transactions`);

// Align chat message insights with seeded transactions
try {
  const convo = db.prepare("SELECT id FROM chat_conversations WHERE external_id = ?").get('conv-001');
  if (convo) {
    const chatMonthKey = monthKeyFrom(monthDateFromBase(-2));
    const prevMonthKey = monthKeyFrom(monthDateFromBase(-3));
    const spendByCategory = db.prepare(`
      SELECT COALESCE(-SUM(price), 0) AS total
      FROM transactions
      WHERE category_definition_id = ?
        AND price < 0
        AND date LIKE ?
    `);
    const spendByMerchant = db.prepare(`
      SELECT COALESCE(-SUM(price), 0) AS total
      FROM transactions
      WHERE category_definition_id = ?
        AND price < 0
        AND date LIKE ?
        AND name LIKE ?
    `);
    const restaurantsThis = spendByCategory.get(4, `${chatMonthKey}%`).total;
    const restaurantsPrev = spendByCategory.get(4, `${prevMonthKey}%`).total;
    const restaurantChange = restaurantsPrev > 0 ? ((restaurantsThis - restaurantsPrev) / restaurantsPrev) * 100 : 0;
    const restaurantDirection = restaurantChange >= 0 ? 'higher' : 'lower';
    const restaurantMsg = `Based on your transactions, you spent ${Math.round(restaurantsThis).toLocaleString('en-US')} ILS on restaurants this month. That's ${Math.round(Math.abs(restaurantChange))}% ${restaurantDirection} than last month.`;

    const groceryTotal = spendByCategory.get(3, `${chatMonthKey}%`).total;
    const ramiTotal = spendByMerchant.get(3, `${chatMonthKey}%`, 'רמי לוי%').total;
    const ramiShare = groceryTotal > 0 ? Math.round((ramiTotal / groceryTotal) * 100) : 0;
    const groceryMsg = `Your supermarket spending this month totals ${Math.round(groceryTotal).toLocaleString('en-US')} ILS. Rami Levy accounts for ${ramiShare}% of that spending.`;

    const assistantMsgs = db.prepare(`
      SELECT id FROM chat_messages
      WHERE conversation_id = ?
        AND role = 'assistant'
      ORDER BY created_at
    `).all(convo.id);

    if (assistantMsgs[0]) {
      db.prepare('UPDATE chat_messages SET content = ? WHERE id = ?').run(restaurantMsg, assistantMsgs[0].id);
    }
    if (assistantMsgs[1]) {
      db.prepare('UPDATE chat_messages SET content = ? WHERE id = ?').run(groceryMsg, assistantMsgs[1].id);
    }
  }
} catch (e) {
  console.log('  Chat message alignment skipped:', e.message);
}

// ============================================
// STEP 13: SEED USER PROFILE & INVESTMENTS
// ============================================
console.log('📋 Seeding user profile and investments...');

db.prepare(`
  INSERT OR REPLACE INTO user_profile (id, username, marital_status, age, occupation, monthly_income, family_status, location, industry, birth_date, children_count, household_size, home_ownership, education_level, employment_status)
  VALUES (1, 'Demo User', 'Married', 35, 'Software Engineer', 28000, 'married_with_children', 'Tel Aviv', 'Tech', '1991-03-15', 2, 4, 'rent', 'master', 'employed')
`).run();

// Seed spouse profile
db.prepare(`DELETE FROM spouse_profile WHERE user_profile_id = 1`).run();
db.prepare(`
  INSERT INTO spouse_profile (user_profile_id, name, birth_date, occupation, industry, monthly_income, employment_status, education_level)
  VALUES (1, 'שרה', '1993-07-22', 'Product Manager', 'Tech', 22000, 'employed', 'bachelor')
`).run();
console.log('  Inserted spouse profile');

// Seed children profiles
db.prepare(`DELETE FROM children_profile WHERE user_profile_id = 1`).run();
const insertChild = db.prepare(`
  INSERT INTO children_profile (user_profile_id, name, birth_date, gender, education_stage, special_needs)
  VALUES (@userId, @name, @birthDate, @gender, @educationStage, @specialNeeds)
`);

const CHILDREN = [
  { userId: 1, name: 'נועם', birthDate: '2019-04-10', gender: 'male', educationStage: 'preschool', specialNeeds: 0 },
  { userId: 1, name: 'מיכל', birthDate: '2022-01-15', gender: 'female', educationStage: 'daycare', specialNeeds: 0 },
];

CHILDREN.forEach((child) => {
  insertChild.run(child);
});
console.log(`  Inserted ${CHILDREN.length} children profiles`);

const INVESTMENT_ACCOUNTS = [
  { name: 'קרן השתלמות - מיטב', type: 'hishtalmut', institution: 'meitav', currency: 'ILS', is_liquid: 0, category: 'restricted' },
  { name: 'פנסיה - הראל', type: 'pension', institution: 'harel', currency: 'ILS', is_liquid: 0, category: 'restricted' },
  { name: 'קופת גמל - כלל', type: 'gemel', institution: 'clal', currency: 'ILS', is_liquid: 0, category: 'restricted' },
  { name: 'תיק השקעות - IBI', type: 'brokerage', institution: 'ibi', currency: 'ILS', is_liquid: 1, category: 'liquid' },
  { name: 'Interactive Brokers', type: 'brokerage', institution: 'interactive_brokers', currency: 'USD', is_liquid: 1, category: 'liquid' },
  { name: 'פיקדון בנקאי - דיסקונט', type: 'deposit', institution: 'discount', currency: 'ILS', is_liquid: 1, category: 'stability' },
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

const insertBankAccount = db.prepare(`
  INSERT OR IGNORE INTO investment_accounts (
    account_name, account_type, institution, account_number, currency,
    is_active, is_liquid, investment_category, notes
  ) VALUES (@name, @type, @institution, @accountNumber, @currency, 1, @isLiquid, @category, @notes)
`);

const bankCredential = db.prepare('SELECT id, nickname, bank_account_number FROM vendor_credentials WHERE vendor = ?').get('discount');
if (bankCredential) {
  insertBankAccount.run({
    name: bankCredential.nickname || 'דיסקונט - עו"ש',
    type: 'bank_balance',
    institution: 'discount',
    accountNumber: bankCredential.bank_account_number || '0123456789',
    currency: 'ILS',
    isLiquid: 1,
    category: 'cash',
    notes: `Auto-created for bank balance tracking. credential_id:${bankCredential.id}`,
  });
}

db.exec(`
  UPDATE investment_accounts
  SET institution_id = (
    SELECT id FROM institution_nodes
    WHERE vendor_code = investment_accounts.institution
      AND node_type = 'institution'
  )
  WHERE institution_id IS NULL
    AND institution IS NOT NULL
`);

console.log(`  Inserted user profile and ${INVESTMENT_ACCOUNTS.length + (bankCredential ? 1 : 0)} investment accounts`);

// Seed investment values and assets
console.log('📋 Seeding investment values...');

const insertHolding = db.prepare(`
  INSERT OR IGNORE INTO investment_holdings (
    account_id, asset_name, asset_type, units, current_value, cost_basis, as_of_date,
    notes, holding_type, interest_rate, maturity_date, status
  ) VALUES (
    @accountId, @assetName, @assetType, @units, @currentValue, @costBasis, @asOfDate,
    @notes, @holdingType, @interestRate, @maturityDate, @status
  )
`);

const insertAsset = db.prepare(`
  INSERT OR IGNORE INTO investment_assets (
    account_id, asset_symbol, asset_name, asset_type, units, average_cost, currency, notes
  ) VALUES (
    @accountId, @symbol, @name, @type, @units, @averageCost, @currency, @notes
  )
`);

const monthlyDates = [];
for (let i = 4; i >= 0; i -= 1) {
  monthlyDates.push(dateOnly(monthDateFromBase(-i)));
}
const latestSnapshotDate = dateOnly(BASE_DATE);
const includeLatestSnapshot = latestSnapshotDate !== monthlyDates[monthlyDates.length - 1];

function generateHoldingsSeries(plan, count) {
  const series = [];
  let currentValue = plan.baseValue;
  let currentCost = plan.baseCost;
  for (let i = 0; i < count; i += 1) {
    const costBasis = plan.costEqualsValue ? currentValue : currentCost;
    series.push({ value: money(currentValue), cost: money(costBasis) });
    const contribution = plan.monthlyContribution || 0;
    const growth = plan.growth || 0;
    const volatility = plan.volatility || 0;
    const shock = volatility ? (rng() * 2 - 1) * volatility : 0;
    const factor = 1 + growth + shock;
    const previousValue = factor !== 0 ? (currentValue - contribution) / factor : currentValue - contribution;
    currentValue = money(Math.max(previousValue, 0));
    if (!plan.lockCost) {
      currentCost = money(Math.max(currentCost - contribution, 0));
    }
  }
  return series.reverse();
}

const accounts = db.prepare(`
  SELECT id, account_name, account_type, institution, currency, investment_category, account_number
  FROM investment_accounts
  WHERE is_active = 1
`).all();

const plans = [
  {
    match: (acc) => acc.account_type === 'hishtalmut',
    baseValue: 165000,
    baseCost: 146000,
    monthlyContribution: 1800,
    growth: 0.0035,
    assetName: 'קרן השתלמות',
    assetType: 'fund',
    assets: [{ symbol: null, name: 'מסלול מנייתי', type: 'fund', units: 1, averageCost: 146000, currency: 'ILS' }],
  },
  {
    match: (acc) => acc.account_type === 'pension',
    baseValue: 320000,
    baseCost: 285000,
    monthlyContribution: 2600,
    growth: 0.003,
    assetName: 'פנסיה מקיפה',
    assetType: 'fund',
    assets: [{ symbol: null, name: 'מסלול כללי', type: 'fund', units: 1, averageCost: 285000, currency: 'ILS' }],
  },
  {
    match: (acc) => acc.account_type === 'gemel',
    baseValue: 92000,
    baseCost: 82000,
    monthlyContribution: 0,
    growth: 0.0032,
    assetName: 'קופת גמל להשקעה',
    assetType: 'fund',
    assets: [{ symbol: null, name: 'מסלול כללי', type: 'fund', units: 1, averageCost: 82000, currency: 'ILS' }],
  },
  {
    match: (acc) => acc.account_type === 'brokerage' && acc.institution === 'ibi',
    baseValue: 98000,
    baseCost: 90000,
    monthlyContribution: 1500,
    growth: 0.0045,
    assetName: 'תיק השקעות - IBI',
    assetType: 'portfolio',
    assets: [
      { symbol: 'TA125', name: 'ת"א 125 ETF', type: 'etf', units: 90, averageCost: 610, currency: 'ILS' },
      { symbol: 'SP500', name: 'S&P 500 ETF', type: 'etf', units: 45, averageCost: 760, currency: 'ILS' },
      { symbol: 'ILBOND', name: 'אג"ח ממשלתי', type: 'bond', units: 120, averageCost: 210, currency: 'ILS' },
    ],
  },
  {
    match: (acc) => acc.account_type === 'brokerage' && acc.institution === 'interactive_brokers',
    baseValue: 25000,
    baseCost: 22000,
    monthlyContribution: 0,
    growth: 0.005,
    assetName: 'Interactive Brokers',
    assetType: 'portfolio',
    assets: [
      { symbol: 'VTI', name: 'Vanguard Total Stock Market', type: 'etf', units: 45, averageCost: 210, currency: 'USD' },
      { symbol: 'VXUS', name: 'Vanguard Total International', type: 'etf', units: 90, averageCost: 58, currency: 'USD' },
      { symbol: 'BND', name: 'Vanguard Total Bond', type: 'etf', units: 80, averageCost: 70, currency: 'USD' },
    ],
  },
  {
    match: (acc) => acc.account_type === 'deposit',
    baseValue: 61000,
    baseCost: 60000,
    monthlyContribution: 0,
    growth: 0.0025,
    assetName: 'פיקדון בנקאי',
    assetType: 'deposit',
    holdingType: 'pikadon',
    interestRate: 3.4,
    maturityMonths: 9,
    lockCost: true,
    assets: [{ symbol: null, name: 'פיקדון בנקאי', type: 'deposit', units: 1, averageCost: 60000, currency: 'ILS' }],
  },
  {
    match: (acc) => acc.account_type === 'crypto',
    baseValue: 18000,
    baseCost: 20000,
    monthlyContribution: 0,
    growth: 0.0,
    volatility: 0.06,
    assetName: 'קריפטו',
    assetType: 'crypto',
    lockCost: true,
    assets: [
      { symbol: 'BTC', name: 'Bitcoin', type: 'crypto', units: 0.12, averageCost: 120000, currency: 'ILS' },
      { symbol: 'ETH', name: 'Ethereum', type: 'crypto', units: 1.8, averageCost: 6500, currency: 'ILS' },
    ],
  },
  {
    match: (acc) => acc.account_type === 'bank_balance',
    baseValue: 45000,
    baseCost: 45000,
    monthlyContribution: 0,
    growth: 0.0,
    volatility: 0.025,
    assetName: 'עו"ש',
    assetType: 'cash',
    costEqualsValue: true,
    lockCost: true,
    assets: [{ symbol: null, name: 'Bank Balance', type: 'cash', units: 45000, averageCost: null, currency: 'ILS' }],
  },
];

let holdingsCount = 0;
let assetsCount = 0;

plans.forEach((plan) => {
  const account = accounts.find(plan.match);
  if (!account) return;
  const monthlySeries = generateHoldingsSeries(plan, monthlyDates.length);
  monthlySeries.forEach((entry, idx) => {
    insertHolding.run({
      accountId: account.id,
      assetName: plan.assetName,
      assetType: plan.assetType,
      units: null,
      currentValue: entry.value,
      costBasis: entry.cost,
      asOfDate: monthlyDates[idx],
      notes: 'Demo snapshot',
      holdingType: plan.holdingType || 'standard',
      interestRate: plan.interestRate || null,
      maturityDate: plan.maturityMonths ? dateOnly(addMonths(BASE_DATE, plan.maturityMonths)) : null,
      status: plan.holdingType === 'pikadon' ? 'active' : 'active',
    });
    holdingsCount += 1;
  });

  if (includeLatestSnapshot) {
    const latestEntry = monthlySeries[monthlySeries.length - 1];
    const drift = plan.dailyDrift || 0.001;
    const driftFactor = 1 + (rng() * drift);
    const driftedValue = money(latestEntry.value * driftFactor);
    const driftedCost = plan.costEqualsValue ? driftedValue : latestEntry.cost;
    insertHolding.run({
      accountId: account.id,
      assetName: plan.assetName,
      assetType: plan.assetType,
      units: null,
      currentValue: driftedValue,
      costBasis: driftedCost,
      asOfDate: latestSnapshotDate,
      notes: 'Demo snapshot',
      holdingType: plan.holdingType || 'standard',
      interestRate: plan.interestRate || null,
      maturityDate: plan.maturityMonths ? dateOnly(addMonths(BASE_DATE, plan.maturityMonths)) : null,
      status: plan.holdingType === 'pikadon' ? 'active' : 'active',
    });
    holdingsCount += 1;
  }

  (plan.assets || []).forEach((asset) => {
    insertAsset.run({
      accountId: account.id,
      symbol: asset.symbol,
      name: asset.name,
      type: asset.type,
      units: asset.units,
      averageCost: asset.averageCost,
      currency: asset.currency || account.currency,
      notes: 'Demo holding',
    });
    assetsCount += 1;
  });
});

console.log(`  Inserted ${holdingsCount} investment holdings and ${assetsCount} assets`);

// Align investment chat summary with seeded holdings
try {
  const convo = db.prepare("SELECT id FROM chat_conversations WHERE external_id = ?").get('conv-003');
  if (convo) {
    const convoDateRow = db.prepare('SELECT created_at FROM chat_conversations WHERE id = ?').get(convo.id);
    const snapshots = db.prepare('SELECT DISTINCT as_of_date FROM investment_holdings ORDER BY as_of_date').all();
    if (snapshots.length > 0) {
      const targetDate = convoDateRow?.created_at ? convoDateRow.created_at.slice(0, 10) : snapshots[snapshots.length - 1].as_of_date;
      let latestIndex = -1;
      snapshots.forEach((snap, idx) => {
        if (snap.as_of_date <= targetDate) {
          latestIndex = idx;
        }
      });
      if (latestIndex === -1) latestIndex = snapshots.length - 1;
      const latestDate = snapshots[latestIndex].as_of_date;
      const prevDate = latestIndex > 0 ? snapshots[latestIndex - 1].as_of_date : latestDate;
      const totalAtDate = (date) => {
        const rows = db.prepare(`
          SELECT ia.currency, SUM(ih.current_value) AS total
          FROM investment_holdings ih
          JOIN investment_accounts ia ON ih.account_id = ia.id
          WHERE ih.as_of_date = ?
          GROUP BY ia.currency
        `).all(date);
        return rows.reduce((sum, row) => {
          if (row.currency === 'USD') return sum + Number(row.total || 0) * USD_ILS_RATE;
          return sum + Number(row.total || 0);
        }, 0);
      };
      const latestTotal = totalAtDate(latestDate);
      const prevTotal = totalAtDate(prevDate);
      const monthlyReturn = prevTotal > 0 ? ((latestTotal - prevTotal) / prevTotal) * 100 : 0;
      const portfolioMsg = `Portfolio summary: Total value ≈ ${Math.round(latestTotal).toLocaleString('en-US')} ILS. Month-over-month change: ${monthlyReturn.toFixed(1)}%.`;
      const assistantMsg = db.prepare(`
        SELECT id FROM chat_messages
        WHERE conversation_id = ?
          AND role = 'assistant'
        ORDER BY created_at
        LIMIT 1
      `).get(convo.id);
      if (assistantMsg) {
        db.prepare('UPDATE chat_messages SET content = ? WHERE id = ?').run(portfolioMsg, assistantMsg.id);
      }
    }
  }
} catch (e) {
  console.log('  Investment chat alignment skipped:', e.message);
}

// ============================================
// STEP 14: SEED CATEGORY BUDGETS
// ============================================
console.log('📋 Seeding category budgets...');

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
  chat_conversations: db.prepare('SELECT COUNT(*) as cnt FROM chat_conversations').get().cnt,
  donation_events: db.prepare('SELECT COUNT(*) as cnt FROM donation_events').get().cnt,
};

console.log('\nData summary:');
console.table(summary);

const dateRange = db.prepare('SELECT MIN(date) as min_date, MAX(date) as max_date FROM transactions').get();
console.log(`\nDate range: ${dateRange.min_date} to ${dateRange.max_date}`);

// Ensure spending category mappings exist so dashboard allocation renders immediately
console.log('\n📋 Initializing spending category mappings...');
try {
  const initScript =
    "const svc=require('./app/server/services/analytics/spending-categories.js'); const db=require('./app/server/services/database.js'); (async()=>{const res=await svc.initializeSpendingCategories(); console.log('  Spending categories initialized:', res); await db.close();})().catch(err=>{console.error(err); process.exit(1);});";

  execFileSync(process.execPath, ['-e', initScript], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, SQLITE_DB_PATH: DB_PATH, ELECTRON_RUN_AS_NODE: '1' },
  });
} catch (e) {
  console.log('  Spending categories init skipped:', e.message);
}

db.close();
console.log('\nDone!');
