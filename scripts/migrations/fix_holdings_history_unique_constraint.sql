-- Migration: Add UNIQUE constraint to investment_holdings_history
-- Fixes: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint

BEGIN TRANSACTION;

-- Step 1: Create new table with UNIQUE constraint
CREATE TABLE investment_holdings_history_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    total_value REAL NOT NULL,
    cost_basis REAL,
    snapshot_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, snapshot_date),
    FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
);

-- Step 2: Copy all data from old table
INSERT INTO investment_holdings_history_new
SELECT * FROM investment_holdings_history;

-- Step 3: Drop old table
DROP TABLE investment_holdings_history;

-- Step 4: Rename new table to original name
ALTER TABLE investment_holdings_history_new RENAME TO investment_holdings_history;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_holdings_history_account ON investment_holdings_history (account_id);
CREATE INDEX IF NOT EXISTS idx_holdings_history_date ON investment_holdings_history (snapshot_date DESC);

COMMIT;
