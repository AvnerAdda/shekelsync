'use strict';

// Current schema for mortgage tracks, cached market data and property
// settings/costs, used by the services' ensureSchema. Keep in sync with
// migrations v11 (mortgage + market data) and v12 (settings + costs) in
// app/lib/schema-migrations.js and with scripts/init_sqlite_db.js; the
// migration runner test compares all three.

const MORTGAGE_TABLE_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS mortgage_loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
      lender TEXT,
      label TEXT,
      approved_amount REAL CHECK (approved_amount IS NULL OR approved_amount >= 0),
      currency TEXT NOT NULL DEFAULT 'ILS',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
      payment_match_vendor TEXT,
      payment_match_account_number TEXT,
      payment_match_pattern TEXT,
      options_json TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  `CREATE TABLE IF NOT EXISTS mortgage_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL REFERENCES mortgage_loans(id) ON DELETE CASCADE,
      track_type TEXT NOT NULL CHECK (track_type IN ('prime', 'fixed_unlinked', 'fixed_cpi', 'variable_unlinked', 'variable_cpi', 'fx_linked', 'legacy')),
      label TEXT,
      rate REAL,
      margin REAL,
      rate_convention TEXT NOT NULL DEFAULT 'nominal' CHECK (rate_convention IN ('nominal', 'effective')),
      reset_period_months INTEGER CHECK (reset_period_months IS NULL OR reset_period_months BETWEEN 1 AND 360),
      anchor_series_key TEXT,
      amortization TEXT NOT NULL DEFAULT 'spitzer' CHECK (amortization IN ('spitzer', 'equal_principal', 'balloon', 'bullet')),
      term_months INTEGER NOT NULL CHECK (term_months BETWEEN 1 AND 600),
      payment_day INTEGER CHECK (payment_day IS NULL OR payment_day BETWEEN 1 AND 31),
      first_payment_date TEXT,
      grace_type TEXT NOT NULL DEFAULT 'none' CHECK (grace_type IN ('none', 'partial', 'full')),
      grace_end_date TEXT,
      cpi_floor_at_base INTEGER NOT NULL DEFAULT 0 CHECK (cpi_floor_at_base IN (0, 1)),
      anchor_date TEXT,
      anchor_balance REAL,
      anchor_remaining_months INTEGER,
      anchor_payment REAL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'refinanced')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  `CREATE TABLE IF NOT EXISTS mortgage_track_drawdowns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES mortgage_tracks(id) ON DELETE CASCADE,
      draw_date TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      status TEXT NOT NULL DEFAULT 'drawn' CHECK (status IN ('drawn', 'planned')),
      rate REAL,
      term_mode TEXT NOT NULL DEFAULT 'same_maturity' CHECK (term_mode IN ('same_maturity', 'full_term')),
      term_months INTEGER,
      notes TEXT
    )`,
  `CREATE TABLE IF NOT EXISTS mortgage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL REFERENCES mortgage_loans(id) ON DELETE CASCADE,
      track_id INTEGER REFERENCES mortgage_tracks(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('prepay_partial', 'prepay_full', 'refinance', 'rate_override')),
      event_date TEXT NOT NULL,
      amount REAL,
      mode TEXT CHECK (mode IS NULL OR mode IN ('reduce_payment', 'reduce_term')),
      fee_paid REAL,
      rate REAL,
      payload_json TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  `CREATE TABLE IF NOT EXISTS market_series (
      series_key TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('boi', 'cbs', 'manual')),
      frequency TEXT NOT NULL CHECK (frequency IN ('D', 'M', 'EVENT')),
      unit TEXT,
      description TEXT,
      last_synced_at TEXT,
      last_observation_period TEXT,
      last_error TEXT,
      meta_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  `CREATE TABLE IF NOT EXISTS market_series_points (
      series_key TEXT NOT NULL REFERENCES market_series(series_key) ON DELETE CASCADE,
      period TEXT NOT NULL,
      value REAL NOT NULL,
      raw_value REAL,
      base_label TEXT,
      PRIMARY KEY (series_key, period)
    )`,
  `CREATE TABLE IF NOT EXISTS real_estate_property_settings (
      account_id INTEGER PRIMARY KEY REFERENCES investment_accounts(id) ON DELETE CASCADE,
      usage_type TEXT NOT NULL DEFAULT 'owner_occupied' CHECK (usage_type IN ('owner_occupied', 'rented', 'vacant')),
      is_off_plan INTEGER NOT NULL DEFAULT 0 CHECK (is_off_plan IN (0, 1)),
      delivery_date TEXT,
      settings_json TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  `CREATE TABLE IF NOT EXISTS real_estate_property_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
      cost_type TEXT NOT NULL CHECK (cost_type IN ('down_payment', 'purchase_tax', 'lawyer', 'broker', 'appraisal', 'renovation', 'mortgage_fees', 'other')),
      label TEXT,
      amount REAL NOT NULL CHECK (amount >= 0),
      cost_date TEXT,
      status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'planned')),
      deductible INTEGER NOT NULL DEFAULT 1 CHECK (deductible IN (0, 1)),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
]);

const MORTGAGE_INDEX_STATEMENTS = Object.freeze([
  'CREATE INDEX IF NOT EXISTS idx_mortgage_loans_account ON mortgage_loans (account_id)',
  'CREATE INDEX IF NOT EXISTS idx_mortgage_tracks_loan ON mortgage_tracks (loan_id, sort_order)',
  'CREATE INDEX IF NOT EXISTS idx_mortgage_drawdowns_track ON mortgage_track_drawdowns (track_id, draw_date)',
  'CREATE INDEX IF NOT EXISTS idx_mortgage_events_loan ON mortgage_events (loan_id, event_date)',
  'CREATE INDEX IF NOT EXISTS idx_real_estate_property_costs_account ON real_estate_property_costs (account_id, cost_date)',
]);

const MORTGAGE_TABLES = Object.freeze([
  'mortgage_loans',
  'mortgage_tracks',
  'mortgage_track_drawdowns',
  'mortgage_events',
  'market_series',
  'market_series_points',
  'real_estate_property_settings',
  'real_estate_property_costs',
]);

module.exports = {
  MORTGAGE_INDEX_STATEMENTS,
  MORTGAGE_TABLES,
  MORTGAGE_TABLE_STATEMENTS,
};
