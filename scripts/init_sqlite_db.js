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
  `CREATE TABLE IF NOT EXISTS financial_institutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_code TEXT NOT NULL UNIQUE,
      institution_type TEXT NOT NULL CHECK (institution_type IN ('bank','credit_card','investment','insurance','broker','crypto','other')),
      display_name_he TEXT NOT NULL,
      display_name_en TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('banking','investments','insurance','brokerage','crypto','other')),
      subcategory TEXT,
      is_scrapable INTEGER NOT NULL DEFAULT 0 CHECK (is_scrapable IN (0,1)),
      logo_url TEXT,
      scraper_company_id TEXT,
      credential_fields TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
      display_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
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
      FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE SET NULL
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
      institution_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_liquid INTEGER,
      investment_category TEXT,
      FOREIGN KEY (institution_id) REFERENCES financial_institutions(id) ON DELETE SET NULL
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
      UNIQUE(account_id, as_of_date),
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
      UNIQUE(account_id, snapshot_date),
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
  `CREATE TABLE IF NOT EXISTS account_pairings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_card_vendor TEXT NOT NULL,
      credit_card_account_number TEXT,
      bank_vendor TEXT NOT NULL,
      bank_account_number TEXT,
      match_patterns TEXT,
      is_active INTEGER DEFAULT 1,
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
  'CREATE INDEX IF NOT EXISTS idx_financial_institutions_vendor_code ON financial_institutions (vendor_code);',
  'CREATE INDEX IF NOT EXISTS idx_financial_institutions_type ON financial_institutions (institution_type);',
  'CREATE INDEX IF NOT EXISTS idx_financial_institutions_category ON financial_institutions (category);',
  'CREATE INDEX IF NOT EXISTS idx_financial_institutions_active ON financial_institutions (is_active);',
  'CREATE INDEX IF NOT EXISTS idx_financial_institutions_scrapable ON financial_institutions (is_scrapable);',
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
  'CREATE INDEX IF NOT EXISTS idx_category_hierarchy_path ON category_definitions (hierarchy_path);',
  'CREATE INDEX IF NOT EXISTS idx_category_depth_level ON category_definitions (depth_level);',
  'CREATE INDEX IF NOT EXISTS idx_category_mapping_category ON category_mapping (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_children_birth_date ON children_profile (birth_date);',
  'CREATE INDEX IF NOT EXISTS idx_children_education_stage ON children_profile (education_stage);',
  'CREATE INDEX IF NOT EXISTS idx_children_profile_user_id ON children_profile (user_profile_id);',
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
  'CREATE INDEX IF NOT EXISTS idx_patterns_account ON account_transaction_patterns (account_id);',
  'CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_transaction_suggestions (created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_transaction_suggestions (status);',
  'CREATE INDEX IF NOT EXISTS idx_pending_account_type ON pending_transaction_suggestions (suggested_account_type);',
  'CREATE INDEX IF NOT EXISTS idx_pending_dismissed ON pending_transaction_suggestions (dismiss_count, last_dismissed_at);',
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
  'CREATE INDEX IF NOT EXISTS idx_transactions_category_def ON transactions (category_definition_id);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category_type ON transactions (category_type);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_desc ON transactions (date DESC);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_date_vendor ON transactions (date, vendor);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_datetime ON transactions (transaction_datetime);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_price ON transactions (price);',
  'CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions (vendor);',
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
  'CREATE INDEX IF NOT EXISTS idx_pairing_log_created_at ON account_pairing_log(created_at);'
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

  // ========== INVESTMENT TYPES (Manual Entry) ==========
  { code: 'pension', type: 'investment', nameHe: 'קרן פנסיה', nameEn: 'Pension Fund', category: 'investments', subcategory: 'restricted', scrapable: 0, displayOrder: 300 },
  { code: 'provident', type: 'investment', nameHe: 'קרן השתלמות', nameEn: 'Provident Fund', category: 'investments', subcategory: 'restricted', scrapable: 0, displayOrder: 310 },
  { code: 'study_fund', type: 'investment', nameHe: 'קופת גמל', nameEn: 'Study Fund', category: 'investments', subcategory: 'restricted', scrapable: 0, displayOrder: 320 },
  { code: 'savings', type: 'investment', nameHe: 'פיקדון', nameEn: 'Savings', category: 'investments', subcategory: 'liquid', scrapable: 0, displayOrder: 330 },
  { code: 'brokerage', type: 'investment', nameHe: 'ברוקר', nameEn: 'Brokerage', category: 'investments', subcategory: 'liquid', scrapable: 0, displayOrder: 340 },
  { code: 'crypto', type: 'investment', nameHe: 'קריפטו', nameEn: 'Crypto', category: 'investments', subcategory: 'liquid', scrapable: 0, displayOrder: 350 },
  { code: 'mutual_fund', type: 'investment', nameHe: 'קרנות נאמנות', nameEn: 'Mutual Funds', category: 'investments', subcategory: 'liquid', scrapable: 0, displayOrder: 360 },
  { code: 'bonds', type: 'investment', nameHe: 'אג"ח', nameEn: 'Bonds', category: 'investments', subcategory: 'alternative', scrapable: 0, displayOrder: 370 },
  { code: 'real_estate', type: 'investment', nameHe: 'נדל"ן', nameEn: 'Real Estate', category: 'investments', subcategory: 'alternative', scrapable: 0, displayOrder: 380 },
  { code: 'cash', type: 'investment', nameHe: 'מזומן', nameEn: 'Cash', category: 'investments', subcategory: 'cash', scrapable: 0, displayOrder: 390 },
  { code: 'foreign_bank', type: 'investment', nameHe: 'בנק חוץ', nameEn: 'Foreign Bank', category: 'investments', subcategory: 'cash', scrapable: 0, displayOrder: 400 },
  { code: 'foreign_investment', type: 'investment', nameHe: 'השקעה חוץ', nameEn: 'Foreign Investment', category: 'investments', subcategory: 'alternative', scrapable: 0, displayOrder: 410 },
  { code: 'other_investment', type: 'investment', nameHe: 'אחר', nameEn: 'Other', category: 'investments', subcategory: 'alternative', scrapable: 0, displayOrder: 420 },

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

  // ========== CRYPTO EXCHANGES ==========
  { code: 'bit2c', type: 'crypto', nameHe: 'Bit2C', nameEn: 'Bit2C', category: 'crypto', scrapable: 0, displayOrder: 700, notes: 'Israeli cryptocurrency exchange regulated by ISA' },
  { code: 'bits_of_gold', type: 'crypto', nameHe: 'Bits of Gold', nameEn: 'Bits of Gold', category: 'crypto', scrapable: 0, displayOrder: 710, notes: 'Largest Israeli crypto brokerage' },
  { code: 'coins', type: 'crypto', nameHe: 'Coins', nameEn: 'Coins.co.il', category: 'crypto', scrapable: 0, displayOrder: 720, notes: 'Israeli crypto exchange' },
  { code: 'binance', type: 'crypto', nameHe: 'בינאנס', nameEn: 'Binance', category: 'crypto', scrapable: 0, displayOrder: 730, notes: 'Global crypto exchange' },
  { code: 'coinbase', type: 'crypto', nameHe: 'קוינבייס', nameEn: 'Coinbase', category: 'crypto', scrapable: 0, displayOrder: 740, notes: 'Global crypto exchange' }
];

