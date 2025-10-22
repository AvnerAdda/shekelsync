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

function parseArgs() {
  const args = process.argv.slice(2);
  let output = DEFAULT_DB_PATH;
  let force = false;

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
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { output, force };
}

function printHelp() {
  console.log(`Usage: node scripts/init_sqlite_db.js [options]

Options:
  -o, --output <path>   Output database file (default: dist/clarify.sqlite)
  -f, --force           Overwrite existing database file
  -h, --help            Show this help message
`);
}

const TABLE_DEFINITIONS = [
  `CREATE TABLE IF NOT EXISTS category_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_en TEXT,
      category_type TEXT NOT NULL CHECK (category_type IN ('expense','income','investment')),
      parent_id INTEGER,
      display_order INTEGER NOT NULL DEFAULT 0,
      icon TEXT,
      color TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(name, parent_id, category_type),
      FOREIGN KEY (parent_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS category_mapping (
      hebrew_category TEXT PRIMARY KEY,
      category_definition_id INTEGER NOT NULL,
      description TEXT,
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS merchant_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_pattern TEXT NOT NULL,
      category_definition_id INTEGER NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(merchant_pattern),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS category_actionability_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_definition_id INTEGER NOT NULL UNIQUE,
      actionability_level TEXT NOT NULL DEFAULT 'medium' CHECK (actionability_level IN ('low','medium','high')),
      monthly_average REAL NOT NULL DEFAULT 0,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0,1)),
      user_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      employment_status TEXT
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(id_number, username, vendor)
    );`,
  `CREATE TABLE IF NOT EXISTS transactions (
      identifier TEXT NOT NULL,
      vendor TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      category TEXT,
      type TEXT NOT NULL,
      processed_date TEXT,
      original_amount REAL,
      original_currency TEXT,
      charged_currency TEXT,
      memo TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      parent_category TEXT,
      subcategory TEXT,
      merchant_name TEXT,
      auto_categorized INTEGER NOT NULL DEFAULT 0 CHECK (auto_categorized IN (0,1)),
      confidence_score REAL NOT NULL DEFAULT 0.0,
      account_number TEXT,
      category_definition_id INTEGER,
      category_type TEXT,
      transaction_datetime TEXT,
      processed_datetime TEXT,
      PRIMARY KEY (identifier, vendor),
      FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS categorization_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_pattern TEXT NOT NULL,
      target_category TEXT NOT NULL,
      parent_category TEXT,
      subcategory TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      category_definition_id INTEGER,
      category_type TEXT,
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
  `CREATE TABLE IF NOT EXISTS duplicate_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_name TEXT NOT NULL,
      pattern_regex TEXT NOT NULL,
      description TEXT,
      match_type TEXT NOT NULL,
      override_category TEXT,
      override_category_definition_id INTEGER,
      is_user_defined INTEGER NOT NULL DEFAULT 0 CHECK (is_user_defined IN (0,1)),
      is_auto_learned INTEGER NOT NULL DEFAULT 0 CHECK (is_auto_learned IN (0,1)),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      confidence REAL NOT NULL DEFAULT 1.0,
      match_count INTEGER NOT NULL DEFAULT 0,
      last_matched_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      notes TEXT
    ,
      FOREIGN KEY (override_category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS manual_exclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_identifier TEXT NOT NULL,
      transaction_vendor TEXT NOT NULL,
      exclusion_reason TEXT NOT NULL,
      override_category TEXT,
      override_category_definition_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(transaction_identifier, transaction_vendor),
      FOREIGN KEY (transaction_identifier, transaction_vendor)
        REFERENCES transactions(identifier, vendor)
        ON DELETE CASCADE,
      FOREIGN KEY (override_category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
    );`,
  `CREATE TABLE IF NOT EXISTS transaction_duplicates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction1_identifier TEXT NOT NULL,
      transaction1_vendor TEXT NOT NULL,
      transaction2_identifier TEXT NOT NULL,
      transaction2_vendor TEXT NOT NULL,
      match_type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      is_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (is_confirmed IN (0,1)),
      exclude_from_totals INTEGER NOT NULL DEFAULT 1 CHECK (exclude_from_totals IN (0,1)),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at TEXT,
      confirmed_by TEXT,
      override_category TEXT,
      UNIQUE(transaction1_identifier, transaction1_vendor, transaction2_identifier, transaction2_vendor),
      FOREIGN KEY (transaction1_identifier, transaction1_vendor)
        REFERENCES transactions(identifier, vendor)
        ON DELETE CASCADE,
      FOREIGN KEY (transaction2_identifier, transaction2_vendor)
        REFERENCES transactions(identifier, vendor)
        ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS user_action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      potential_savings REAL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','dismissed')),
      category_name TEXT,
      target_amount REAL,
      current_progress REAL NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'medium',
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      dismissed_at TEXT
    );`,
  `CREATE TABLE IF NOT EXISTS action_item_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_item_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      actual_amount REAL,
      target_amount REAL,
      achieved_savings REAL,
      progress_percentage REAL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (action_item_id) REFERENCES user_action_items(id) ON DELETE CASCADE
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_liquid INTEGER,
      investment_category TEXT
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS investment_holdings_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      total_value REAL NOT NULL,
      cost_basis REAL,
      snapshot_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
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
      confidence REAL,
      match_reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
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
  `CREATE TABLE IF NOT EXISTS recurring_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_name TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      frequency TEXT,
      expected_amount REAL,
      amount_tolerance REAL NOT NULL DEFAULT 10.0,
      last_occurrence_date TEXT,
      next_expected_date TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  `CREATE TABLE IF NOT EXISTS recurring_transaction_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_pattern TEXT NOT NULL,
      category_name TEXT,
      parent_category TEXT,
      frequency TEXT,
      average_amount REAL,
      amount_variance REAL,
      last_transaction_date TEXT,
      next_expected_date TEXT,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      confidence_score REAL,
      is_subscription INTEGER NOT NULL DEFAULT 0 CHECK (is_subscription IN (0,1)),
      user_status TEXT NOT NULL DEFAULT 'active',
      optimization_note TEXT,
      potential_savings REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  `CREATE TABLE IF NOT EXISTS spending_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL,
      subcategory TEXT,
      period_type TEXT NOT NULL CHECK (period_type IN ('weekly','monthly','yearly')),
      avg_amount REAL NOT NULL,
      std_deviation REAL NOT NULL DEFAULT 0,
      min_amount REAL NOT NULL DEFAULT 0,
      max_amount REAL NOT NULL DEFAULT 0,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      last_calculated TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category, subcategory, period_type)
    );`,
  `CREATE TABLE IF NOT EXISTS spending_anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_identifier TEXT NOT NULL,
      transaction_vendor TEXT NOT NULL,
      anomaly_type TEXT NOT NULL,
      category TEXT,
      subcategory TEXT,
      expected_amount REAL,
      actual_amount REAL,
      deviation_percentage REAL,
      severity TEXT,
      is_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (is_dismissed IN (0,1)),
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (transaction_identifier, transaction_vendor)
        REFERENCES transactions(identifier, vendor)
        ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS scrape_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      triggered_by TEXT,
      vendor TEXT NOT NULL,
      start_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`
];

const INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_action_items_created ON user_action_items (created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_action_items_priority ON user_action_items (priority);',
  'CREATE INDEX IF NOT EXISTS idx_action_items_status ON user_action_items (status);',
  'CREATE INDEX IF NOT EXISTS idx_action_progress_item ON action_item_progress (action_item_id);',
  'CREATE INDEX IF NOT EXISTS idx_action_progress_month ON action_item_progress (month DESC);',
  'CREATE INDEX IF NOT EXISTS idx_actionability_amount ON category_actionability_settings (monthly_average DESC);',
  'CREATE INDEX IF NOT EXISTS idx_actionability_category ON category_actionability_settings (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_actionability_level ON category_actionability_settings (actionability_level);',
  'CREATE INDEX IF NOT EXISTS idx_anomalies_dismissed ON spending_anomalies (is_dismissed, detected_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_anomalies_transaction ON spending_anomalies (transaction_identifier, transaction_vendor);',
  'CREATE INDEX IF NOT EXISTS idx_categorization_rules_active ON categorization_rules (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_categorization_rules_active_priority ON categorization_rules (is_active, priority DESC) WHERE (is_active = 1);',
  'CREATE INDEX IF NOT EXISTS idx_categorization_rules_pattern ON categorization_rules (name_pattern);',
  'CREATE INDEX IF NOT EXISTS idx_category_budgets_active ON category_budgets (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_category_budgets_category_id ON category_budgets (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_category_definitions_active ON category_definitions (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_category_definitions_parent ON category_definitions (parent_id);',
  'CREATE INDEX IF NOT EXISTS idx_category_definitions_type ON category_definitions (category_type);',
  'CREATE INDEX IF NOT EXISTS idx_category_mapping_category ON category_mapping (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_merchant_catalog_pattern ON merchant_catalog (merchant_pattern);',
  'CREATE INDEX IF NOT EXISTS idx_merchant_catalog_active ON merchant_catalog (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_children_birth_date ON children_profile (birth_date);',
  'CREATE INDEX IF NOT EXISTS idx_children_education_stage ON children_profile (education_stage);',
  'CREATE INDEX IF NOT EXISTS idx_children_profile_user_id ON children_profile (user_profile_id);',
  'CREATE INDEX IF NOT EXISTS idx_duplicate_patterns_active ON duplicate_patterns (is_active, match_type);',
  'CREATE INDEX IF NOT EXISTS idx_duplicate_patterns_regex ON duplicate_patterns (pattern_regex);',
  'CREATE INDEX IF NOT EXISTS idx_duplicate_patterns_override_cat_id ON duplicate_patterns (override_category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_duplicates_confirmed ON transaction_duplicates (is_confirmed, exclude_from_totals);',
  'CREATE INDEX IF NOT EXISTS idx_duplicates_match_type ON transaction_duplicates (match_type);',
  'CREATE INDEX IF NOT EXISTS idx_duplicates_transaction1 ON transaction_duplicates (transaction1_identifier, transaction1_vendor);',
  'CREATE INDEX IF NOT EXISTS idx_duplicates_transaction2 ON transaction_duplicates (transaction2_identifier, transaction2_vendor);',
  'CREATE INDEX IF NOT EXISTS idx_holdings_history_account ON investment_holdings_history (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_holdings_history_date ON investment_holdings_history (snapshot_date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_investment_accounts_active ON investment_accounts (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_investment_accounts_category ON investment_accounts (investment_category) WHERE investment_category IS NOT NULL;',
  'CREATE INDEX IF NOT EXISTS idx_investment_accounts_is_liquid ON investment_accounts (is_liquid) WHERE is_liquid IS NOT NULL;',
  'CREATE INDEX IF NOT EXISTS idx_investment_accounts_type ON investment_accounts (account_type);',
  'CREATE INDEX IF NOT EXISTS idx_investment_assets_account ON investment_assets (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_investment_assets_active ON investment_assets (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_investment_assets_symbol ON investment_assets (asset_symbol);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_account ON investment_holdings (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_investment_holdings_date ON investment_holdings (as_of_date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_manual_exclusions_category ON manual_exclusions (override_category);',
  'CREATE INDEX IF NOT EXISTS idx_manual_exclusions_category_id ON manual_exclusions (override_category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_manual_exclusions_reason ON manual_exclusions (exclusion_reason);',
  'CREATE INDEX IF NOT EXISTS idx_manual_exclusions_transaction ON manual_exclusions (transaction_identifier, transaction_vendor);',
  'CREATE INDEX IF NOT EXISTS idx_patterns_account ON account_transaction_patterns (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_transaction_suggestions (created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_transaction_suggestions (status);',
  'CREATE INDEX IF NOT EXISTS idx_recurring_confidence ON recurring_transaction_analysis (confidence_score DESC);',
  'CREATE INDEX IF NOT EXISTS idx_recurring_merchant ON recurring_transactions (merchant_name, is_active);',
  'CREATE INDEX IF NOT EXISTS idx_recurring_next_date ON recurring_transactions (next_expected_date, is_active);',
  'CREATE INDEX IF NOT EXISTS idx_recurring_status ON recurring_transaction_analysis (user_status);',
  'CREATE INDEX IF NOT EXISTS idx_scrape_events_created_at ON scrape_events (created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_scrape_events_vendor ON scrape_events (vendor);',
  'CREATE INDEX IF NOT EXISTS idx_spending_patterns_calculated ON spending_patterns (last_calculated DESC);',
  'CREATE INDEX IF NOT EXISTS idx_spending_patterns_category ON spending_patterns (category, subcategory);',
  'CREATE INDEX IF NOT EXISTS idx_spouse_profile_user_id ON spouse_profile (user_profile_id);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_account_number ON transactions (account_number);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category_def ON transactions (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category_type ON transactions (category_type);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_category ON transactions (date, category);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_desc ON transactions (date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_vendor ON transactions (date, vendor);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_datetime ON transactions (transaction_datetime);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_parent_category ON transactions (parent_category);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_price ON transactions (price);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions (vendor);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor_datetime ON transactions (vendor, transaction_datetime DESC);',
  'CREATE INDEX IF NOT EXISTS idx_txn_links_account ON transaction_account_links (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_txn_links_identifier ON transaction_account_links (transaction_identifier);',
  'CREATE INDEX IF NOT EXISTS idx_vendor_credentials_last_scrape ON vendor_credentials (vendor, last_scrape_success DESC);',
  'CREATE INDEX IF NOT EXISTS idx_vendor_credentials_vendor ON vendor_credentials (vendor);'
];

