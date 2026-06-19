-- Migration: Add real estate simulator profile storage
-- Description: Stores structured property metadata and valuation scenarios for real estate investment accounts.

BEGIN;

CREATE TABLE IF NOT EXISTS real_estate_properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  city TEXT,
  neighborhood TEXT,
  property_type TEXT NOT NULL DEFAULT 'apartment',
  rooms REAL,
  square_meters REAL,
  floor REAL,
  total_floors REAL,
  has_elevator INTEGER CHECK (has_elevator IN (0,1) OR has_elevator IS NULL),
  has_parking INTEGER CHECK (has_parking IN (0,1) OR has_parking IS NULL),
  has_balcony INTEGER CHECK (has_balcony IN (0,1) OR has_balcony IS NULL),
  has_storage INTEGER CHECK (has_storage IN (0,1) OR has_storage IS NULL),
  ownership_percentage REAL NOT NULL DEFAULT 100,
  purchase_price REAL,
  purchase_date TEXT,
  mortgage_balance REAL,
  monthly_mortgage_payment REAL,
  mortgage_interest_rate REAL,
  mortgage_term_years REAL,
  monthly_rent REAL,
  annual_expenses REAL,
  price_per_sqm REAL,
  annual_growth_rate REAL,
  rental_yield_rate REAL,
  manual_estimated_value REAL,
  valuation_method TEXT NOT NULL DEFAULT 'blended',
  estimated_value REAL,
  estimated_net_equity REAL,
  confidence TEXT,
  scenario_conservative REAL,
  scenario_base REAL,
  scenario_optimistic REAL,
  assumptions_json TEXT,
  last_valuation_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_real_estate_properties_account ON real_estate_properties(account_id);
CREATE INDEX IF NOT EXISTS idx_real_estate_properties_city ON real_estate_properties(city);

COMMIT;
