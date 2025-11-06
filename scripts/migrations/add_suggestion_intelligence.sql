-- Migration: Add intelligent suggestion fields to pending_transaction_suggestions
-- Date: 2025-11-06
-- Description: Adds columns for smart account detection, institution parsing, and dismissal tracking

-- Add new columns for account suggestion intelligence
ALTER TABLE pending_transaction_suggestions ADD COLUMN suggested_account_type TEXT;
ALTER TABLE pending_transaction_suggestions ADD COLUMN suggested_institution TEXT;
ALTER TABLE pending_transaction_suggestions ADD COLUMN suggested_account_name TEXT;
ALTER TABLE pending_transaction_suggestions ADD COLUMN dismiss_count INTEGER DEFAULT 0;
ALTER TABLE pending_transaction_suggestions ADD COLUMN last_dismissed_at TEXT;

-- Create new indices for performance
CREATE INDEX IF NOT EXISTS idx_pending_account_type ON pending_transaction_suggestions (suggested_account_type);
CREATE INDEX IF NOT EXISTS idx_pending_dismissed ON pending_transaction_suggestions (dismiss_count, last_dismissed_at);

-- Verify migration
SELECT
    COUNT(*) as total_suggestions,
    COUNT(CASE WHEN suggested_account_type IS NOT NULL THEN 1 END) as typed_suggestions,
    COUNT(CASE WHEN dismiss_count > 0 THEN 1 END) as dismissed_suggestions
FROM pending_transaction_suggestions;