const CATEGORY_TREE = [
  { key: 'expense_root', type: 'expense', name: 'הוצאות', nameEn: 'Expenses', displayOrder: 10 },

  { key: 'exp_food', type: 'expense', parent: 'expense_root', name: 'אוכל', nameEn: 'Food & Dining', displayOrder: 20 },
  { key: 'exp_food_grocery', type: 'expense', parent: 'exp_food', name: 'סופרמרקט', nameEn: 'Groceries', displayOrder: 21 },
  { key: 'exp_food_restaurants', type: 'expense', parent: 'exp_food', name: 'מסעדות', nameEn: 'Restaurants', displayOrder: 22 },
  { key: 'exp_food_coffee', type: 'expense', parent: 'exp_food', name: 'קפה ומאפה', nameEn: 'Coffee & Pastries', displayOrder: 23 },
  { key: 'exp_food_delivery', type: 'expense', parent: 'exp_food', name: 'משלוחים', nameEn: 'Delivery', displayOrder: 24 },

  { key: 'exp_transport', type: 'expense', parent: 'expense_root', name: 'תחבורה', nameEn: 'Transportation', displayOrder: 30 },
  { key: 'exp_transport_fuel', type: 'expense', parent: 'exp_transport', name: 'דלק', nameEn: 'Fuel', displayOrder: 31 },
  { key: 'exp_transport_public', type: 'expense', parent: 'exp_transport', name: 'תחבורה ציבורית', nameEn: 'Public Transport', displayOrder: 32 },
  { key: 'exp_transport_parking', type: 'expense', parent: 'exp_transport', name: 'חניה', nameEn: 'Parking', displayOrder: 33 },
  { key: 'exp_transport_taxi', type: 'expense', parent: 'exp_transport', name: 'מוניות', nameEn: 'Taxis', displayOrder: 34 },
  { key: 'exp_transport_rideshare', type: 'expense', parent: 'exp_transport', name: 'שיתוף רכב', nameEn: 'Ride Sharing', displayOrder: 35 },

  { key: 'exp_bills', type: 'expense', parent: 'expense_root', name: 'חשבונות', nameEn: 'Bills & Utilities', displayOrder: 40 },
  { key: 'exp_bills_rent', type: 'expense', parent: 'exp_bills', name: 'שכירות ומשכנתא', nameEn: 'Rent & Mortgage', displayOrder: 41 },
  { key: 'exp_bills_internet', type: 'expense', parent: 'exp_bills', name: 'אינטרנט וטלוויזיה', nameEn: 'Internet & TV', displayOrder: 42 },
  { key: 'exp_bills_communication', type: 'expense', parent: 'exp_bills', name: 'תקשורת', nameEn: 'Mobile & Communications', displayOrder: 43 },
  { key: 'exp_bills_electricity', type: 'expense', parent: 'exp_bills', name: 'חשמל', nameEn: 'Electricity', displayOrder: 44 },
  { key: 'exp_bills_water', type: 'expense', parent: 'exp_bills', name: 'מים', nameEn: 'Water', displayOrder: 45 },
  { key: 'exp_bills_bank', type: 'expense', parent: 'exp_bills', name: 'תשלומי בנק', nameEn: 'Bank Settlements', displayOrder: 46 },

  { key: 'exp_health', type: 'expense', parent: 'expense_root', name: 'בריאות', nameEn: 'Health & Wellness', displayOrder: 50 },
  { key: 'exp_health_medical', type: 'expense', parent: 'exp_health', name: 'בריאות כללית', nameEn: 'Medical Services', displayOrder: 51 },
  { key: 'exp_health_pharmacy', type: 'expense', parent: 'exp_health', name: 'בית מרקחת', nameEn: 'Pharmacy', displayOrder: 52 },

  { key: 'exp_leisure', type: 'expense', parent: 'expense_root', name: 'פנאי', nameEn: 'Leisure & Entertainment', displayOrder: 60 },
  { key: 'exp_leisure_entertainment', type: 'expense', parent: 'exp_leisure', name: 'בילויים', nameEn: 'Outings', displayOrder: 61 },
  { key: 'exp_leisure_streaming', type: 'expense', parent: 'exp_leisure', name: 'סטרימינג', nameEn: 'Streaming Services', displayOrder: 62 },
  { key: 'exp_leisure_cinema', type: 'expense', parent: 'exp_leisure', name: 'קולנוע', nameEn: 'Cinema', displayOrder: 63 },
  { key: 'exp_leisure_travel', type: 'expense', parent: 'exp_leisure', name: 'חופשות', nameEn: 'Travel & Holidays', displayOrder: 64 },

  { key: 'exp_shopping', type: 'expense', parent: 'expense_root', name: 'קניות', nameEn: 'Shopping', displayOrder: 70 },
  { key: 'exp_shopping_clothing', type: 'expense', parent: 'exp_shopping', name: 'ביגוד', nameEn: 'Clothing', displayOrder: 71 },
  { key: 'exp_shopping_shoes', type: 'expense', parent: 'exp_shopping', name: 'נעליים', nameEn: 'Footwear', displayOrder: 72 },
  { key: 'exp_shopping_housewares', type: 'expense', parent: 'exp_shopping', name: 'כלי בית', nameEn: 'Housewares', displayOrder: 73 },
  { key: 'exp_shopping_furniture', type: 'expense', parent: 'exp_shopping', name: 'רהיטים', nameEn: 'Furniture', displayOrder: 74 },
  { key: 'exp_shopping_electronics', type: 'expense', parent: 'exp_shopping', name: 'אלקטרוניקה', nameEn: 'Electronics', displayOrder: 75 },
  { key: 'exp_shopping_gifts', type: 'expense', parent: 'exp_shopping', name: 'מתנות', nameEn: 'Gifts', displayOrder: 76 },

  { key: 'exp_education', type: 'expense', parent: 'expense_root', name: 'חינוך', nameEn: 'Education', displayOrder: 80 },
  { key: 'exp_education_higher', type: 'expense', parent: 'exp_education', name: 'לימודים גבוהים', nameEn: 'Higher Education', displayOrder: 81 },
  { key: 'exp_education_online', type: 'expense', parent: 'exp_education', name: 'קורסים מקוונים', nameEn: 'Online Courses', displayOrder: 82 },

  { key: 'exp_misc', type: 'expense', parent: 'expense_root', name: 'שונות', nameEn: 'Miscellaneous', displayOrder: 90 },
  { key: 'exp_misc_other', type: 'expense', parent: 'exp_misc', name: 'הוצאות אחרות', nameEn: 'Other Expenses', displayOrder: 91 },

  { key: 'income_root', type: 'income', name: 'הכנסות', nameEn: 'Income', displayOrder: 100 },
  { key: 'income_salary', type: 'income', parent: 'income_root', name: 'משכורת', nameEn: 'Salary', displayOrder: 101 },
  { key: 'income_freelance', type: 'income', parent: 'income_root', name: 'פרילנס', nameEn: 'Freelance & Side Hustle', displayOrder: 102 },
  { key: 'income_refunds', type: 'income', parent: 'income_root', name: 'החזרים וזיכויים', nameEn: 'Refunds & Credits', displayOrder: 103 },
  { key: 'income_gifts', type: 'income', parent: 'income_root', name: 'מתנות', nameEn: 'Gifts & Windfalls', displayOrder: 104 },

  { key: 'investment_root', type: 'investment', name: 'השקעות', nameEn: 'Investments', displayOrder: 200 },
  { key: 'investment_stocks', type: 'investment', parent: 'investment_root', name: 'מניות', nameEn: 'Stocks & ETFs', displayOrder: 201 },
  { key: 'investment_crypto', type: 'investment', parent: 'investment_root', name: 'קריפטו', nameEn: 'Crypto Assets', displayOrder: 202 },
  { key: 'investment_retirement', type: 'investment', parent: 'investment_root', name: 'פנסיה וחיסכון', nameEn: 'Retirement & Savings', displayOrder: 203 },
  { key: 'investment_real_estate', type: 'investment', parent: 'investment_root', name: 'נדל"ן', nameEn: 'Real Estate', displayOrder: 204 }
];

