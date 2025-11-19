-- Migration: Add Spending Category Classification System
-- Purpose: Introduce spending category mappings (Growth, Stability, Essential, Reward, Other)
--          with auto-detection capabilities and variability tracking
-- Date: 2025-01-18

-- Table: spending_category_mappings
-- Maps category_definitions to spending categories with variability classification
CREATE TABLE IF NOT EXISTS spending_category_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_definition_id INTEGER NOT NULL UNIQUE,
  spending_category TEXT NOT NULL CHECK(spending_category IN ('growth', 'stability', 'essential', 'reward', 'other')),
  variability_type TEXT NOT NULL DEFAULT 'variable' CHECK(variability_type IN ('fixed', 'variable', 'seasonal')),
  is_auto_detected INTEGER NOT NULL DEFAULT 1 CHECK(is_auto_detected IN (0, 1)),
  target_percentage REAL CHECK(target_percentage >= 0 AND target_percentage <= 100),
  detection_confidence REAL DEFAULT 0.0 CHECK(detection_confidence >= 0 AND detection_confidence <= 1),
  user_overridden INTEGER NOT NULL DEFAULT 0 CHECK(user_overridden IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_spending_category_mappings_category_id
  ON spending_category_mappings(category_definition_id);

CREATE INDEX IF NOT EXISTS idx_spending_category_mappings_spending_cat
  ON spending_category_mappings(spending_category);

CREATE INDEX IF NOT EXISTS idx_spending_category_mappings_variability
  ON spending_category_mappings(variability_type);

-- Table: spending_category_targets
-- Stores user-defined target allocations for spending categories
CREATE TABLE IF NOT EXISTS spending_category_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spending_category TEXT NOT NULL UNIQUE CHECK(spending_category IN ('growth', 'stability', 'essential', 'reward', 'other')),
  target_percentage REAL NOT NULL CHECK(target_percentage >= 0 AND target_percentage <= 100),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default spending category targets (flexible allocation)
INSERT OR IGNORE INTO spending_category_targets (spending_category, target_percentage, is_active)
VALUES
  ('essential', 50.0, 1),  -- 50% for essentials (rent, utilities, groceries)
  ('growth', 20.0, 1),      -- 20% for growth (investments, savings, education)
  ('stability', 10.0, 1),   -- 10% for stability (emergency fund, insurance)
  ('reward', 15.0, 1),      -- 15% for rewards (entertainment, dining, travel)
  ('other', 5.0, 1);        -- 5% for other/uncategorized

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_spending_category_mappings_timestamp
AFTER UPDATE ON spending_category_mappings
BEGIN
  UPDATE spending_category_mappings
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_spending_category_targets_timestamp
AFTER UPDATE ON spending_category_targets
BEGIN
  UPDATE spending_category_targets
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;

-- Migration complete
