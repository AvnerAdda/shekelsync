-- Migration: Add credit_card_expense_matches table
-- This table stores manual matches between bank repayments and credit card expenses

CREATE TABLE IF NOT EXISTS credit_card_expense_matches (
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
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_cc_matches_repayment ON credit_card_expense_matches(repayment_txn_id, repayment_vendor);
CREATE INDEX IF NOT EXISTS idx_cc_matches_expense ON credit_card_expense_matches(expense_txn_id, expense_vendor);
CREATE INDEX IF NOT EXISTS idx_cc_matches_dates ON credit_card_expense_matches(repayment_date, expense_date);
CREATE INDEX IF NOT EXISTS idx_cc_matches_method ON credit_card_expense_matches(match_method);