const CATEGORY_MAPPINGS = [
  { term: 'שופרסל', categoryKey: 'exp_food_grocery', description: 'רשת סופרמרקטים' },
  { term: 'AM:PM', categoryKey: 'exp_food_grocery', description: 'מכולות וקמעונות מזון' },
  { term: 'סופר-פארם', categoryKey: 'exp_health_pharmacy', description: 'רשת פארם' },
  { term: 'מקדונלדס', categoryKey: 'exp_food_restaurants', description: 'מסעדות מזון מהיר' },
  { term: 'בורגראנץ', categoryKey: 'exp_food_restaurants', description: 'מזון מהיר' },
  { term: 'קופיקס', categoryKey: 'exp_food_coffee', description: 'בתי קפה' },
  { term: 'תן ביס', categoryKey: 'exp_food_delivery', description: 'משלוחי אוכל' },

  { term: 'גט', categoryKey: 'exp_transport_taxi', description: 'נסיעות במוניות Gett' },
  { term: 'GETT', categoryKey: 'exp_transport_taxi', description: 'חברת מוניות' },
  { term: 'uber', categoryKey: 'exp_transport_rideshare', description: 'נסיעות שיתופיות' },
  { term: 'פז', categoryKey: 'exp_transport_fuel', description: 'תחנות דלק' },

  { term: 'בזק', categoryKey: 'exp_bills_internet', description: 'שירותי אינטרנט/טלוויזיה' },
  { term: 'HOT', categoryKey: 'exp_bills_internet', description: 'טלוויזיה ואינטרנט' },
  { term: 'Cellcom', categoryKey: 'exp_bills_communication', description: 'תקשורת סלולרית' },
  { term: 'IEC', categoryKey: 'exp_bills_electricity', description: 'חברת חשמל' },
  { term: 'חשמל', categoryKey: 'exp_bills_electricity', description: 'חיוב חשמל' },
  { term: 'מים', categoryKey: 'exp_bills_water', description: 'חיוב מים' },
  { term: 'MAX IT PAY', categoryKey: 'exp_bills_bank', description: 'הורדת חיובי אשראי' },

  { term: 'איקאה', categoryKey: 'exp_shopping_furniture', description: 'ריהוט לבית' },
  { term: 'ACE', categoryKey: 'exp_shopping_housewares', description: 'ציוד לבית ולגן' },
  { term: 'ZARA', categoryKey: 'exp_shopping_clothing', description: 'אופנה' },
  { term: 'Castro', categoryKey: 'exp_shopping_clothing', description: 'אופנה ישראלית' },
  { term: 'Nike', categoryKey: 'exp_shopping_shoes', description: 'נעליים וביגוד ספורט' },

  { term: 'נטפליקס', categoryKey: 'exp_leisure_streaming', description: 'שירותי סטרימינג' },
  { term: 'Yes Planet', categoryKey: 'exp_leisure_cinema', description: 'בתי קולנוע' },
  { term: 'YES PLANET', categoryKey: 'exp_leisure_cinema', description: 'בתי קולנוע' },
  { term: 'Coursera', categoryKey: 'exp_education_online', description: 'קורסים מקוונים' },
  { term: 'Udemy', categoryKey: 'exp_education_online', description: 'קורסים מקוונים' }
];

