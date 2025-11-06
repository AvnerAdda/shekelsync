-- Migration: Add UNIQUE constraint to investment_holdings
-- Fixes: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint

BEGIN TRANSACTION;

-- Step 1: Create new table with UNIQUE constraint
CREATE TABLE investment_holdings_new (
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
);

-- Step 2: Copy all data from old table
INSERT INTO investment_holdings_new
SELECT * FROM investment_holdings;

-- Step 3: Drop old table
DROP TABLE investment_holdings;

-- Step 4: Rename new table to original name
ALTER TABLE investment_holdings_new RENAME TO investment_holdings;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_investment_holdings_account ON investment_holdings (account_id);
CREATE INDEX IF NOT EXISTS idx_investment_holdings_date ON investment_holdings (as_of_date DESC);

COMMIT;
