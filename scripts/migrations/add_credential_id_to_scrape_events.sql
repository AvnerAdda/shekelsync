-- Migration: Add credential_id to scrape_events table
-- This allows tracking which specific credential was scraped, not just the vendor
-- Fixes issue where multiple credentials for the same vendor share scrape status

-- Add the credential_id column (nullable for backward compatibility)
ALTER TABLE scrape_events
ADD COLUMN credential_id INTEGER;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_scrape_events_credential_id
ON scrape_events (credential_id);

-- Create composite index for credential_id + created_at
CREATE INDEX IF NOT EXISTS idx_scrape_events_cred_date
ON scrape_events (credential_id, created_at DESC);

-- Add foreign key constraint (optional, for data integrity)
-- Note: This is commented out because it may fail on existing rows with NULL credential_id
-- Uncomment after backfilling credential_id for existing rows if needed
-- CREATE INDEX IF NOT EXISTS idx_scrape_events_credential_fk
-- ON scrape_events (credential_id);

-- Migration complete
-- Next steps:
-- 1. Run this migration: sqlite3 dist/clarify.sqlite < scripts/migrations/add_credential_id_to_scrape_events.sql
-- 2. Update scraping service to populate credential_id
-- 3. Update last-update service to use credential_id for accurate status