const CATEGORY_TREE = [
  // Expenses Root & Main Categories
  { key: 'expense_root', type: 'expense', name: 'הוצאות', nameEn: 'Expenses', displayOrder: 10, color: '#E57373', icon: 'Category' },

  // Food & Dining (Red-Orange tones)
  { key: 'exp_food', type: 'expense', parent: 'expense_root', name: 'אוכל', nameEn: 'Food & Dining', displayOrder: 20, color: '#FF6B6B', icon: 'Restaurant' },
  { key: 'exp_food_grocery', type: 'expense', parent: 'exp_food', name: 'סופרמרקט', nameEn: 'Groceries', displayOrder: 21, color: '#FF8A80', icon: 'ShoppingCart' },
  { key: 'exp_food_restaurants', type: 'expense', parent: 'exp_food', name: 'מסעדות', nameEn: 'Restaurants', displayOrder: 22, color: '#FF5252', icon: 'RestaurantMenu' },
  { key: 'exp_food_coffee', type: 'expense', parent: 'exp_food', name: 'קפה ומאפה', nameEn: 'Coffee & Pastries', displayOrder: 23, color: '#FFAB91', icon: 'LocalCafe' },
  { key: 'exp_food_delivery', type: 'expense', parent: 'exp_food', name: 'משלוחים', nameEn: 'Delivery', displayOrder: 24, color: '#FF7043', icon: 'DeliveryDining' },
  { key: 'exp_food_alcohol', type: 'expense', parent: 'exp_food', name: 'אלכוהול ומשקאות', nameEn: 'Alcohol & Beverages', displayOrder: 25, color: '#F4511E', icon: 'LocalBar' },
  { key: 'exp_food_bakery', type: 'expense', parent: 'exp_food', name: 'מאפייה וקינוחים', nameEn: 'Bakery & Desserts', displayOrder: 26, color: '#FFCCBC', icon: 'Cake' },

  // Transportation (Teal tones)
  { key: 'exp_transport', type: 'expense', parent: 'expense_root', name: 'תחבורה', nameEn: 'Transportation', displayOrder: 30, color: '#4ECDC4', icon: 'DirectionsCar' },
  { key: 'exp_transport_fuel', type: 'expense', parent: 'exp_transport', name: 'דלק', nameEn: 'Fuel', displayOrder: 31, color: '#26A69A', icon: 'LocalGasStation' },
  { key: 'exp_transport_public', type: 'expense', parent: 'exp_transport', name: 'תחבורה ציבורית', nameEn: 'Public Transport', displayOrder: 32, color: '#00897B', icon: 'DirectionsBus' },
  { key: 'exp_transport_parking', type: 'expense', parent: 'exp_transport', name: 'חניה', nameEn: 'Parking', displayOrder: 33, color: '#00695C', icon: 'LocalParking' },
  { key: 'exp_transport_taxi', type: 'expense', parent: 'exp_transport', name: 'מוניות', nameEn: 'Taxis', displayOrder: 34, color: '#4DB6AC', icon: 'LocalTaxi' },
  { key: 'exp_transport_rideshare', type: 'expense', parent: 'exp_transport', name: 'שיתוף רכב', nameEn: 'Ride Sharing', displayOrder: 35, color: '#80CBC4', icon: 'Commute' },
  { key: 'exp_transport_maintenance', type: 'expense', parent: 'exp_transport', name: 'תחזוקת רכב', nameEn: 'Vehicle Maintenance', displayOrder: 36, color: '#B2DFDB', icon: 'Build' },
  { key: 'exp_transport_insurance', type: 'expense', parent: 'exp_transport', name: 'ביטוח רכב', nameEn: 'Vehicle Insurance', displayOrder: 37, color: '#E0F2F1', icon: 'Shield' },
  { key: 'exp_transport_tolls', type: 'expense', parent: 'exp_transport', name: 'כבישי אגרה', nameEn: 'Toll Roads', displayOrder: 38, color: '#009688', icon: 'Toll' },

  // Bills & Utilities (Amber-Yellow tones)
  { key: 'exp_bills', type: 'expense', parent: 'expense_root', name: 'חשבונות', nameEn: 'Bills & Utilities', displayOrder: 40, color: '#FFD93D', icon: 'Receipt' },
  { key: 'exp_bills_rent', type: 'expense', parent: 'exp_bills', name: 'שכירות ומשכנתא', nameEn: 'Rent & Mortgage', displayOrder: 41, color: '#FDD835', icon: 'Home' },
  { key: 'exp_bills_internet', type: 'expense', parent: 'exp_bills', name: 'אינטרנט וטלוויזיה', nameEn: 'Internet & TV', displayOrder: 42, color: '#FBC02D', icon: 'Wifi' },
  { key: 'exp_bills_communication', type: 'expense', parent: 'exp_bills', name: 'תקשורת', nameEn: 'Mobile & Communications', displayOrder: 43, color: '#F9A825', icon: 'Phone' },
  { key: 'exp_bills_electricity', type: 'expense', parent: 'exp_bills', name: 'חשמל', nameEn: 'Electricity', displayOrder: 44, color: '#F57F17', icon: 'Bolt' },
  { key: 'exp_bills_water', type: 'expense', parent: 'exp_bills', name: 'מים', nameEn: 'Water', displayOrder: 45, color: '#42A5F5', icon: 'Water' },
  { key: 'exp_bills_bank', type: 'expense', parent: 'exp_bills', name: 'תשלומי בנק', nameEn: 'Bank Settlements', displayOrder: 46, color: '#7E57C2', icon: 'AccountBalance' },
  { key: 'exp_bills_bank_cc_payment', type: 'expense', parent: 'exp_bills_bank', name: 'פרעון כרטיס אשראי', nameEn: 'Credit Card Repayment', displayOrder: 461, color: '#9575CD', icon: 'CreditCard' },
  { key: 'exp_bills_bank_digital', type: 'expense', parent: 'exp_bills_bank', name: 'העברות דיגיטליות', nameEn: 'Digital Wallet Transfers (BIT/PayBox)', displayOrder: 462, color: '#B39DDB', icon: 'PhoneAndroid' },
  { key: 'exp_bills_bank_fees', type: 'expense', parent: 'exp_bills_bank', name: 'עמלות בנק וכרטיס', nameEn: 'Bank & Card Fees', displayOrder: 463, color: '#D1C4E9', icon: 'MonetizationOn' },
  { key: 'exp_bills_bank_to_investments', type: 'expense', parent: 'exp_bills_bank', name: 'העברות להשקעות', nameEn: 'Transfers to Investments', displayOrder: 464, color: '#673AB7', icon: 'TrendingUp' },
  { key: 'exp_bills_bank_cash', type: 'expense', parent: 'exp_bills_bank', name: 'משיכת מזומן', nameEn: 'Cash Withdrawal', displayOrder: 465, color: '#4CAF50', icon: 'LocalAtm' },
  { key: 'exp_bills_bank_inv_tax', type: 'expense', parent: 'exp_bills_bank', name: 'מס על השקעות', nameEn: 'Investment Tax Withholding', displayOrder: 466, color: '#EDE7F6', icon: 'Receipt' },
  { key: 'exp_bills_insurance', type: 'expense', parent: 'exp_bills', name: 'ביטוח', nameEn: 'Insurance', displayOrder: 47, color: '#64DD17', icon: 'Security' },
  { key: 'exp_bills_municipal', type: 'expense', parent: 'exp_bills', name: 'מיסים עירוניים', nameEn: 'Municipal Taxes', displayOrder: 48, color: '#558B2F', icon: 'Apartment' },
  { key: 'exp_bills_gas', type: 'expense', parent: 'exp_bills', name: 'גז', nameEn: 'Gas', displayOrder: 49, color: '#F57C00', icon: 'Fireplace' },
  { key: 'exp_bills_security', type: 'expense', parent: 'exp_bills', name: 'אבטחה', nameEn: 'Security Services', displayOrder: 50, color: '#616161', icon: 'SecurityOutlined' },

  // Health & Wellness (Mint-Green tones)
  { key: 'exp_health', type: 'expense', parent: 'expense_root', name: 'בריאות', nameEn: 'Health & Wellness', displayOrder: 50, color: '#95E1D3', icon: 'LocalHospital' },
  { key: 'exp_health_medical', type: 'expense', parent: 'exp_health', name: 'בריאות כללית', nameEn: 'Medical Services', displayOrder: 51, color: '#4DB6AC', icon: 'MedicalServices' },
  { key: 'exp_health_pharmacy', type: 'expense', parent: 'exp_health', name: 'בית מרקחת', nameEn: 'Pharmacy', displayOrder: 52, color: '#26A69A', icon: 'LocalPharmacy' },
  { key: 'exp_health_dental', type: 'expense', parent: 'exp_health', name: 'שיניים', nameEn: 'Dental Care', displayOrder: 53, color: '#00897B', icon: 'Medication' },
  { key: 'exp_health_vision', type: 'expense', parent: 'exp_health', name: 'עיניים ואופטיקה', nameEn: 'Vision & Optometry', displayOrder: 54, color: '#00695C', icon: 'Visibility' },
  { key: 'exp_health_fitness', type: 'expense', parent: 'exp_health', name: 'כושר וספורט', nameEn: 'Gym & Fitness', displayOrder: 55, color: '#80CBC4', icon: 'FitnessCenter' },

  // Leisure & Entertainment (Pink-Red tones)
  { key: 'exp_leisure', type: 'expense', parent: 'expense_root', name: 'פנאי', nameEn: 'Leisure & Entertainment', displayOrder: 60, color: '#F38181', icon: 'Theaters' },
  { key: 'exp_leisure_entertainment', type: 'expense', parent: 'exp_leisure', name: 'בילויים', nameEn: 'Outings', displayOrder: 61, color: '#E57373', icon: 'Celebration' },
  { key: 'exp_leisure_streaming', type: 'expense', parent: 'exp_leisure', name: 'סטרימינג', nameEn: 'Streaming Services', displayOrder: 62, color: '#EF5350', icon: 'Tv' },
  { key: 'exp_leisure_cinema', type: 'expense', parent: 'exp_leisure', name: 'קולנוע', nameEn: 'Cinema', displayOrder: 63, color: '#F44336', icon: 'Movie' },
  { key: 'exp_leisure_travel', type: 'expense', parent: 'exp_leisure', name: 'חופשות', nameEn: 'Travel & Holidays', displayOrder: 64, color: '#E91E63', icon: 'Flight' },
  { key: 'exp_leisure_sports', type: 'expense', parent: 'exp_leisure', name: 'ספורט ותחביבים', nameEn: 'Sports & Hobbies', displayOrder: 65, color: '#C2185B', icon: 'SportsBaseball' },
  { key: 'exp_leisure_music', type: 'expense', parent: 'exp_leisure', name: 'מוזיקה וקונצרטים', nameEn: 'Music & Concerts', displayOrder: 66, color: '#880E4F', icon: 'MusicNote' },
  { key: 'exp_leisure_gaming', type: 'expense', parent: 'exp_leisure', name: 'משחקים', nameEn: 'Gaming', displayOrder: 67, color: '#AD1457', icon: 'SportsEsports' },

  // Shopping (Lavender-Purple tones)
  { key: 'exp_shopping', type: 'expense', parent: 'expense_root', name: 'קניות', nameEn: 'Shopping', displayOrder: 70, color: '#AA96DA', icon: 'ShoppingBag' },
  { key: 'exp_shopping_clothing', type: 'expense', parent: 'exp_shopping', name: 'ביגוד', nameEn: 'Clothing', displayOrder: 71, color: '#9575CD', icon: 'Checkroom' },
  { key: 'exp_shopping_shoes', type: 'expense', parent: 'exp_shopping', name: 'נעליים', nameEn: 'Footwear', displayOrder: 72, color: '#7E57C2', icon: 'Footprint' },
  { key: 'exp_shopping_housewares', type: 'expense', parent: 'exp_shopping', name: 'כלי בית', nameEn: 'Housewares', displayOrder: 73, color: '#673AB7', icon: 'Kitchen' },
  { key: 'exp_shopping_furniture', type: 'expense', parent: 'exp_shopping', name: 'רהיטים', nameEn: 'Furniture', displayOrder: 74, color: '#5E35B1', icon: 'Chair' },
  { key: 'exp_shopping_electronics', type: 'expense', parent: 'exp_shopping', name: 'אלקטרוניקה', nameEn: 'Electronics', displayOrder: 75, color: '#512DA8', icon: 'Devices' },
  { key: 'exp_shopping_gifts', type: 'expense', parent: 'exp_shopping', name: 'מתנות', nameEn: 'Gifts', displayOrder: 76, color: '#4527A0', icon: 'CardGiftcard' },
  { key: 'exp_shopping_cosmetics', type: 'expense', parent: 'exp_shopping', name: 'קוסמטיקה וטיפוח', nameEn: 'Cosmetics & Personal Care', displayOrder: 77, color: '#EC407A', icon: 'Face' },
  { key: 'exp_shopping_books', type: 'expense', parent: 'exp_shopping', name: 'ספרים וכתיבה', nameEn: 'Books & Stationery', displayOrder: 78, color: '#F48FB1', icon: 'MenuBook' },
  { key: 'exp_shopping_pets', type: 'expense', parent: 'exp_shopping', name: 'חיות מחמד', nameEn: 'Pet Supplies', displayOrder: 79, color: '#F06292', icon: 'Pets' },
  { key: 'exp_shopping_office', type: 'expense', parent: 'exp_shopping', name: 'ציוד משרדי', nameEn: 'Office Supplies', displayOrder: 80, color: '#E91E63', icon: 'WorkOutline' },
  { key: 'exp_shopping_jewelry', type: 'expense', parent: 'exp_shopping', name: 'תכשיטים ואקססוריז', nameEn: 'Jewelry & Accessories', displayOrder: 81, color: '#C2185B', icon: 'Diamond' },
  { key: 'exp_shopping_sports_equipment', type: 'expense', parent: 'exp_shopping', name: 'ציוד ספורט', nameEn: 'Sports Equipment', displayOrder: 82, color: '#AD1457', icon: 'SportsTennis' },
  { key: 'exp_shopping_religious', type: 'expense', parent: 'exp_shopping', name: 'תשמישי קדושה', nameEn: 'Religious Items & Judaica', displayOrder: 83, color: '#880E4F', icon: 'Synagogue' },

  // Education (Light Pink tones)
  { key: 'exp_education', type: 'expense', parent: 'expense_root', name: 'חינוך', nameEn: 'Education', displayOrder: 80, color: '#FCBAD3', icon: 'School' },
  { key: 'exp_education_higher', type: 'expense', parent: 'exp_education', name: 'לימודים גבוהים', nameEn: 'Higher Education', displayOrder: 81, color: '#F48FB1', icon: 'AccountBalance' },
  { key: 'exp_education_online', type: 'expense', parent: 'exp_education', name: 'קורסים מקוונים', nameEn: 'Online Courses', displayOrder: 82, color: '#F06292', icon: 'Computer' },
  { key: 'exp_education_schools', type: 'expense', parent: 'exp_education', name: 'גני ילדים ובתי ספר', nameEn: 'Kindergarten & Schools', displayOrder: 83, color: '#EC407A', icon: 'ChildCare' },
  { key: 'exp_education_tutoring', type: 'expense', parent: 'exp_education', name: 'חוגים ושיעורים פרטיים', nameEn: 'Classes & Tutoring', displayOrder: 84, color: '#E91E63', icon: 'Person' },
  { key: 'exp_education_books', type: 'expense', parent: 'exp_education', name: 'ספרי לימוד', nameEn: 'Educational Books', displayOrder: 85, color: '#C2185B', icon: 'AutoStories' },

  // Miscellaneous (Gray-Blue tones)
  { key: 'exp_misc', type: 'expense', parent: 'expense_root', name: 'שונות', nameEn: 'Miscellaneous', displayOrder: 90, color: '#A8DADC', icon: 'MoreHoriz' },
  { key: 'exp_misc_other', type: 'expense', parent: 'exp_misc', name: 'הוצאות אחרות', nameEn: 'Other Expenses', displayOrder: 91, color: '#90A4AE', icon: 'MoreVert' },
  { key: 'exp_misc_donations', type: 'expense', parent: 'exp_misc', name: 'תרומות', nameEn: 'Charitable Donations', displayOrder: 92, color: '#78909C', icon: 'VolunteerActivism' },

  // Income (Green tones as requested)
  { key: 'income_root', type: 'income', name: 'הכנסות', nameEn: 'Income', displayOrder: 100, color: '#4CAF50', icon: 'AccountBalance' },
  { key: 'income_salary', type: 'income', parent: 'income_root', name: 'משכורת', nameEn: 'Salary', displayOrder: 101, color: '#66BB6A', icon: 'Work' },
  { key: 'income_freelance', type: 'income', parent: 'income_root', name: 'פרילנס', nameEn: 'Freelance & Side Hustle', displayOrder: 102, color: '#81C784', icon: 'Laptop' },
  { key: 'income_refunds', type: 'income', parent: 'income_root', name: 'החזרים וזיכויים', nameEn: 'Refunds & Credits', displayOrder: 103, color: '#A5D6A7', icon: 'Replay' },
  { key: 'income_gifts', type: 'income', parent: 'income_root', name: 'מתנות', nameEn: 'Gifts & Windfalls', displayOrder: 104, color: '#C8E6C9', icon: 'CardGiftcard' },
  { key: 'income_gov_benefits', type: 'income', parent: 'income_root', name: 'קצבאות ממשלתיות', nameEn: 'Government Benefits', displayOrder: 105, color: '#00C853', icon: 'AccountBalance' },

  // Investment (Blue/Purple tones as requested)
  { key: 'investment_root', type: 'investment', name: 'השקעות', nameEn: 'Investments', displayOrder: 200, color: '#5E35B1', icon: 'TrendingUp' },
  { key: 'investment_stocks', type: 'investment', parent: 'investment_root', name: 'מניות', nameEn: 'Stocks & ETFs', displayOrder: 201, color: '#7E57C2', icon: 'ShowChart' },
  { key: 'investment_crypto', type: 'investment', parent: 'investment_root', name: 'קריפטו', nameEn: 'Crypto Assets', displayOrder: 202, color: '#9575CD', icon: 'CurrencyBitcoin' },
  { key: 'investment_retirement', type: 'investment', parent: 'investment_root', name: 'פנסיה וחיסכון', nameEn: 'Retirement & Savings', displayOrder: 203, color: '#1976D2', icon: 'Savings' },
  { key: 'investment_study_fund', type: 'investment', parent: 'investment_root', name: 'קופות גמל', nameEn: 'Study & Provident Funds', displayOrder: 204, color: '#42A5F5', icon: 'School' },
  { key: 'investment_real_estate', type: 'investment', parent: 'investment_root', name: 'נדל"ן', nameEn: 'Real Estate', displayOrder: 205, color: '#64B5F6', icon: 'Home' },
  { key: 'investment_deposits', type: 'investment', parent: 'investment_root', name: 'פיקדונות', nameEn: 'Bank Deposits', displayOrder: 206, color: '#90CAF9', icon: 'AccountBalance' }
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
    { pattern: 'פיקדון', target: 'Income', categoryName: 'הכנסות', priority: 70 },
    { pattern: 'רווח', target: 'Income', categoryName: 'הכנסות', priority: 70 },
    { pattern: 'דיבידנד', target: 'Income', categoryName: 'הכנסות', priority: 70 },
    { pattern: 'ריבית', target: 'Income', categoryName: 'הכנסות', priority: 70 }
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
  })();
}