function seedCategories(db) {
  const insert = db.prepare(`
    INSERT INTO category_definitions
      (name, name_en, category_type, parent_id, display_order, icon, color, description, is_active)
    VALUES
      (@name, @nameEn, @type, @parentId, @displayOrder, @icon, @color, @description, 1)
  `);

  const categoriesByKey = new Map();
  const leafTracker = new Map();

  db.transaction(() => {
    for (const category of CATEGORY_TREE) {
      const parent = category.parent ? categoriesByKey.get(category.parent) : null;
      const info = insert.run({
        name: category.name,
        nameEn: category.nameEn || null,
        type: category.type,
        parentId: parent ? parent.id : null,
        displayOrder: category.displayOrder ?? 0,
        icon: category.icon || null,
        color: category.color || null,
        description: category.description || null
      });

      const record = {
        id: info.lastInsertRowid,
        name: category.name,
        nameEn: category.nameEn || null,
        type: category.type,
        parentKey: category.parent || null
      };

      categoriesByKey.set(category.key, record);
      leafTracker.set(category.key, true);
      if (category.parent) {
        leafTracker.set(category.parent, false);
      }
    }
  })();

  return { categoriesByKey, leafTracker };
}

function seedCategoryActionability(db, helpers) {
  const { categoriesByKey, leafTracker } = helpers;
  const insert = db.prepare(`
    INSERT INTO category_actionability_settings (
      category_definition_id,
      actionability_level,
      monthly_average,
      transaction_count,
      is_default,
      user_notes
    ) VALUES (?, 'medium', 0, 0, 1, NULL)
  `);

  const expenseLeaves = Array.from(categoriesByKey.entries())
    .filter(([key, info]) => info.type === 'expense' && leafTracker.get(key));

  db.transaction(() => {
    for (const [, info] of expenseLeaves) {
      insert.run(info.id);
    }
  })();
}

