#!/usr/bin/env node
/**
 * Initialise a fresh SQLite database for ShekelSync.
 *
 * Creates the full application schema (including foreign keys and indexes)
 * and seeds public, non-sensitive reference data such as category definitions.
 *
 * Usage:
 *   node scripts/init_sqlite_db.js [--output dist/clarify.sqlite] [--force]
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_NODE_MODULES = path.join(PROJECT_ROOT, 'app', 'node_modules');
const Database = require(path.join(APP_NODE_MODULES, 'better-sqlite3'));

const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

function ensureColumnExists(db, tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((col) => col.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
}

function applySchemaUpgrades(db) {
  ensureColumnExists(
    db,
    'category_definitions',
    'name_fr',
    'name_fr TEXT'
  );
  db.exec(`
    UPDATE category_definitions
    SET name_fr = name
    WHERE name_fr IS NULL
  `);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let output = DEFAULT_DB_PATH;
  let force = false;
  let withDemo = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--output':
      case '-o': {
        if (i + 1 >= args.length) {
          throw new Error(`Missing value after ${arg}`);
        }
        output = path.resolve(PROJECT_ROOT, args[i + 1]);
        i += 1;
        break;
      }
      case '--force':
      case '-f':
        force = true;
        break;
      case '--with-demo':
        withDemo = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { output, force, withDemo };
}

function printHelp() {
  console.log(`Usage: node scripts/init_sqlite_db.js [options]

Options:
  -o, --output <path>   Output database file (default: dist/clarify.sqlite)
  -f, --force           Overwrite existing database file
      --with-demo       Seed demo credentials/pairings (local QA only)
  -h, --help            Show this help message
`);
}

const TABLE_DEFINITIONS = [
  `CREATE TABLE IF NOT EXISTS institution_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      vendor_code TEXT UNIQUE,
      node_type TEXT NOT NULL CHECK (node_type IN ('root','group','institution')),
      institution_type TEXT,
      category TEXT,
      subcategory TEXT,
      display_name_he TEXT NOT NULL,
      display_name_en TEXT NOT NULL,
      is_scrapable INTEGER NOT NULL DEFAULT 0 CHECK (is_scrapable IN (0,1)),
      logo_url TEXT,
      scraper_company_id TEXT,
      credential_fields TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      display_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      hierarchy_path TEXT,
      depth_level INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((node_type = 'root' AND parent_id IS NULL) OR (node_type != 'root' AND parent_id IS NOT NULL)),
      CHECK ((node_type = 'institution' AND vendor_code IS NOT NULL) OR (node_type != 'institution' AND vendor_code IS NULL)),
      FOREIGN KEY (parent_id) REFERENCES institution_nodes(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS category_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_en TEXT,
      name_fr TEXT,
      category_type TEXT NOT NULL CHECK (category_type IN ('expense','income','investment')),
      parent_id INTEGER,
      display_order INTEGER NOT NULL DEFAULT 0,
      icon TEXT,
      color TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      is_counted_as_income INTEGER NOT NULL DEFAULT 1 CHECK (is_counted_as_income IN (0,1)),
      hierarchy_path TEXT,
      depth_level INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, parent_id, category_type),
      FOREIGN KEY (parent_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS category_mapping (
      old_category_name TEXT PRIMARY KEY,
      category_definition_id INTEGER NOT NULL,
      notes TEXT,
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      marital_status TEXT,
      age INTEGER,
      occupation TEXT,
      monthly_income REAL,
      family_status TEXT,
      location TEXT,
      industry TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      birth_date TEXT,
      children_count INTEGER NOT NULL DEFAULT 0,
      household_size INTEGER NOT NULL DEFAULT 1,
      home_ownership TEXT,
      education_level TEXT,
      employment_status TEXT,
      onboarding_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_dismissed IN (0,1)),
      onboarding_dismissed_at TEXT,
      last_active_at TEXT
    );`,
  `CREATE TABLE IF NOT EXISTS spouse_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_profile_id INTEGER NOT NULL,
      name TEXT,
      birth_date TEXT,
      occupation TEXT,
      industry TEXT,
      monthly_income REAL,
      employment_status TEXT,
      education_level TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_profile_id),
      FOREIGN KEY (user_profile_id) REFERENCES user_profile(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS children_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_profile_id INTEGER NOT NULL,
      name TEXT,
      birth_date TEXT NOT NULL,
      gender TEXT,
      education_stage TEXT,
      special_needs INTEGER NOT NULL DEFAULT 0 CHECK (special_needs IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_profile_id) REFERENCES user_profile(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS vendor_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_number TEXT,
      username TEXT,
      vendor TEXT NOT NULL,
      password TEXT,
      card6_digits TEXT,
      nickname TEXT,
      bank_account_number TEXT,
      identification_code TEXT,
      current_balance REAL,
      balance_updated_at TEXT,
      last_scrape_success TEXT,
      last_scrape_attempt TEXT,
      last_scrape_status TEXT NOT NULL DEFAULT 'never',
      institution_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(id_number, username, vendor),
      FOREIGN KEY (institution_id) REFERENCES institution_nodes(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS transactions (
      identifier TEXT NOT NULL,
      vendor TEXT NOT NULL,
      vendor_nickname TEXT,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      type TEXT NOT NULL,
      processed_date TEXT,
      original_amount REAL,
      original_currency TEXT,
      charged_currency TEXT,
      memo TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      merchant_name TEXT,
      auto_categorized INTEGER NOT NULL DEFAULT 0 CHECK (auto_categorized IN (0,1)),
      confidence_score REAL NOT NULL DEFAULT 0.0,
      account_number TEXT,
      category_definition_id INTEGER,
      category_type TEXT,
      transaction_datetime TEXT,
      processed_datetime TEXT,
      is_pikadon_related INTEGER NOT NULL DEFAULT 0 CHECK (is_pikadon_related IN (0,1)),
      PRIMARY KEY (identifier, vendor),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS categorization_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_pattern TEXT NOT NULL,
      target_category TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      category_definition_id INTEGER,
      category_type TEXT,
      category_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name_pattern, target_category),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS category_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_definition_id INTEGER NOT NULL,
      period_type TEXT NOT NULL CHECK (period_type IN ('weekly','monthly','yearly')),
      budget_limit REAL NOT NULL CHECK (budget_limit > 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category_definition_id, period_type),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS investment_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      institution TEXT,
      account_number TEXT,
      currency TEXT NOT NULL DEFAULT 'ILS',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      notes TEXT,
      institution_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_liquid INTEGER,
      investment_category TEXT,
      FOREIGN KEY (institution_id) REFERENCES institution_nodes(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS investment_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      asset_symbol TEXT,
      asset_name TEXT NOT NULL,
      asset_type TEXT,
      units REAL NOT NULL,
      average_cost REAL,
      currency TEXT NOT NULL DEFAULT 'USD',
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS investment_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      asset_name TEXT,
      asset_type TEXT,
      units REAL,
      current_value REAL NOT NULL,
      cost_basis REAL,
      as_of_date TEXT NOT NULL,
      notes TEXT,
      holding_type TEXT DEFAULT 'standard',
      deposit_transaction_id TEXT,
      deposit_transaction_vendor TEXT,
      return_transaction_id TEXT,
      return_transaction_vendor TEXT,
      maturity_date TEXT,
      interest_rate REAL,
      status TEXT DEFAULT 'active',
      parent_pikadon_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, as_of_date),
      FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_pikadon_id) REFERENCES investment_holdings(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS account_transaction_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      pattern TEXT NOT NULL,
      pattern_type TEXT NOT NULL DEFAULT 'substring',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_matched TEXT,
      match_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(account_id, pattern),
      FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS pending_transaction_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_identifier TEXT NOT NULL,
      transaction_vendor TEXT NOT NULL,
      transaction_name TEXT,
      transaction_date TEXT,
      transaction_amount REAL,
      suggested_account_id INTEGER,
      suggested_account_type TEXT,
      suggested_institution TEXT,
      suggested_account_name TEXT,
      confidence REAL,
      match_reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      dismiss_count INTEGER DEFAULT 0,
      last_dismissed_at TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (transaction_identifier, transaction_vendor)
        REFERENCES transactions(identifier, vendor)
        ON DELETE CASCADE,
      FOREIGN KEY (suggested_account_id) REFERENCES investment_accounts(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS transaction_account_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_identifier TEXT NOT NULL,
      transaction_vendor TEXT NOT NULL,
      transaction_date TEXT,
      account_id INTEGER NOT NULL,
      link_method TEXT NOT NULL DEFAULT 'manual',
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT NOT NULL DEFAULT 'system',
      UNIQUE(transaction_identifier, transaction_vendor),
      FOREIGN KEY (transaction_identifier, transaction_vendor)
        REFERENCES transactions(identifier, vendor)
        ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS account_pairings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card_vendor TEXT NOT NULL,
      credit_card_account_number TEXT,
      bank_vendor TEXT NOT NULL,
      bank_account_number TEXT,
      match_patterns TEXT,
      is_active INTEGER DEFAULT 1,
      discrepancy_acknowledged INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(credit_card_vendor, credit_card_account_number, bank_vendor, bank_account_number)
    );`,
  `CREATE TABLE IF NOT EXISTS account_pairing_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pairing_id INTEGER,
      action TEXT NOT NULL,
      transaction_count INTEGER DEFAULT 0,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (pairing_id) REFERENCES account_pairings(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS credit_card_expense_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repayment_txn_id TEXT NOT NULL,
      repayment_vendor TEXT NOT NULL,
      repayment_date TEXT NOT NULL,
      repayment_amount REAL NOT NULL,
      card_number TEXT,
      expense_txn_id TEXT NOT NULL,
      expense_vendor TEXT NOT NULL,
      expense_date TEXT NOT NULL,
      expense_amount REAL NOT NULL,
      match_confidence REAL DEFAULT 1.0,
      match_method TEXT DEFAULT 'manual',
      matched_at TEXT NOT NULL,
      notes TEXT,
      UNIQUE(repayment_txn_id, repayment_vendor, expense_txn_id, expense_vendor)
    );`,
  `CREATE TABLE IF NOT EXISTS scrape_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      triggered_by TEXT,
      vendor TEXT NOT NULL,
      start_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      credential_id INTEGER
    );`,
  // Spending Category Intelligence Tables
  `CREATE TABLE IF NOT EXISTS spending_category_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_definition_id INTEGER NOT NULL UNIQUE,
      spending_category TEXT CHECK(spending_category IN ('growth', 'stability', 'essential', 'reward')),
      variability_type TEXT NOT NULL DEFAULT 'variable' CHECK(variability_type IN ('fixed', 'variable', 'seasonal')),
      is_auto_detected INTEGER NOT NULL DEFAULT 1 CHECK(is_auto_detected IN (0, 1)),
      target_percentage REAL CHECK(target_percentage >= 0 AND target_percentage <= 100),
      detection_confidence REAL DEFAULT 0.0 CHECK(detection_confidence >= 0 AND detection_confidence <= 1),
      user_overridden INTEGER NOT NULL DEFAULT 0 CHECK(user_overridden IN (0, 1)),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS spending_category_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spending_category TEXT NOT NULL UNIQUE CHECK(spending_category IN ('growth', 'stability', 'essential', 'reward')),
      target_percentage REAL NOT NULL CHECK(target_percentage >= 0 AND target_percentage <= 100),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  // Quest System Tables
  `CREATE TABLE IF NOT EXISTS smart_action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL CHECK(action_type IN (
        'quest_reduce_spending', 'quest_savings_target', 'quest_budget_adherence', 
        'quest_set_budget', 'quest_reduce_fixed_cost', 'quest_income_goal'
      )),
      trigger_category_id INTEGER,
      severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high')),
      title TEXT NOT NULL,
      description TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      dismissed_at TEXT,
      user_status TEXT NOT NULL DEFAULT 'active' CHECK(user_status IN ('active', 'dismissed', 'resolved', 'accepted', 'failed')),
      metadata TEXT,
      potential_impact REAL,
      detection_confidence REAL DEFAULT 0.5 CHECK(detection_confidence >= 0 AND detection_confidence <= 1),
      is_recurring INTEGER NOT NULL DEFAULT 0 CHECK(is_recurring IN (0, 1)),
      recurrence_key TEXT,
      -- Quest-specific columns
      deadline TEXT,
      accepted_at TEXT,
      points_reward INTEGER DEFAULT 0,
      points_earned INTEGER DEFAULT 0,
      completion_criteria TEXT,
      completion_result TEXT,
      quest_difficulty TEXT CHECK(quest_difficulty IS NULL OR quest_difficulty IN ('easy', 'medium', 'hard')),
      quest_duration_days INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (trigger_category_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS action_item_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      smart_action_item_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created', 'dismissed', 'resolved', 'accepted', 'completed', 'failed')),
      previous_status TEXT,
      new_status TEXT,
      user_note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (smart_action_item_id) REFERENCES smart_action_items(id) ON DELETE CASCADE
    );`,
  // User Quest Stats Table (single-row for gamification)
  `CREATE TABLE IF NOT EXISTS user_quest_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_points INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      quests_completed INTEGER NOT NULL DEFAULT 0,
      quests_failed INTEGER NOT NULL DEFAULT 0,
      quests_declined INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      last_completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  `INSERT OR IGNORE INTO user_quest_stats (id, total_points, current_streak, best_streak, quests_completed, quests_failed, quests_declined, level)
    VALUES (1, 0, 0, 0, 0, 0, 0, 1);`
];

const INDEX_STATEMENTS = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_institution_nodes_vendor_code ON institution_nodes (vendor_code);',
  'CREATE INDEX IF NOT EXISTS idx_institution_nodes_type ON institution_nodes (node_type);',
  'CREATE INDEX IF NOT EXISTS idx_institution_nodes_parent ON institution_nodes (parent_id);',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_institution_nodes_path ON institution_nodes (hierarchy_path);',
  'CREATE INDEX IF NOT EXISTS idx_institution_nodes_category ON institution_nodes (category);',
  'CREATE INDEX IF NOT EXISTS idx_institution_nodes_active ON institution_nodes (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_institution_nodes_scrapable ON institution_nodes (is_scrapable);',
  'CREATE INDEX IF NOT EXISTS idx_categorization_rules_active ON categorization_rules (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_categorization_rules_active_priority ON categorization_rules (is_active, priority DESC) WHERE (is_active = 1);',
  'CREATE INDEX IF NOT EXISTS idx_categorization_rules_pattern ON categorization_rules (name_pattern);',
  'CREATE INDEX IF NOT EXISTS idx_category_budgets_active ON category_budgets (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_category_budgets_category_id ON category_budgets (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_category_definitions_active ON category_definitions (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_category_definitions_parent ON category_definitions (parent_id);',
  'CREATE INDEX IF NOT EXISTS idx_category_definitions_type ON category_definitions (category_type);',
  'CREATE INDEX IF NOT EXISTS idx_category_hierarchy_path ON category_definitions (hierarchy_path);',
  'CREATE INDEX IF NOT EXISTS idx_category_depth_level ON category_definitions (depth_level);',
  'CREATE INDEX IF NOT EXISTS idx_category_mapping_category ON category_mapping (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_children_birth_date ON children_profile (birth_date);',
  'CREATE INDEX IF NOT EXISTS idx_children_education_stage ON children_profile (education_stage);',
  'CREATE INDEX IF NOT EXISTS idx_children_profile_user_id ON children_profile (user_profile_id);',
  'CREATE INDEX IF NOT EXISTS idx_investment_accounts_active ON investment_accounts (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_investment_accounts_category ON investment_accounts (investment_category) WHERE investment_category IS NOT NULL;',
  'CREATE INDEX IF NOT EXISTS idx_investment_accounts_is_liquid ON investment_accounts (is_liquid) WHERE is_liquid IS NOT NULL;',
  'CREATE INDEX IF NOT EXISTS idx_investment_accounts_type ON investment_accounts (account_type);',
  'CREATE INDEX IF NOT EXISTS idx_investment_assets_account ON investment_assets (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_investment_assets_active ON investment_assets (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_investment_assets_symbol ON investment_assets (asset_symbol);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_account ON investment_holdings (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_date ON investment_holdings (as_of_date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_type ON investment_holdings (holding_type);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_status ON investment_holdings (status);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_maturity ON investment_holdings (maturity_date);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_deposit_txn ON investment_holdings (deposit_transaction_id, deposit_transaction_vendor);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_parent_pikadon ON investment_holdings (parent_pikadon_id);',
  'CREATE INDEX IF NOT EXISTS idx_patterns_account ON account_transaction_patterns (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_transaction_suggestions (created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_transaction_suggestions (status);',
  'CREATE INDEX IF NOT EXISTS idx_pending_account_type ON pending_transaction_suggestions (suggested_account_type);',
  'CREATE INDEX IF NOT EXISTS idx_pending_dismissed ON pending_transaction_suggestions (dismiss_count, last_dismissed_at);',
  'CREATE INDEX IF NOT EXISTS idx_scrape_events_created_at ON scrape_events (created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_scrape_events_vendor ON scrape_events (vendor);',
  'CREATE INDEX IF NOT EXISTS idx_scrape_events_credential_id ON scrape_events (credential_id);',
  'CREATE INDEX IF NOT EXISTS idx_scrape_events_cred_date ON scrape_events (credential_id, created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_spouse_profile_user_id ON spouse_profile (user_profile_id);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_account_number ON transactions (account_number);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category_def ON transactions (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions (category_definition_id, date);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_price_direction ON transactions (category_definition_id, price);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category_type ON transactions (category_type);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_desc ON transactions (date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_vendor ON transactions (date, vendor);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_datetime ON transactions (transaction_datetime);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_price ON transactions (price);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions (vendor);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor_date ON transactions (vendor, date);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor_datetime ON transactions (vendor, transaction_datetime DESC);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor_nickname ON transactions (vendor, vendor_nickname);',
  'CREATE INDEX IF NOT EXISTS idx_txn_links_account ON transaction_account_links (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_txn_links_identifier ON transaction_account_links (transaction_identifier);',
  'CREATE INDEX IF NOT EXISTS idx_vendor_credentials_last_scrape ON vendor_credentials (vendor, last_scrape_success DESC);',
  'CREATE INDEX IF NOT EXISTS idx_vendor_credentials_vendor ON vendor_credentials (vendor);',
  'CREATE INDEX IF NOT EXISTS idx_pairings_active ON account_pairings(is_active);',
  'CREATE INDEX IF NOT EXISTS idx_pairings_credit_card ON account_pairings(credit_card_vendor, credit_card_account_number);',
  'CREATE INDEX IF NOT EXISTS idx_pairings_bank ON account_pairings(bank_vendor, bank_account_number);',
  'CREATE INDEX IF NOT EXISTS idx_pairing_log_pairing_id ON account_pairing_log(pairing_id);',
  'CREATE INDEX IF NOT EXISTS idx_pairing_log_created_at ON account_pairing_log(created_at);',
  'CREATE INDEX IF NOT EXISTS idx_cc_matches_repayment ON credit_card_expense_matches(repayment_txn_id, repayment_vendor);',
  'CREATE INDEX IF NOT EXISTS idx_cc_matches_expense ON credit_card_expense_matches(expense_txn_id, expense_vendor);',
  'CREATE INDEX IF NOT EXISTS idx_cc_matches_dates ON credit_card_expense_matches(repayment_date, expense_date);',
  'CREATE INDEX IF NOT EXISTS idx_cc_matches_method ON credit_card_expense_matches(match_method);',
  // Spending Category Intelligence Indexes
  'CREATE INDEX IF NOT EXISTS idx_spending_category_mappings_category_id ON spending_category_mappings(category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_spending_category_mappings_spending_cat ON spending_category_mappings(spending_category);',
  'CREATE INDEX IF NOT EXISTS idx_spending_category_mappings_variability ON spending_category_mappings(variability_type);',
  'CREATE INDEX IF NOT EXISTS idx_spending_mappings_unallocated ON spending_category_mappings(spending_category) WHERE spending_category IS NULL;',
  // Smart Action Items Indexes
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_type ON smart_action_items(action_type);',
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_status ON smart_action_items(user_status);',
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_severity ON smart_action_items(severity);',
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_category ON smart_action_items(trigger_category_id);',
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_detected_at ON smart_action_items(detected_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_recurrence ON smart_action_items(recurrence_key, user_status);',
  'CREATE INDEX IF NOT EXISTS idx_action_item_history_item_id ON action_item_history(smart_action_item_id, created_at DESC);',
  // Quest-specific indexes
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_deadline ON smart_action_items(deadline);',
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_accepted_at ON smart_action_items(accepted_at);',
  'CREATE INDEX IF NOT EXISTS idx_smart_action_items_quest_difficulty ON smart_action_items(quest_difficulty);'
];

const INSTITUTION_GROUPS = [
  { key: 'bank', parentKey: null, path: '/bank', nodeType: 'root', nameHe: 'בנקים', nameEn: 'Banks', institutionType: 'bank', category: 'banking', subcategory: null, displayOrder: 10, depth: 0 },
  { key: 'credit_card', parentKey: null, path: '/credit_card', nodeType: 'root', nameHe: 'כרטיסי אשראי', nameEn: 'Credit Cards', institutionType: 'credit_card', category: 'banking', subcategory: null, displayOrder: 20, depth: 0 },
  { key: 'investment', parentKey: null, path: '/investment', nodeType: 'root', nameHe: 'השקעות', nameEn: 'Investments', institutionType: 'investment', category: 'investments', subcategory: null, displayOrder: 30, depth: 0 },
  { key: 'investment_liquid', parentKey: 'investment', path: '/investment/liquid', nodeType: 'group', nameHe: 'השקעות נזילות', nameEn: 'Liquid Investments', institutionType: 'investment', category: 'investments', subcategory: 'liquid', displayOrder: 31, depth: 1 },
  { key: 'investment_liquid_brokerage', parentKey: 'investment_liquid', path: '/investment/liquid/brokerage', nodeType: 'group', nameHe: 'ברוקראז׳', nameEn: 'Brokerage', institutionType: 'broker', category: 'brokerage', subcategory: 'brokerage', displayOrder: 32, depth: 2 },
  { key: 'investment_liquid_crypto', parentKey: 'investment_liquid', path: '/investment/liquid/crypto', nodeType: 'group', nameHe: 'קריפטו', nameEn: 'Crypto', institutionType: 'crypto', category: 'crypto', subcategory: 'crypto', displayOrder: 33, depth: 2 },
  { key: 'investment_liquid_cash', parentKey: 'investment_liquid', path: '/investment/liquid/cash', nodeType: 'group', nameHe: 'מזומן ופיקדונות', nameEn: 'Cash & Deposits', institutionType: 'investment', category: 'investments', subcategory: 'cash', displayOrder: 34, depth: 2 },
  { key: 'investment_long_term', parentKey: 'investment', path: '/investment/long_term', nodeType: 'group', nameHe: 'חיסכון ארוך טווח', nameEn: 'Long-Term Savings', institutionType: 'investment', category: 'investments', subcategory: 'long_term', displayOrder: 35, depth: 1 },
  { key: 'investment_long_term_pension', parentKey: 'investment_long_term', path: '/investment/long_term/pension', nodeType: 'group', nameHe: 'פנסיה', nameEn: 'Pension', institutionType: 'investment', category: 'investments', subcategory: 'pension', displayOrder: 36, depth: 2 },
  { key: 'investment_long_term_provident', parentKey: 'investment_long_term', path: '/investment/long_term/provident', nodeType: 'group', nameHe: 'גמל / השתלמות', nameEn: 'Provident / Study Fund', institutionType: 'investment', category: 'investments', subcategory: 'provident', displayOrder: 37, depth: 2 },
  { key: 'investment_long_term_other', parentKey: 'investment_long_term', path: '/investment/long_term/other', nodeType: 'group', nameHe: 'השקעות אחרות', nameEn: 'Other Long-Term', institutionType: 'investment', category: 'investments', subcategory: 'other', displayOrder: 38, depth: 2 },
  { key: 'insurance', parentKey: null, path: '/insurance', nodeType: 'root', nameHe: 'ביטוח', nameEn: 'Insurance', institutionType: 'insurance', category: 'insurance', subcategory: null, displayOrder: 40, depth: 0 }
];

const FINANCIAL_INSTITUTIONS = [
  // ========== BANKS ==========
  // Regular Banks
  { code: 'hapoalim', type: 'bank', nameHe: 'בנק הפועלים', nameEn: 'Bank Hapoalim', category: 'banking', scrapable: 1, scraperCompanyId: 'hapoalim', credentialFields: '["userCode","password"]', displayOrder: 10 },
  { code: 'leumi', type: 'bank', nameHe: 'בנק לאומי', nameEn: 'Bank Leumi', category: 'banking', scrapable: 1, scraperCompanyId: 'leumi', credentialFields: '["username","password","bankAccountNumber"]', displayOrder: 20 },
  { code: 'mizrahi', type: 'bank', nameHe: 'בנק מזרחי טפחות', nameEn: 'Mizrahi Tefahot Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'mizrahi', credentialFields: '["username","password"]', displayOrder: 30 },
  { code: 'discount', type: 'bank', nameHe: 'בנק דיסקונט', nameEn: 'Discount Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'discount', credentialFields: '["id","password","num"]', displayOrder: 40 },
  { code: 'otsarHahayal', type: 'bank', nameHe: 'בנק אוצר החייל', nameEn: 'Bank Otsar Hahayal', category: 'banking', scrapable: 1, scraperCompanyId: 'otsarHahayal', credentialFields: '["username","password"]', displayOrder: 50 },
  { code: 'beinleumi', type: 'bank', nameHe: 'בנק בינלאומי', nameEn: 'First International Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'beinleumi', credentialFields: '["username","password"]', displayOrder: 60 },
  { code: 'massad', type: 'bank', nameHe: 'בנק מסד', nameEn: 'Bank Massad', category: 'banking', scrapable: 1, scraperCompanyId: 'massad', credentialFields: '["username","password"]', displayOrder: 70 },
  { code: 'yahav', type: 'bank', nameHe: 'בנק יהב', nameEn: 'Bank Yahav', category: 'banking', scrapable: 1, scraperCompanyId: 'yahav', credentialFields: '["username","password","nationalID"]', displayOrder: 80 },
  { code: 'union', type: 'bank', nameHe: 'בנק יוניון', nameEn: 'Union Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'union', credentialFields: '["username","password"]', displayOrder: 90 },
  { code: 'mercantile', type: 'bank', nameHe: 'בנק מרכנתיל', nameEn: 'Mercantile Discount Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'mercantile', credentialFields: '["id","password","num"]', displayOrder: 100 },

  // Other Banks
  { code: 'beyahadBishvilha', type: 'bank', nameHe: 'בנק ביחד בשבילך', nameEn: 'Beyahad Bishvilha Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'beyahadBishvilha', credentialFields: '["id","password"]', displayOrder: 110 },
  { code: 'behatsdaa', type: 'bank', nameHe: 'בנק בהצדעה', nameEn: 'Behatsdaa Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'behatsdaa', credentialFields: '["id","password"]', displayOrder: 120 },
  { code: 'pagi', type: 'bank', nameHe: 'בנק פאגי', nameEn: 'Pagi Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'pagi', credentialFields: '["username","password"]', displayOrder: 130 },
  { code: 'oneZero', type: 'bank', nameHe: 'וואן זירו', nameEn: 'One Zero Bank', category: 'banking', scrapable: 1, scraperCompanyId: 'oneZero', credentialFields: '["email","password","otpCode","otpToken"]', displayOrder: 140 },

  // ========== CREDIT CARDS ==========
  { code: 'visaCal', type: 'credit_card', nameHe: 'ויזה כאל', nameEn: 'Visa Cal', category: 'banking', scrapable: 1, scraperCompanyId: 'visaCal', credentialFields: '["username","password"]', displayOrder: 200 },
  { code: 'max', type: 'credit_card', nameHe: 'מקס', nameEn: 'Max', category: 'banking', scrapable: 1, scraperCompanyId: 'max', credentialFields: '["username","password"]', displayOrder: 210 },
  { code: 'isracard', type: 'credit_card', nameHe: 'ישראכרט', nameEn: 'Isracard', category: 'banking', scrapable: 1, scraperCompanyId: 'isracard', credentialFields: '["id","card6Digits","password"]', displayOrder: 220 },
  { code: 'amex', type: 'credit_card', nameHe: 'אמריקן אקספרס', nameEn: 'American Express', category: 'banking', scrapable: 1, scraperCompanyId: 'amex', credentialFields: '["id","card6Digits","password"]', displayOrder: 230 },

  // ========== INVESTMENTS (Manual Entry) ==========
  { code: 'clal_pension', type: 'investment', nameHe: 'כלל פנסיה', nameEn: 'Clal Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 300 },
  { code: 'migdal_pension', type: 'investment', nameHe: 'מגדל פנסיה', nameEn: 'Migdal Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 310 },
  { code: 'menora_pension', type: 'investment', nameHe: 'מנורה פנסיה', nameEn: 'Menora Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 320 },
  { code: 'harel_pension', type: 'investment', nameHe: 'הראל פנסיה', nameEn: 'Harel Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 330 },
  { code: 'phoenix_pension', type: 'investment', nameHe: 'פניקס פנסיה', nameEn: 'Phoenix Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 340 },
  { code: 'ayalon_pension', type: 'investment', nameHe: 'איילון פנסיה', nameEn: 'Ayalon Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 350 },
  { code: 'meitav_pension', type: 'investment', nameHe: 'מיטב פנסיה', nameEn: 'Meitav Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 360 },
  { code: 'altshuler_pension', type: 'investment', nameHe: 'אלטשולר שחם פנסיה', nameEn: 'Altshuler Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 370 },
  { code: 'psagot_pension', type: 'investment', nameHe: 'פסגות פנסיה', nameEn: 'Psagot Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 380 },
  { code: 'more_pension', type: 'investment', nameHe: 'מור פנסיה', nameEn: 'More Pension', category: 'investments', subcategory: 'pension', scrapable: 0, displayOrder: 390 },

  { code: 'clal_provident', type: 'investment', nameHe: 'כלל קופת גמל / השתלמות', nameEn: 'Clal Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 400 },
  { code: 'migdal_provident', type: 'investment', nameHe: 'מגדל קופת גמל / השתלמות', nameEn: 'Migdal Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 410 },
  { code: 'menora_provident', type: 'investment', nameHe: 'מנורה קופת גמל / השתלמות', nameEn: 'Menora Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 420 },
  { code: 'harel_provident', type: 'investment', nameHe: 'הראל קופת גמל / השתלמות', nameEn: 'Harel Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 430 },
  { code: 'phoenix_provident', type: 'investment', nameHe: 'פניקס קופת גמל / השתלמות', nameEn: 'Phoenix Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 440 },
  { code: 'ayalon_provident', type: 'investment', nameHe: 'איילון קופת גמל / השתלמות', nameEn: 'Ayalon Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 450 },
  { code: 'meitav_provident', type: 'investment', nameHe: 'מיטב קופת גמל / השתלמות', nameEn: 'Meitav Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 460 },
  { code: 'altshuler_provident', type: 'investment', nameHe: 'אלטשולר שחם קופת גמל / השתלמות', nameEn: 'Altshuler Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 470 },
  { code: 'psagot_provident', type: 'investment', nameHe: 'פסגות קופת גמל / השתלמות', nameEn: 'Psagot Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 480 },
  { code: 'more_provident', type: 'investment', nameHe: 'מור קופת גמל / השתלמות', nameEn: 'More Provident / Study Fund', category: 'investments', subcategory: 'provident', scrapable: 0, displayOrder: 490 },

  { code: 'bank_deposit', type: 'investment', nameHe: 'פיקדון בנקאי', nameEn: 'Bank Deposit', category: 'investments', subcategory: 'cash', scrapable: 0, displayOrder: 500 },
  { code: 'investment_unknown', type: 'investment', nameHe: 'השקעה לא מזוהה', nameEn: 'Unknown Investment', category: 'investments', subcategory: 'other', scrapable: 0, displayOrder: 510, notes: 'Fallback for legacy mappings' },

  // ========== INSURANCE COMPANIES ==========
  { code: 'harel', type: 'insurance', nameHe: 'הראל', nameEn: 'Harel Insurance', category: 'insurance', scrapable: 0, displayOrder: 500 },
  { code: 'menora', type: 'insurance', nameHe: 'מנורה מבטחים', nameEn: 'Menora Mivtachim', category: 'insurance', scrapable: 0, displayOrder: 510 },
  { code: 'clal', type: 'insurance', nameHe: 'כלל ביטוח', nameEn: 'Clal Insurance', category: 'insurance', scrapable: 0, displayOrder: 520 },
  { code: 'migdal', type: 'insurance', nameHe: 'מגדל', nameEn: 'Migdal Insurance', category: 'insurance', scrapable: 0, displayOrder: 530 },
  { code: 'phoenix', type: 'insurance', nameHe: 'פניקס', nameEn: 'Phoenix Insurance', category: 'insurance', scrapable: 0, displayOrder: 540 },
  { code: 'ayalon', type: 'insurance', nameHe: 'איילון', nameEn: 'Ayalon Insurance', category: 'insurance', scrapable: 0, displayOrder: 550 },
  { code: 'hachshara', type: 'insurance', nameHe: 'הכשרה', nameEn: 'Hachshara Insurance', category: 'insurance', scrapable: 0, displayOrder: 560 },
  { code: 'aig', type: 'insurance', nameHe: 'AIG', nameEn: 'AIG Israel', category: 'insurance', scrapable: 0, displayOrder: 570 },

  // ========== STOCK BROKERS / INVESTMENT HOUSES ==========
  { code: 'ibi', type: 'broker', nameHe: 'IBI', nameEn: 'Israel Brokerage & Investments', category: 'brokerage', scrapable: 0, displayOrder: 600 },
  { code: 'psagot', type: 'broker', nameHe: 'פסגות', nameEn: 'Psagot Investment House', category: 'brokerage', scrapable: 0, displayOrder: 610 },
  { code: 'excellence', type: 'broker', nameHe: 'אקסלנס', nameEn: 'Excellence Investment House', category: 'brokerage', scrapable: 0, displayOrder: 620 },
  { code: 'meitav', type: 'broker', nameHe: 'מיטב דש', nameEn: 'Meitav Dash', category: 'brokerage', scrapable: 0, displayOrder: 630 },
  { code: 'leader', type: 'broker', nameHe: 'לידר', nameEn: 'Leader Capital Markets', category: 'brokerage', scrapable: 0, displayOrder: 640 },
  { code: 'altshuler', type: 'broker', nameHe: 'אלטשולר שחם', nameEn: 'Altshuler Shaham', category: 'brokerage', scrapable: 0, displayOrder: 650 },
  { code: 'more', type: 'broker', nameHe: 'מור', nameEn: 'More Investment House', category: 'brokerage', scrapable: 0, displayOrder: 660 },
  { code: 'interactive_brokers', type: 'broker', nameHe: 'אינטראקטיב ברוקרס', nameEn: 'Interactive Brokers', category: 'brokerage', scrapable: 0, displayOrder: 670 },
  { code: 'etoro', type: 'broker', nameHe: 'eToro', nameEn: 'eToro', category: 'brokerage', scrapable: 0, displayOrder: 680 },
  { code: 'plus500', type: 'broker', nameHe: 'Plus500', nameEn: 'Plus500', category: 'brokerage', scrapable: 0, displayOrder: 690 },

  // ========== CRYPTO EXCHANGES ==========
  { code: 'bit2c', type: 'crypto', nameHe: 'Bit2C', nameEn: 'Bit2C', category: 'crypto', scrapable: 0, displayOrder: 700, notes: 'Israeli cryptocurrency exchange regulated by ISA' },
  { code: 'bits_of_gold', type: 'crypto', nameHe: 'Bits of Gold', nameEn: 'Bits of Gold', category: 'crypto', scrapable: 0, displayOrder: 710, notes: 'Largest Israeli crypto brokerage' },
  { code: 'coins', type: 'crypto', nameHe: 'Coins', nameEn: 'Coins.co.il', category: 'crypto', scrapable: 0, displayOrder: 720, notes: 'Israeli crypto exchange' },
  { code: 'binance', type: 'crypto', nameHe: 'בינאנס', nameEn: 'Binance', category: 'crypto', scrapable: 0, displayOrder: 730, notes: 'Global crypto exchange' },
  { code: 'coinbase', type: 'crypto', nameHe: 'קוינבייס', nameEn: 'Coinbase', category: 'crypto', scrapable: 0, displayOrder: 740, notes: 'Global crypto exchange' }
];

const CATEGORY_TREE = [
  // Expenses Root & Main Categories
  { key: 'expense_root', type: 'expense', name: 'הוצאות', nameEn: 'Expenses', nameFr: 'Dépenses', displayOrder: 10, color: '#E57373', icon: 'Category' },

  // Food & Dining (Red-Orange tones)
  { key: 'exp_food', type: 'expense', parent: 'expense_root', name: 'אוכל', nameEn: 'Food & Dining', nameFr: 'Nourriture et restauration', displayOrder: 20, color: '#FF6B6B', icon: 'Restaurant' },
  { key: 'exp_food_grocery', type: 'expense', parent: 'exp_food', name: 'סופרמרקט', nameEn: 'Groceries', nameFr: 'Épicerie', displayOrder: 21, color: '#FF8A80', icon: 'ShoppingCart' },
  { key: 'exp_food_restaurants', type: 'expense', parent: 'exp_food', name: 'מסעדות', nameEn: 'Restaurants', nameFr: 'Restaurants', displayOrder: 22, color: '#FF5252', icon: 'RestaurantMenu' },
  { key: 'exp_food_coffee', type: 'expense', parent: 'exp_food', name: 'קפה ומאפה', nameEn: 'Coffee & Pastries', nameFr: 'Café et pâtisseries', displayOrder: 23, color: '#FFAB91', icon: 'LocalCafe' },
  { key: 'exp_food_delivery', type: 'expense', parent: 'exp_food', name: 'משלוחים', nameEn: 'Delivery', nameFr: 'Livraison', displayOrder: 24, color: '#FF7043', icon: 'DeliveryDining' },
  { key: 'exp_food_alcohol', type: 'expense', parent: 'exp_food', name: 'אלכוהול ומשקאות', nameEn: 'Alcohol & Beverages', nameFr: 'Alcool et boissons', displayOrder: 25, color: '#F4511E', icon: 'LocalBar' },
  { key: 'exp_food_bakery', type: 'expense', parent: 'exp_food', name: 'מאפייה וקינוחים', nameEn: 'Bakery & Desserts', nameFr: 'Boulangerie et desserts', displayOrder: 26, color: '#FFCCBC', icon: 'Cake' },
  { key: 'exp_food_catering', type: 'expense', parent: 'exp_food', name: 'קייטרינג ואירועים', nameEn: 'Catering & Events', nameFr: 'Traiteur et événements', displayOrder: 27, color: '#FF6B6B', icon: 'FoodBank' },

  // Transportation (Teal tones)
  { key: 'exp_transport', type: 'expense', parent: 'expense_root', name: 'תחבורה', nameEn: 'Transportation', nameFr: 'Transport', displayOrder: 30, color: '#4ECDC4', icon: 'DirectionsCar' },
  { key: 'exp_transport_fuel', type: 'expense', parent: 'exp_transport', name: 'דלק', nameEn: 'Fuel', nameFr: 'Carburant', displayOrder: 31, color: '#26A69A', icon: 'LocalGasStation' },
  { key: 'exp_transport_public', type: 'expense', parent: 'exp_transport', name: 'תחבורה ציבורית', nameEn: 'Public Transport', nameFr: 'Transport public', displayOrder: 32, color: '#00897B', icon: 'DirectionsBus' },
  { key: 'exp_transport_parking', type: 'expense', parent: 'exp_transport', name: 'חניה', nameEn: 'Parking', nameFr: 'Stationnement', displayOrder: 33, color: '#00695C', icon: 'LocalParking' },
  { key: 'exp_transport_taxi', type: 'expense', parent: 'exp_transport', name: 'מוניות', nameEn: 'Taxis', nameFr: 'Taxis', displayOrder: 34, color: '#4DB6AC', icon: 'LocalTaxi' },
  { key: 'exp_transport_rideshare', type: 'expense', parent: 'exp_transport', name: 'שיתוף רכב', nameEn: 'Ride Sharing', nameFr: 'Covoiturage', displayOrder: 35, color: '#80CBC4', icon: 'Commute' },
  { key: 'exp_transport_maintenance', type: 'expense', parent: 'exp_transport', name: 'תחזוקת רכב', nameEn: 'Vehicle Maintenance', nameFr: 'Entretien du véhicule', displayOrder: 36, color: '#B2DFDB', icon: 'Build' },
  { key: 'exp_transport_insurance', type: 'expense', parent: 'exp_transport', name: 'ביטוח רכב', nameEn: 'Vehicle Insurance', nameFr: 'Assurance véhicule', displayOrder: 37, color: '#E0F2F1', icon: 'Shield' },
  { key: 'exp_transport_tolls', type: 'expense', parent: 'exp_transport', name: 'כבישי אגרה', nameEn: 'Toll Roads', nameFr: 'Routes à péage', displayOrder: 38, color: '#009688', icon: 'Toll' },
  { key: 'exp_transport_rental', type: 'expense', parent: 'exp_transport', name: 'שכירת רכב', nameEn: 'Car Rental', nameFr: 'Location de voiture', displayOrder: 39, color: '#00BCD4', icon: 'CarRental' },
  { key: 'exp_transport_leasing', type: 'expense', parent: 'exp_transport', name: 'ליסינג רכב', nameEn: 'Vehicle Leasing', nameFr: 'Location de véhicule', displayOrder: 391, color: '#26C6DA', icon: 'DirectionsCarFilled' },
  { key: 'exp_transport_micromobility', type: 'expense', parent: 'exp_transport', name: 'קורקינטים ואופניים', nameEn: 'E-Scooters & Bikes', nameFr: 'Trottinettes électriques et vélos', displayOrder: 392, color: '#4DD0E1', icon: 'ElectricScooter' },

  // Bills & Utilities (Amber-Yellow tones)
  { key: 'exp_bills', type: 'expense', parent: 'expense_root', name: 'חשבונות', nameEn: 'Bills & Utilities', nameFr: 'Factures et services publics', displayOrder: 40, color: '#FFD93D', icon: 'Receipt' },
  { key: 'exp_bills_rent', type: 'expense', parent: 'exp_bills', name: 'שכירות ומשכנתא', nameEn: 'Rent & Mortgage', nameFr: 'Loyer et hypothèque', displayOrder: 41, color: '#FDD835', icon: 'Home' },
  { key: 'exp_bills_internet', type: 'expense', parent: 'exp_bills', name: 'אינטרנט וטלוויזיה', nameEn: 'Internet & TV', nameFr: 'Internet et TV', displayOrder: 42, color: '#FBC02D', icon: 'Wifi' },
  { key: 'exp_bills_communication', type: 'expense', parent: 'exp_bills', name: 'תקשורת', nameEn: 'Mobile & Communications', nameFr: 'Mobile et communications', displayOrder: 43, color: '#F9A825', icon: 'Phone' },
  { key: 'exp_bills_electricity', type: 'expense', parent: 'exp_bills', name: 'חשמל', nameEn: 'Electricity', nameFr: 'Électricité', displayOrder: 44, color: '#F57F17', icon: 'Bolt' },
  { key: 'exp_bills_water', type: 'expense', parent: 'exp_bills', name: 'מים', nameEn: 'Water', nameFr: 'Eau', displayOrder: 45, color: '#42A5F5', icon: 'Water' },
  { key: 'exp_bills_bank', type: 'expense', parent: 'exp_bills', name: 'תשלומי בנק', nameEn: 'Bank Settlements', nameFr: 'Règlements bancaires', displayOrder: 46, color: '#7E57C2', icon: 'AccountBalance' },
  { key: 'exp_bills_bank_cc_payment', type: 'expense', parent: 'exp_bills_bank', name: 'פרעון כרטיס אשראי', nameEn: 'Credit Card Repayment', nameFr: 'Remboursement de carte de crédit', displayOrder: 461, color: '#9575CD', icon: 'CreditCard' },
  { key: 'exp_bills_bank_digital', type: 'expense', parent: 'exp_bills_bank', name: 'העברות דיגיטליות', nameEn: 'Digital Wallet Transfers (BIT/PayBox)', nameFr: 'Transferts de portefeuille numérique (BIT/PayBox)', displayOrder: 462, color: '#B39DDB', icon: 'PhoneAndroid' },
  { key: 'exp_bills_bank_fees', type: 'expense', parent: 'exp_bills_bank', name: 'עמלות בנק וכרטיס', nameEn: 'Bank & Card Fees', nameFr: 'Frais bancaires et de carte', displayOrder: 463, color: '#D1C4E9', icon: 'MonetizationOn' },
  { key: 'exp_bills_bank_to_investments', type: 'expense', parent: 'exp_bills_bank', name: 'העברות להשקעות', nameEn: 'Transfers to Investments', nameFr: 'Transferts vers les investissements', displayOrder: 464, color: '#673AB7', icon: 'TrendingUp' },
  { key: 'exp_bills_bank_cash', type: 'expense', parent: 'exp_bills_bank', name: 'משיכת מזומן', nameEn: 'Cash Withdrawal', nameFr: 'Retrait d\'espèces', displayOrder: 465, color: '#4CAF50', icon: 'LocalAtm' },
  { key: 'exp_bills_bank_inv_tax', type: 'expense', parent: 'exp_bills_bank', name: 'מס על השקעות', nameEn: 'Investment Tax Withholding', nameFr: 'Retenue d\'impôt sur les investissements', displayOrder: 466, color: '#EDE7F6', icon: 'Receipt' },
  { key: 'exp_bills_insurance', type: 'expense', parent: 'exp_bills', name: 'ביטוח', nameEn: 'Insurance', nameFr: 'Assurance', displayOrder: 47, color: '#64DD17', icon: 'Security' },
  { key: 'exp_bills_municipal', type: 'expense', parent: 'exp_bills', name: 'מיסים עירוניים', nameEn: 'Municipal Taxes', nameFr: 'Taxes municipales', displayOrder: 48, color: '#558B2F', icon: 'Apartment' },
  { key: 'exp_bills_gas', type: 'expense', parent: 'exp_bills', name: 'גז', nameEn: 'Gas', nameFr: 'Gaz', displayOrder: 49, color: '#F57C00', icon: 'Fireplace' },
  { key: 'exp_bills_security', type: 'expense', parent: 'exp_bills', name: 'אבטחה', nameEn: 'Security Services', nameFr: 'Services de sécurité', displayOrder: 50, color: '#616161', icon: 'SecurityOutlined' },

  // Health & Wellness (Mint-Green tones)
  { key: 'exp_health', type: 'expense', parent: 'expense_root', name: 'בריאות', nameEn: 'Health & Wellness', nameFr: 'Santé et bien-être', displayOrder: 50, color: '#95E1D3', icon: 'LocalHospital' },
  { key: 'exp_health_medical', type: 'expense', parent: 'exp_health', name: 'בריאות כללית', nameEn: 'Medical Services', nameFr: 'Services médicaux', displayOrder: 51, color: '#4DB6AC', icon: 'MedicalServices' },
  { key: 'exp_health_pharmacy', type: 'expense', parent: 'exp_health', name: 'בית מרקחת', nameEn: 'Pharmacy', nameFr: 'Pharmacie', displayOrder: 52, color: '#26A69A', icon: 'LocalPharmacy' },
  { key: 'exp_health_dental', type: 'expense', parent: 'exp_health', name: 'שיניים', nameEn: 'Dental Care', nameFr: 'Soins dentaires', displayOrder: 53, color: '#00897B', icon: 'Medication' },
  { key: 'exp_health_vision', type: 'expense', parent: 'exp_health', name: 'עיניים ואופטיקה', nameEn: 'Vision & Optometry', nameFr: 'Vision et optométrie', displayOrder: 54, color: '#00695C', icon: 'Visibility' },
  { key: 'exp_health_fitness', type: 'expense', parent: 'exp_health', name: 'כושר וספורט', nameEn: 'Gym & Fitness', nameFr: 'Gym et fitness', displayOrder: 55, color: '#80CBC4', icon: 'FitnessCenter' },
  { key: 'exp_health_mental', type: 'expense', parent: 'exp_health', name: 'בריאות הנפש', nameEn: 'Mental Health & Therapy', nameFr: 'Santé mentale et thérapie', displayOrder: 56, color: '#A7FFEB', icon: 'Psychology' },
  { key: 'exp_health_salon', type: 'expense', parent: 'exp_health', name: 'מספרה וטיפוח', nameEn: 'Salon & Beauty Services', nameFr: 'Salon et services de beauté', displayOrder: 57, color: '#B2DFDB', icon: 'ContentCut' },

  // Leisure & Entertainment (Pink-Red tones)
  { key: 'exp_leisure', type: 'expense', parent: 'expense_root', name: 'פנאי', nameEn: 'Leisure & Entertainment', nameFr: 'Loisirs et divertissement', displayOrder: 60, color: '#F38181', icon: 'Theaters' },
  { key: 'exp_leisure_entertainment', type: 'expense', parent: 'exp_leisure', name: 'בילויים', nameEn: 'Outings', nameFr: 'Sorties', displayOrder: 61, color: '#E57373', icon: 'Celebration' },
  { key: 'exp_leisure_streaming', type: 'expense', parent: 'exp_leisure', name: 'סטרימינג', nameEn: 'Streaming Services', nameFr: 'Services de streaming', displayOrder: 62, color: '#EF5350', icon: 'Tv' },
  { key: 'exp_leisure_cinema', type: 'expense', parent: 'exp_leisure', name: 'קולנוע', nameEn: 'Cinema', nameFr: 'Cinéma', displayOrder: 63, color: '#F44336', icon: 'Movie' },
  { key: 'exp_leisure_travel', type: 'expense', parent: 'exp_leisure', name: 'חופשות', nameEn: 'Travel & Holidays', nameFr: 'Voyages et vacances', displayOrder: 64, color: '#E91E63', icon: 'Flight' },
  { key: 'exp_leisure_sports', type: 'expense', parent: 'exp_leisure', name: 'ספורט ותחביבים', nameEn: 'Sports & Hobbies', nameFr: 'Sports et loisirs', displayOrder: 65, color: '#C2185B', icon: 'SportsBaseball' },
  { key: 'exp_leisure_music', type: 'expense', parent: 'exp_leisure', name: 'מוזיקה וקונצרטים', nameEn: 'Music & Concerts', nameFr: 'Musique et concerts', displayOrder: 66, color: '#880E4F', icon: 'MusicNote' },
  { key: 'exp_leisure_gaming', type: 'expense', parent: 'exp_leisure', name: 'משחקים', nameEn: 'Gaming', nameFr: 'Jeux', displayOrder: 67, color: '#AD1457', icon: 'SportsEsports' },

  // Shopping (Lavender-Purple tones)
  { key: 'exp_shopping', type: 'expense', parent: 'expense_root', name: 'קניות', nameEn: 'Shopping', nameFr: 'Achats', displayOrder: 70, color: '#AA96DA', icon: 'ShoppingBag' },
  { key: 'exp_shopping_clothing', type: 'expense', parent: 'exp_shopping', name: 'ביגוד', nameEn: 'Clothing', nameFr: 'Vêtements', displayOrder: 71, color: '#9575CD', icon: 'Checkroom' },
  { key: 'exp_shopping_shoes', type: 'expense', parent: 'exp_shopping', name: 'נעליים', nameEn: 'Footwear', nameFr: 'Chaussures', displayOrder: 72, color: '#7E57C2', icon: 'Footprint' },
  { key: 'exp_shopping_housewares', type: 'expense', parent: 'exp_shopping', name: 'כלי בית', nameEn: 'Housewares', nameFr: 'Articles ménagers', displayOrder: 73, color: '#673AB7', icon: 'Kitchen' },
  { key: 'exp_shopping_furniture', type: 'expense', parent: 'exp_shopping', name: 'רהיטים', nameEn: 'Furniture', nameFr: 'Meubles', displayOrder: 74, color: '#5E35B1', icon: 'Chair' },
  { key: 'exp_shopping_electronics', type: 'expense', parent: 'exp_shopping', name: 'אלקטרוניקה', nameEn: 'Electronics', nameFr: 'Électronique', displayOrder: 75, color: '#512DA8', icon: 'Devices' },
  { key: 'exp_shopping_gifts', type: 'expense', parent: 'exp_shopping', name: 'מתנות', nameEn: 'Gifts', nameFr: 'Cadeaux', displayOrder: 76, color: '#4527A0', icon: 'CardGiftcard' },
  { key: 'exp_shopping_cosmetics', type: 'expense', parent: 'exp_shopping', name: 'קוסמטיקה וטיפוח', nameEn: 'Cosmetics & Personal Care', nameFr: 'Cosmétiques et soins personnels', displayOrder: 77, color: '#EC407A', icon: 'Face' },
  { key: 'exp_shopping_books', type: 'expense', parent: 'exp_shopping', name: 'ספרים וכתיבה', nameEn: 'Books & Stationery', nameFr: 'Livres et papeterie', displayOrder: 78, color: '#F48FB1', icon: 'MenuBook' },
  { key: 'exp_shopping_pets', type: 'expense', parent: 'exp_shopping', name: 'חיות מחמד', nameEn: 'Pet Supplies', nameFr: 'Fournitures pour animaux', displayOrder: 79, color: '#F06292', icon: 'Pets' },
  { key: 'exp_shopping_office', type: 'expense', parent: 'exp_shopping', name: 'ציוד משרדי', nameEn: 'Office Supplies', nameFr: 'Fournitures de bureau', displayOrder: 80, color: '#E91E63', icon: 'WorkOutline' },
  { key: 'exp_shopping_jewelry', type: 'expense', parent: 'exp_shopping', name: 'תכשיטים ואקססוריז', nameEn: 'Jewelry & Accessories', nameFr: 'Bijoux et accessoires', displayOrder: 81, color: '#C2185B', icon: 'Diamond' },
  { key: 'exp_shopping_sports_equipment', type: 'expense', parent: 'exp_shopping', name: 'ציוד ספורט', nameEn: 'Sports Equipment', nameFr: 'Équipement sportif', displayOrder: 82, color: '#AD1457', icon: 'SportsTennis' },
  { key: 'exp_shopping_religious', type: 'expense', parent: 'exp_shopping', name: 'תשמישי קדושה', nameEn: 'Religious Items & Judaica', nameFr: 'Articles religieux et judaïca', displayOrder: 83, color: '#880E4F', icon: 'Synagogue' },
  { key: 'exp_shopping_digital', type: 'expense', parent: 'exp_shopping', name: 'שירותים דיגיטליים', nameEn: 'Digital Services & Subscriptions', nameFr: 'Services numériques et abonnements', displayOrder: 84, color: '#BA68C8', icon: 'Cloud' },
  { key: 'exp_shopping_home_improvement', type: 'expense', parent: 'exp_shopping', name: 'שיפוצים ובניה', nameEn: 'Home Improvement & DIY', nameFr: 'Amélioration de la maison et bricolage', displayOrder: 85, color: '#9C27B0', icon: 'Handyman' },
  { key: 'exp_shopping_pet_care', type: 'expense', parent: 'exp_shopping', name: 'וטרינר וטיפוח', nameEn: 'Veterinary & Pet Grooming', nameFr: 'Soins vétérinaires et toilettage pour animaux', displayOrder: 86, color: '#CE93D8', icon: 'MedicalServices' },

  // Education (Light Pink tones)
  { key: 'exp_education', type: 'expense', parent: 'expense_root', name: 'חינוך', nameEn: 'Education', nameFr: 'Éducation', displayOrder: 80, color: '#FCBAD3', icon: 'School' },
  { key: 'exp_education_higher', type: 'expense', parent: 'exp_education', name: 'לימודים גבוהים', nameEn: 'Higher Education', nameFr: 'Enseignement supérieur', displayOrder: 81, color: '#F48FB1', icon: 'AccountBalance' },
  { key: 'exp_education_online', type: 'expense', parent: 'exp_education', name: 'קורסים מקוונים', nameEn: 'Online Courses', nameFr: 'Cours en ligne', displayOrder: 82, color: '#F06292', icon: 'Computer' },
  { key: 'exp_education_schools', type: 'expense', parent: 'exp_education', name: 'גני ילדים ובתי ספר', nameEn: 'Kindergarten & Schools', nameFr: 'Jardin d\'enfants et écoles', displayOrder: 83, color: '#EC407A', icon: 'ChildCare' },
  { key: 'exp_education_tutoring', type: 'expense', parent: 'exp_education', name: 'חוגים ושיעורים פרטיים', nameEn: 'Classes & Tutoring', nameFr: 'Cours et tutorat', displayOrder: 84, color: '#E91E63', icon: 'Person' },
  { key: 'exp_education_books', type: 'expense', parent: 'exp_education', name: 'ספרי לימוד', nameEn: 'Educational Books', nameFr: 'Livres éducatifs', displayOrder: 85, color: '#C2185B', icon: 'AutoStories' },
  { key: 'exp_education_childcare', type: 'expense', parent: 'exp_education', name: 'שמרטפות ומטפלות', nameEn: 'Babysitters & Nannies', nameFr: 'Garde d’enfants / Nounous', displayOrder: 86, color: '#F8BBD0', icon: 'FaceRetouchingNatural' },

  // Home & Maintenance (Brown-Beige tones)
  { key: 'exp_home', type: 'expense', parent: 'expense_root', name: 'בית ותחזוקה', nameEn: 'Home & Maintenance', nameFr: 'Maison et entretien', displayOrder: 85, color: '#A1887F', icon: 'HomeRepairService' },
  { key: 'exp_home_repairs', type: 'expense', parent: 'exp_home', name: 'תיקונים', nameEn: 'Repairs & Handyman', nameFr: 'Réparations et bricolage', displayOrder: 851, color: '#8D6E63', icon: 'Construction' },
  { key: 'exp_home_cleaning', type: 'expense', parent: 'exp_home', name: 'ניקיון', nameEn: 'Cleaning Services', nameFr: 'Services de nettoyage', displayOrder: 852, color: '#BCAAA4', icon: 'CleaningServices' },

  // Professional Services (Dark Slate tones)
  { key: 'exp_professional', type: 'expense', parent: 'expense_root', name: 'שירותים מקצועיים', nameEn: 'Professional Services', nameFr: 'Services professionnels', displayOrder: 87, color: '#546E7A', icon: 'BusinessCenter' },
  { key: 'exp_professional_legal', type: 'expense', parent: 'exp_professional', name: 'משפטי', nameEn: 'Legal Services', nameFr: 'Services juridiques', displayOrder: 871, color: '#455A64', icon: 'Gavel' },
  { key: 'exp_professional_accounting', type: 'expense', parent: 'exp_professional', name: 'הנהלת חשבונות', nameEn: 'Accounting & Tax', nameFr: 'Comptabilité et fiscalité', displayOrder: 872, color: '#607D8B', icon: 'Calculate' },
  { key: 'exp_professional_consulting', type: 'expense', parent: 'exp_professional', name: 'ייעוץ', nameEn: 'Consulting Services', nameFr: 'Services de conseil', displayOrder: 873, color: '#78909C', icon: 'Psychology' },

  // Miscellaneous (Gray-Blue tones)
  { key: 'exp_misc', type: 'expense', parent: 'expense_root', name: 'שונות', nameEn: 'Miscellaneous', nameFr: 'Divers', displayOrder: 90, color: '#A8DADC', icon: 'MoreHoriz' },
  { key: 'exp_misc_other', type: 'expense', parent: 'exp_misc', name: 'הוצאות אחרות', nameEn: 'Other Expenses', nameFr: 'Autres dépenses', displayOrder: 91, color: '#90A4AE', icon: 'MoreVert' },
  { key: 'exp_misc_donations', type: 'expense', parent: 'exp_misc', name: 'תרומות', nameEn: 'Charitable Donations', nameFr: 'Dons caritatifs', displayOrder: 92, color: '#78909C', icon: 'VolunteerActivism' },

  // Income (Green tones as requested)
  { key: 'income_root', type: 'income', name: 'הכנסות', nameEn: 'Income', nameFr: 'Revenus', displayOrder: 100, color: '#4CAF50', icon: 'AccountBalance' },
  { key: 'income_salary', type: 'income', parent: 'income_root', name: 'משכורת', nameEn: 'Salary', nameFr: 'Salaire', displayOrder: 101, color: '#66BB6A', icon: 'Work' },
  { key: 'income_freelance', type: 'income', parent: 'income_root', name: 'פרילנס', nameEn: 'Freelance & Side Hustle', nameFr: 'Freelance et activités secondaires', displayOrder: 102, color: '#81C784', icon: 'Laptop' },
  { key: 'income_refunds', type: 'income', parent: 'income_root', name: 'החזרים וזיכויים', nameEn: 'Refunds & Credits', nameFr: 'Remboursements et crédits', displayOrder: 103, color: '#A5D6A7', icon: 'Replay' },
  { key: 'income_gifts', type: 'income', parent: 'income_root', name: 'מתנות', nameEn: 'Gifts & Windfalls', nameFr: 'Cadeaux et gains inattendus', displayOrder: 104, color: '#C8E6C9', icon: 'CardGiftcard' },
  { key: 'income_gov_benefits', type: 'income', parent: 'income_root', name: 'קצבאות ממשלתיות', nameEn: 'Government Benefits', nameFr: 'Prestations gouvernementales', displayOrder: 105, color: '#00C853', icon: 'AccountBalance' },
  { key: 'income_capital_returns', type: 'income', parent: 'income_root', name: 'החזר קרן', nameEn: 'Capital Returns', nameFr: 'Retours de capital', displayOrder: 106, color: '#B2DFDB', icon: 'AccountBalanceWallet', isCountedAsIncome: false },
  { key: 'income_investment_interest', type: 'income', parent: 'income_root', name: 'ריבית מהשקעות', nameEn: 'Investment Interest', nameFr: 'Intérêts sur investissements', displayOrder: 107, color: '#69F0AE', icon: 'TrendingUp' },

  // Investment (Blue/Purple tones as requested)
  { key: 'investment_root', type: 'investment', name: 'השקעות', nameEn: 'Investments', nameFr: 'Investissements', displayOrder: 200, color: '#5E35B1', icon: 'TrendingUp' },
  { key: 'investment_stocks', type: 'investment', parent: 'investment_root', name: 'מניות', nameEn: 'Stocks & ETFs', nameFr: 'Actions et FNB', displayOrder: 201, color: '#7E57C2', icon: 'ShowChart' },
  { key: 'investment_crypto', type: 'investment', parent: 'investment_root', name: 'קריפטו', nameEn: 'Crypto Assets', nameFr: 'Actifs cryptographiques', displayOrder: 202, color: '#9575CD', icon: 'CurrencyBitcoin' },
  { key: 'investment_retirement', type: 'investment', parent: 'investment_root', name: 'פנסיה וחיסכון', nameEn: 'Retirement & Savings', nameFr: 'Retraite et épargne', displayOrder: 203, color: '#1976D2', icon: 'Savings' },
  { key: 'investment_study_fund', type: 'investment', parent: 'investment_root', name: 'קופות גמל', nameEn: 'Study & Provident Funds', nameFr: 'Fonds d\'étude et de prévoyance', displayOrder: 204, color: '#42A5F5', icon: 'School' },
  { key: 'investment_real_estate', type: 'investment', parent: 'investment_root', name: 'נדל"ן', nameEn: 'Real Estate', nameFr: 'Immobilier', displayOrder: 205, color: '#64B5F6', icon: 'Home' },
  { key: 'investment_deposits', type: 'investment', parent: 'investment_root', name: 'פיקדונות', nameEn: 'Bank Deposits', nameFr: 'Dépôts bancaires', displayOrder: 206, color: '#90CAF9', icon: 'AccountBalance' }
];

// Legacy category mappings: old transaction.category → new category_definitions
// Only confident mappings - user will handle uncertain ones via categorization rules
const CATEGORY_MAPPINGS = [
  { oldCategory: 'מזון וצריכה', newCategory: 'סופרמרקט', notes: 'Maps to: Groceries' },
  { oldCategory: 'מזון ומשקאות', newCategory: 'סופרמרקט', notes: 'Maps to: Groceries' },
  { oldCategory: 'מסעדות, קפה וברים', newCategory: 'מסעדות', notes: 'Maps to: Restaurants' },
  { oldCategory: 'תחבורה ורכבים', newCategory: 'תחבורה', notes: 'Maps to: Transportation (parent)' },
  { oldCategory: 'שירותי תקשורת', newCategory: 'תקשורת', notes: 'Maps to: Mobile & Communications' },
  { oldCategory: 'דלק, חשמל וגז', newCategory: 'חשמל', notes: 'Maps to: Electricity' },
  { oldCategory: 'חשמל ומחשבים', newCategory: 'אלקטרוניקה', notes: 'Maps to: Electronics' },
  { oldCategory: 'רפואה ובתי מרקחת', newCategory: 'בית מרקחת', notes: 'Maps to: Pharmacy' },
  { oldCategory: 'אופנה', newCategory: 'ביגוד', notes: 'Maps to: Clothing' },
  { oldCategory: 'עיצוב הבית', newCategory: 'רהיטים', notes: 'Maps to: Furniture' },
  { oldCategory: 'פנאי, בידור וספורט', newCategory: 'ספורט ותחביבים', notes: 'Maps to: Sports & Hobbies' },
  { oldCategory: 'טיסות ותיירות', newCategory: 'חופשות', notes: 'Maps to: Travel & Holidays' },
  { oldCategory: 'העברת כספים', newCategory: 'תשלומי בנק', notes: 'Maps to: Bank Settlements' },
  { oldCategory: 'שונות', newCategory: 'שונות', notes: 'Maps to: Miscellaneous' },
  { oldCategory: 'קופת גמל', newCategory: 'קופות גמל', notes: 'Maps to: Study & Provident Funds' },
  // NEW: Specific subcategory mappings (October 2025 expansion)
  { oldCategory: 'ביטוח', newCategory: 'ביטוח', notes: 'Maps to: Insurance subcategory' },
  { oldCategory: 'עירייה וממשלה', newCategory: 'מיסים עירוניים', notes: 'Maps to: Municipal Taxes subcategory' },
  { oldCategory: 'חיות מחמד', newCategory: 'חיות מחמד', notes: 'Maps to: Pet Supplies subcategory' },
  { oldCategory: 'ספרים ודפוס', newCategory: 'ספרים וכתיבה', notes: 'Maps to: Books & Stationery subcategory' },
  { oldCategory: 'ציוד ומשרד', newCategory: 'ציוד משרדי', notes: 'Maps to: Office Supplies subcategory' },
  { oldCategory: 'קוסמטיקה וטיפוח', newCategory: 'קוסמטיקה וטיפוח', notes: 'Maps to: Cosmetics & Personal Care subcategory' }
];

function seedCategories(db) {
  const insert = db.prepare(`
    INSERT INTO category_definitions
      (name, name_en, name_fr, category_type, parent_id, display_order, icon, color, description, is_active, is_counted_as_income)
    VALUES
      (@name, @nameEn, @nameFr, @type, @parentId, @displayOrder, @icon, @color, @description, 1, @isCountedAsIncome)
  `);

  const categoriesByKey = new Map();
  const leafTracker = new Map();

  db.transaction(() => {
    for (const category of CATEGORY_TREE) {
      const parent = category.parent ? categoriesByKey.get(category.parent) : null;
      const info = insert.run({
        name: category.name,
        nameEn: category.nameEn || null,
        nameFr: category.nameFr || null,
        type: category.type,
        parentId: parent ? parent.id : null,
        displayOrder: category.displayOrder ?? 0,
        icon: category.icon || null,
        color: category.color || null,
        description: category.description || null,
        isCountedAsIncome: category.isCountedAsIncome === false ? 0 : 1
      });

      const record = {
        id: info.lastInsertRowid,
        name: category.name,
        nameEn: category.nameEn || null,
        nameFr: category.nameFr || null,
        type: category.type,
        parentKey: category.parent || null
      };

      categoriesByKey.set(category.key, record);
      leafTracker.set(category.key, true);
      if (category.parent) {
        leafTracker.set(category.parent, false);
      }
    }

    // After all categories are inserted, calculate hierarchy_path and depth_level
    db.exec(`
      WITH RECURSIVE CategoryTree AS (
        SELECT
          id,
          parent_id,
          name,
          CAST(id AS TEXT) as hierarchy_path,
          0 as depth_level
        FROM category_definitions
        WHERE parent_id IS NULL

        UNION ALL

        SELECT
          c.id,
          c.parent_id,
          c.name,
          ct.hierarchy_path || '/' || CAST(c.id AS TEXT) as hierarchy_path,
          ct.depth_level + 1 as depth_level
        FROM category_definitions c
        JOIN CategoryTree ct ON c.parent_id = ct.id
      )
      UPDATE category_definitions
      SET
        hierarchy_path = (
          SELECT hierarchy_path
          FROM CategoryTree
          WHERE CategoryTree.id = category_definitions.id
        ),
        depth_level = (
          SELECT depth_level
          FROM CategoryTree
          WHERE CategoryTree.id = category_definitions.id
        );
    `);
  })();

  return { categoriesByKey, leafTracker };
}

function seedCategoryMapping(db, helpers) {
  const { categoriesByKey } = helpers;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO category_mapping (old_category_name, category_definition_id, notes)
    VALUES (@oldCategory, @categoryId, @notes)
  `);

  db.transaction(() => {
    for (const mapping of CATEGORY_MAPPINGS) {
      // Find category by name instead of key
      let foundCategory = null;
      for (const [key, info] of categoriesByKey.entries()) {
        if (info.name === mapping.newCategory) {
          foundCategory = info;
          break;
        }
      }

      if (!foundCategory) {
        console.warn(`Warning: Category '${mapping.newCategory}' not found for '${mapping.oldCategory}'`);
        continue;
      }
      insert.run({
        oldCategory: mapping.oldCategory,
        categoryId: foundCategory.id,
        notes: mapping.notes || null
      });
    }
  })();
}

function seedCategorizationRules(db, helpers) {
  const { categoriesByKey } = helpers;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO categorization_rules
      (name_pattern, target_category, category_definition_id, category_type, priority, is_active)
    VALUES (@namePattern, @targetCategory, @categoryId, @categoryType, @priority, 1)
  `);

  // Default income categorization rules
  const incomeRules = [
    { pattern: 'משכורת', target: 'Salary', categoryName: 'משכורת', priority: 100 },
    { pattern: 'ביטוח לאומי', target: 'Government Benefits', categoryName: 'קצבאות ממשלתיות', priority: 90 },
    { pattern: 'זיכוי', target: 'Refunds & Credits', categoryName: 'החזרים וזיכויים', priority: 80 },
    { pattern: 'קבלת תשלום', target: 'Refunds & Credits', categoryName: 'החזרים וזיכויים', priority: 80 },
    // Capital Returns - principal returned from investments (NOT counted as income)
    { pattern: 'פירעון פיקדון', target: 'Capital Returns', categoryName: 'החזר קרן', priority: 95 },
    { pattern: 'פירעון תכנית', target: 'Capital Returns', categoryName: 'החזר קרן', priority: 95 },
    { pattern: 'פדיון קרן', target: 'Capital Returns', categoryName: 'החזר קרן', priority: 95 },
    { pattern: 'החזר קרן', target: 'Capital Returns', categoryName: 'החזר קרן', priority: 95 },
    // Investment Interest - actual income from investments
    { pattern: 'רווח מפיקדון', target: 'Investment Interest', categoryName: 'ריבית מהשקעות', priority: 95 },
    { pattern: 'ריבית מפיקדון', target: 'Investment Interest', categoryName: 'ריבית מהשקעות', priority: 95 },
    { pattern: 'דיבידנד', target: 'Investment Interest', categoryName: 'ריבית מהשקעות', priority: 95 },
    { pattern: 'ריבית זכות', target: 'Investment Interest', categoryName: 'ריבית מהשקעות', priority: 90 }
  ];

  // Expense categorization rules aligned with synthetic seed vendors
  const expenseRules = [
    { pattern: 'Cafe', target: 'Coffee', categoryName: 'קפה ומאפה', priority: 95 },
    { pattern: 'FreshFarm', target: 'Groceries', categoryName: 'סופרמרקט', priority: 95 },
    { pattern: 'SuperSave', target: 'Groceries', categoryName: 'סופרמרקט', priority: 95 },
    { pattern: 'Fuel', target: 'Fuel', categoryName: 'דלק', priority: 95 },
    { pattern: 'QuickFuel', target: 'Fuel', categoryName: 'דלק', priority: 95 },
    { pattern: 'GymFlex', target: 'Gym', categoryName: 'כושר וספורט', priority: 95 },
    { pattern: 'Rentals', target: 'Rent', categoryName: 'שכירות ומשכנתא', priority: 95 },
    { pattern: 'TravelEasy', target: 'Travel', categoryName: 'חופשות', priority: 95 },
    { pattern: 'TelcoNet', target: 'Mobile', categoryName: 'תקשורת', priority: 95 },
    { pattern: 'Taxi', target: 'Taxi', categoryName: 'מוניות', priority: 95 },
    { pattern: 'Hardware', target: 'Housewares', categoryName: 'כלי בית', priority: 90 },
    { pattern: 'Station', target: 'Fuel', categoryName: 'דלק', priority: 85 },
    { pattern: 'Grocers', target: 'Groceries', categoryName: 'סופרמרקט', priority: 85 },
    { pattern: 'Market', target: 'Groceries', categoryName: 'סופרמרקט', priority: 85 },
    { pattern: 'Travel', target: 'Travel', categoryName: 'חופשות', priority: 85 },
    { pattern: 'Hardware', target: 'Office Supplies', categoryName: 'ציוד משרדי', priority: 80 }
  ];

  db.transaction(() => {
    for (const rule of incomeRules) {
      // Find category by name
      let foundCategory = null;
      for (const [key, info] of categoriesByKey.entries()) {
        if (info.name === rule.categoryName) {
          foundCategory = info;
          break;
        }
      }

      if (!foundCategory) {
        console.warn(`Warning: Category '${rule.categoryName}' not found for rule '${rule.pattern}'`);
        continue;
      }

      insert.run({
        namePattern: rule.pattern,
        targetCategory: rule.target,
        categoryId: foundCategory.id,
        categoryType: 'income',
        priority: rule.priority
      });
    }

    for (const rule of expenseRules) {
      let foundCategory = null;
      for (const [, info] of categoriesByKey.entries()) {
        if (info.name === rule.categoryName) {
          foundCategory = info;
          break;
        }
      }

      if (!foundCategory) {
        console.warn(`Warning: Category '${rule.categoryName}' not found for rule '${rule.pattern}'`);
        continue;
      }

      insert.run({
        namePattern: rule.pattern,
        targetCategory: rule.target,
        categoryId: foundCategory.id,
        categoryType: 'expense',
        priority: rule.priority
      });
    }
  })();
}

function resolveInstitutionParentKey(institution) {
  if (!institution) return null;

  if (institution.type === 'bank') return 'bank';
  if (institution.type === 'credit_card') return 'credit_card';
  if (institution.type === 'insurance') return 'insurance';
  if (institution.type === 'broker') return 'investment_liquid_brokerage';
  if (institution.type === 'crypto') return 'investment_liquid_crypto';

  if (institution.type === 'investment') {
    if (institution.subcategory === 'cash') return 'investment_liquid_cash';
    if (institution.subcategory === 'pension') return 'investment_long_term_pension';
    if (institution.subcategory === 'provident') return 'investment_long_term_provident';
    return 'investment_long_term_other';
  }

  return 'investment_long_term_other';
}

function seedFinancialInstitutions(db) {
  console.log('  → Seeding financial institution tree...');

  const insertGroup = db.prepare(`
    INSERT OR IGNORE INTO institution_nodes
      (parent_id, vendor_code, node_type, institution_type, category, subcategory,
       display_name_he, display_name_en, is_scrapable, logo_url, scraper_company_id, credential_fields,
       is_active, display_order, notes, hierarchy_path, depth_level)
    VALUES
      (@parentId, NULL, @nodeType, @institutionType, @category, @subcategory,
       @nameHe, @nameEn, 0, NULL, NULL, NULL,
       1, @displayOrder, NULL, @path, @depth)
  `);

  const insertLeaf = db.prepare(`
    INSERT OR IGNORE INTO institution_nodes
      (parent_id, vendor_code, node_type, institution_type, category, subcategory,
       display_name_he, display_name_en, is_scrapable, logo_url, scraper_company_id, credential_fields,
       is_active, display_order, notes, hierarchy_path, depth_level)
    VALUES
      (@parentId, @code, 'institution', @type, @category, @subcategory,
       @nameHe, @nameEn, @scrapable, NULL, @scraperCompanyId, @credentialFields,
       1, @displayOrder, @notes, @path, @depth)
  `);

  const findNodeByPath = db.prepare('SELECT id, hierarchy_path, depth_level FROM institution_nodes WHERE hierarchy_path = ? LIMIT 1');

  const groupMetaByKey = new Map();
  let leafInserted = 0;

  db.transaction(() => {
    // Insert roots/groups in depth order so parents exist before children
    const sortedGroups = [...INSTITUTION_GROUPS].sort((a, b) => a.depth - b.depth || a.displayOrder - b.displayOrder);
    for (const group of sortedGroups) {
      const parentMeta = group.parentKey ? groupMetaByKey.get(group.parentKey) : null;
      const result = insertGroup.run({
        parentId: parentMeta ? parentMeta.id : null,
        nodeType: group.nodeType,
        institutionType: group.institutionType,
        category: group.category,
        subcategory: group.subcategory || null,
        nameHe: group.nameHe,
        nameEn: group.nameEn,
        displayOrder: group.displayOrder,
        path: group.path,
        depth: group.depth
      });

      let id = result.lastInsertRowid;
      if (!id) {
        const existing = findNodeByPath.get(group.path);
        id = existing?.id;
      }

      if (!id) {
        console.warn(`Warning: Failed to insert group node for ${group.key}`);
        continue;
      }

      groupMetaByKey.set(group.key, { id, path: group.path, depth: group.depth });
    }

    for (const institution of FINANCIAL_INSTITUTIONS) {
      const parentKey = resolveInstitutionParentKey(institution);
      const parentMeta = parentKey ? groupMetaByKey.get(parentKey) : null;

      if (!parentMeta) {
        console.warn(`Warning: Parent node '${parentKey}' not found for institution ${institution.code}`);
        continue;
      }

      const path = `${parentMeta.path}/${institution.code}`;
      const depth = parentMeta.depth + 1;

      const result = insertLeaf.run({
        parentId: parentMeta.id,
        code: institution.code,
        type: institution.type,
        category: institution.category,
        subcategory: institution.subcategory || null,
        nameHe: institution.nameHe,
        nameEn: institution.nameEn,
        scrapable: institution.scrapable,
        scraperCompanyId: institution.scraperCompanyId || null,
        credentialFields: institution.credentialFields || null,
        displayOrder: institution.displayOrder,
        notes: institution.notes || null,
        path,
        depth
      });

      if (result.changes > 0) {
        leafInserted += 1;
      }
    }
  })();

  console.log(`    ✓ Seeded ${leafInserted} institution leaves (tree nodes total: ${leafInserted + groupMetaByKey.size})`);
  return leafInserted;
}

function seedSpendingCategoryTargets(db) {
  console.log('  → Seeding spending category targets...');

  const insert = db.prepare(`
    INSERT OR IGNORE INTO spending_category_targets (spending_category, target_percentage, is_active)
    VALUES (@category, @percentage, 1)
  `);

  const targets = [
    { category: 'essential', percentage: 50.0 },  // 50% for essentials (rent, utilities, groceries)
    { category: 'growth', percentage: 20.0 },      // 20% for growth (investments, savings, education)
    { category: 'stability', percentage: 10.0 },   // 10% for stability (emergency fund, insurance)
    { category: 'reward', percentage: 15.0 }       // 15% for rewards (entertainment, dining, travel)
  ];

  let insertedCount = 0;
  db.transaction(() => {
    for (const target of targets) {
      insert.run({
        category: target.category,
        percentage: target.percentage
      });
      insertedCount++;
    }
  })();

  console.log(`    ✓ Seeded ${insertedCount} spending category targets`);
  return insertedCount;
}

function detectSpendingCategoryForSeed(name, nameEn, parentName, nameFr, parentNameFr) {
  const combined = `${(name || '').toLowerCase()} ${(nameEn || '').toLowerCase()} ${(nameFr || '').toLowerCase()} ${(parentName || '').toLowerCase()} ${(parentNameFr || '').toLowerCase()}`;

  const ignoreKeywords = ['פרעון כרטיס אשראי', 'החזר כרטיס אשראי', 'card repayment'];
  if (ignoreKeywords.some((kw) => combined.includes(kw))) {
    return null;
  }

  const growthKeywords = ['השקעה', 'חיסכון', 'חינוך', 'לימוד', 'השכלה', 'investment', 'savings', 'education', 'course', 'deposit', 'fund'];
  const stabilityKeywords = ['ביטוח', 'הלווא', 'משכנת', 'חוב', 'pension', 'insurance', 'loan', 'mortgage', 'debt'];
  const essentialKeywords = ['חשמל', 'מים', 'גז', 'ארנונה', 'סופר', 'אוכל', 'מזון', 'תחבורה', 'דלק', 'rent', 'water', 'gas', 'electric', 'grocery', 'food', 'transport'];
  const rewardKeywords = ['בילוי', 'מסעד', 'קפה', 'נופש', 'טיול', 'קניות', 'אופנה', 'ספורט', 'entertainment', 'restaurant', 'coffee', 'travel', 'vacation', 'shopping', 'hobby'];

  if (growthKeywords.some((kw) => combined.includes(kw))) return 'growth';
  if (stabilityKeywords.some((kw) => combined.includes(kw))) return 'stability';
  if (essentialKeywords.some((kw) => combined.includes(kw))) return 'essential';
  if (rewardKeywords.some((kw) => combined.includes(kw))) return 'reward';
  return 'essential';
}

function seedSpendingCategoryMappings(db) {
  console.log('  → Seeding spending category mappings...');

  const categories = db.prepare(`
    SELECT
      cd.id,
      cd.name,
      cd.name_en,
      cd.name_fr,
      cd.category_type,
      parent.name AS parent_name,
      parent.name_fr AS parent_name_fr
    FROM category_definitions cd
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    WHERE cd.category_type IN ('expense', 'investment')
      AND cd.is_active = 1
  `).all();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO spending_category_mappings (
      category_definition_id,
      spending_category,
      variability_type,
      is_auto_detected,
      detection_confidence,
      user_overridden
    ) VALUES (
      @category_definition_id,
      @spending_category,
      @variability_type,
      1,
      @confidence,
      0
    )
  `);

  let created = 0;
  db.transaction(() => {
    for (const category of categories) {
      const spendingCategory = detectSpendingCategoryForSeed(
        category.name,
        category.name_en,
        category.parent_name,
        category.name_fr,
        category.parent_name_fr
      );
      if (!spendingCategory) {
        continue;
      }
      insert.run({
        category_definition_id: category.id,
        spending_category: spendingCategory,
        variability_type: category.category_type === 'investment' ? 'fixed' : 'variable',
        confidence: 0.9,
      });
      created++;
    }
  })();

  console.log(`    ✓ Seeded ${created} spending category mappings`);
  return created;
}

function seedDemoCredentials(db) {
  console.log('  → Seeding demo vendor credentials and pairings (if empty)...');
  const existing = db.prepare('SELECT COUNT(*) as count FROM vendor_credentials').get().count;
  if (existing > 0) {
    console.log('    • Skipped (credentials already present)');
    return 0;
  }

  const findInstitution = db.prepare(`
    SELECT id FROM institution_nodes
    WHERE vendor_code = ? AND node_type = 'institution'
    LIMIT 1
  `);
  const insertCredential = db.prepare(`
    INSERT OR IGNORE INTO vendor_credentials (
      id_number,
      username,
      vendor,
      nickname,
      bank_account_number,
      card6_digits,
      last_scrape_status,
      institution_id,
      created_at,
      updated_at
    ) VALUES (
      @idNumber,
      @username,
      @vendor,
      @nickname,
      @bankAccountNumber,
      @card6Digits,
      'success',
      @institutionId,
      datetime('now'),
      datetime('now')
    )
  `);

  const samples = [
    {
      vendor: 'hapoalim',
      nickname: 'Hapoalim Demo',
      bankAccountNumber: '12345678',
      idNumber: '111111111',
      username: 'demo-bank',
    },
    {
      vendor: 'max',
      nickname: 'Max Demo',
      card6Digits: '123456',
      idNumber: '222222222',
      username: 'demo-cc',
    },
  ];

  db.transaction(() => {
    for (const sample of samples) {
      insertCredential.run({
        idNumber: sample.idNumber || null,
        username: sample.username || null,
        vendor: sample.vendor,
        nickname: sample.nickname,
        bankAccountNumber: sample.bankAccountNumber || null,
        card6Digits: sample.card6Digits || null,
        institutionId: findInstitution.get(sample.vendor)?.id || null,
      });
    }

    db.prepare(`
      INSERT OR IGNORE INTO account_pairings (
        credit_card_vendor,
        credit_card_account_number,
        bank_vendor,
        bank_account_number,
        match_patterns,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        'max',
        '1234',
        'hapoalim',
        '12345678',
        json('["max","card","credit","repayment"]'),
        1,
        datetime('now'),
        datetime('now')
      )
    `).run();
  })();

  console.log(`    ✓ Seeded ${samples.length} demo credentials + pairing`);
  return samples.length;
}

function ensureDestination(outputPath, force) {
  if (fs.existsSync(outputPath)) {
    if (!force) {
      throw new Error(`Destination ${outputPath} already exists. Use --force to overwrite.`);
    }
    fs.unlinkSync(outputPath);
    const walPath = `${outputPath}-wal`;
    const shmPath = `${outputPath}-shm`;
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

function main() {
  const { output, force, withDemo } = parseArgs();
  ensureDestination(output, force);

  console.log(`\n📦 Initialising SQLite database at ${output}\n`);
  const db = new Database(output);
  let transactionStarted = false;

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec('BEGIN');
    transactionStarted = true;
    
    for (const statement of TABLE_DEFINITIONS) {
      db.exec(statement);
    }
    applySchemaUpgrades(db);
    for (const statement of INDEX_STATEMENTS) {
      db.exec(statement);
    }

    const institutionCount = seedFinancialInstitutions(db);
    const helpers = seedCategories(db);
    seedCategoryMapping(db, helpers);
    seedCategorizationRules(db, helpers);
    const spendingTargetCount = seedSpendingCategoryTargets(db);
    const spendingMappingCount = seedSpendingCategoryMappings(db);
    if (withDemo) {
      seedDemoCredentials(db);
    }

    db.exec('COMMIT');
    transactionStarted = false;

    // Count income rules
    const incomeRulesCount = db.prepare('SELECT COUNT(*) as count FROM categorization_rules WHERE category_type = ?').get('income').count;

    console.log('✅ Schema created with foreign keys and indexes');
    console.log(`✅ Seeded ${institutionCount} financial institutions`);
    console.log(`✅ Seeded ${helpers.categoriesByKey.size} category definitions`);
    console.log(`✅ Seeded ${CATEGORY_MAPPINGS.length} category mappings`);
    console.log(`✅ Seeded ${incomeRulesCount} income categorization rules`);
    console.log(`✅ Seeded ${spendingTargetCount} spending category targets`);
    console.log(`✅ Seeded ${spendingMappingCount} spending category mappings`);
    console.log('\nDone. You can now run `npm run dev` to start the app against the new database.\n');
  } catch (error) {
    if (transactionStarted && db.inTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback transaction:', rollbackError);
      }
    }
    throw error;
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error('\n❌ Failed to initialise database:');
  console.error(error.message);
  process.exit(1);
}
