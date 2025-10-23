-- Add onboarding tracking fields to user_profile table
-- Run this migration on existing databases to support onboarding features

-- Check if columns exist before adding (SQLite doesn't have IF NOT EXISTS for ALTER TABLE)
-- If this fails, the columns may already exist - that's okay

-- Add onboarding_dismissed flag (0 = not dismissed, 1 = dismissed)
ALTER TABLE user_profile ADD COLUMN onboarding_dismissed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_dismissed IN (0,1));

-- Add timestamp when onboarding was dismissed
ALTER TABLE user_profile ADD COLUMN onboarding_dismissed_at TEXT;

-- Add last active timestamp for activity tracking
ALTER TABLE user_profile ADD COLUMN last_active_at TEXT;

-- Update existing profiles to set last_active_at
UPDATE user_profile
SET last_active_at = datetime('now')
WHERE last_active_at IS NULL;

-- Commit changes
-- (SQLite auto-commits unless in a transaction)