function seedFinancialInstitutions(db) {
  const insert = db.prepare(`
    INSERT INTO financial_institutions
      (vendor_code, institution_type, display_name_he, display_name_en, category, subcategory,
       is_scrapable, logo_url, scraper_company_id, credential_fields, is_active, display_order, notes)
    VALUES
      (@code, @type, @nameHe, @nameEn, @category, @subcategory,
       @scrapable, NULL, @scraperCompanyId, @credentialFields, 1, @displayOrder, @notes)
  `);

  let insertedCount = 0;
  db.transaction(() => {
    for (const institution of FINANCIAL_INSTITUTIONS) {
      insert.run({
        code: institution.code,
        type: institution.type,
        nameHe: institution.nameHe,
        nameEn: institution.nameEn,
        category: institution.category,
        subcategory: institution.subcategory || null,
        scrapable: institution.scrapable,
        scraperCompanyId: institution.scraperCompanyId || null,
        credentialFields: institution.credentialFields || null,
        displayOrder: institution.displayOrder,
        notes: institution.notes || null
      });
      insertedCount++;
    }
  })();

  return insertedCount;
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
  let transactionStarted = false;

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec('BEGIN');
    transactionStarted = true;
    
    for (const statement of TABLE_DEFINITIONS) {
      db.exec(statement);
    }
    for (const statement of INDEX_STATEMENTS) {
      db.exec(statement);
    }

    const institutionCount = seedFinancialInstitutions(db);
    const helpers = seedCategories(db);
    seedCategoryActionability(db, helpers);
    seedCategoryMapping(db, helpers);
    seedCategorizationRules(db, helpers);

    db.exec('COMMIT');
    transactionStarted = false;

    const expenseLeafCount = Array.from(helpers.categoriesByKey.entries())
      .filter(([key]) => helpers.leafTracker.get(key) && helpers.categoriesByKey.get(key).type === 'expense')
      .length;

    // Count income rules
    const incomeRulesCount = db.prepare('SELECT COUNT(*) as count FROM categorization_rules WHERE category_type = ?').get('income').count;

    console.log('✅ Schema created with foreign keys and indexes');
    console.log(`✅ Seeded ${institutionCount} financial institutions`);
    console.log(`✅ Seeded ${helpers.categoriesByKey.size} category definitions`);
    console.log(`✅ Seeded ${expenseLeafCount} default actionability entries`);
    console.log(`✅ Seeded ${CATEGORY_MAPPINGS.length} category mappings`);
    console.log(`✅ Seeded ${incomeRulesCount} income categorization rules`);
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
