'use strict';

// Current schema for household employment and payroll contribution plans
// (pension, severance, keren hishtalmut), used by the payroll service's
// ensureSchema. Keep in sync with migration v13 in
// app/lib/schema-migrations.js and with scripts/init_sqlite_db.js; the
// migration runner test compares all three.

const PAYROLL_TABLE_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS household_employment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member TEXT NOT NULL UNIQUE CHECK (member IN ('self', 'spouse')),
      employer_name TEXT,
      gross_monthly REAL CHECK (gross_monthly IS NULL OR gross_monthly >= 0),
      salary_match_pattern TEXT,
      salary_match_vendor TEXT,
      salary_match_account_number TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  `CREATE TABLE IF NOT EXISTS payroll_contribution_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employment_id INTEGER NOT NULL REFERENCES household_employment(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('pension', 'severance', 'keren_hishtalmut')),
      account_id INTEGER REFERENCES investment_accounts(id) ON DELETE SET NULL,
      employee_pct REAL NOT NULL DEFAULT 0 CHECK (employee_pct >= 0 AND employee_pct <= 100),
      employer_pct REAL NOT NULL DEFAULT 0 CHECK (employer_pct >= 0 AND employer_pct <= 100),
      salary_cap REAL CHECK (salary_cap IS NULL OR salary_cap > 0),
      start_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (employment_id, kind)
    )`,
]);

const PAYROLL_INDEX_STATEMENTS = Object.freeze([
  'CREATE INDEX IF NOT EXISTS idx_payroll_contribution_plans_account ON payroll_contribution_plans (account_id)',
]);

const PAYROLL_TABLES = Object.freeze([
  'household_employment',
  'payroll_contribution_plans',
]);

module.exports = {
  PAYROLL_INDEX_STATEMENTS,
  PAYROLL_TABLES,
  PAYROLL_TABLE_STATEMENTS,
};