function seedCategoryMapping(db, helpers) {
  const { categoriesByKey } = helpers;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO category_mapping (hebrew_category, category_definition_id, description)
    VALUES (@term, @categoryId, @description)
  `);

  db.transaction(() => {
    for (const mapping of CATEGORY_MAPPINGS) {
      const category = categoriesByKey.get(mapping.categoryKey);
      if (!category) {
        continue;
      }
      insert.run({
        term: mapping.term,
        categoryId: category.id,
        description: mapping.description || null
      });
    }
  })();
}

function ensureDestination(outputPath, force) {
  if (fs.existsSync(outputPath)) {
    if (!force) {
      throw new Error(`Destination ${outputPath} already exists. Use --force to overwrite.`);
    }
    fs.unlinkSync(outputPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

function main() {
  const { output, force } = parseArgs();
  ensureDestination(output, force);

  console.log(`\n📦 Initialising SQLite database at ${output}\n`);
  const db = new Database(output);

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec('BEGIN');
    for (const statement of TABLE_DEFINITIONS) {
      db.exec(statement);
    }
    for (const statement of INDEX_STATEMENTS) {
      db.exec(statement);
    }

    const helpers = seedCategories(db);
    seedCategoryActionability(db, helpers);
    seedCategoryMapping(db, helpers);

    db.exec('COMMIT');

    const expenseLeafCount = Array.from(helpers.categoriesByKey.entries())
      .filter(([key]) => helpers.leafTracker.get(key) && helpers.categoriesByKey.get(key).type === 'expense')
      .length;

    console.log('✅ Schema created with foreign keys and indexes');
    console.log(`✅ Seeded ${helpers.categoriesByKey.size} category definitions`);
    console.log(`✅ Seeded ${expenseLeafCount} default actionability entries`);
    console.log(`✅ Seeded ${CATEGORY_MAPPINGS.length} category mappings`);
    console.log('\nDone. You can now run `npm run dev` to start the app against the new database.\n');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback transaction:', rollbackError);
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
