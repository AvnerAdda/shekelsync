-- Migration: Drop unused legacy analytics tables
-- Removes legacy action items, recurring analysis, budget intelligence, and category actionability tables
-- and rebuilds category_budgets without budget intelligence columns/foreign keys.

PRAGMA foreign_keys = OFF;

-- Rebuild category_budgets without suggestion/auto columns
CREATE TABLE IF NOT EXISTS category_budgets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_definition_id INTEGER NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('weekly','monthly','yearly')),
  budget_limit REAL NOT NULL CHECK (budget_limit > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category_definition_id, period_type),
  FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE
);

INSERT INTO category_budgets_new (
  id, category_definition_id, period_type, budget_limit, is_active, created_at, updated_at
)
SELECT
  id,
  category_definition_id,
  period_type,
  budget_limit,
  is_active,
  created_at,
  updated_at
FROM category_budgets;

DROP TABLE category_budgets;
ALTER TABLE category_budgets_new RENAME TO category_budgets;

CREATE INDEX IF NOT EXISTS idx_category_budgets_active ON category_budgets (is_active);
CREATE INDEX IF NOT EXISTS idx_category_budgets_category_id ON category_budgets (category_definition_id);

-- Drop unused tables
DROP TABLE IF EXISTS budget_suggestions;
DROP TABLE IF EXISTS budget_trajectory;
DROP TABLE IF EXISTS user_action_items;
DROP TABLE IF EXISTS action_item_progress;
DROP TABLE IF EXISTS recurring_transaction_analysis;
DROP TABLE IF EXISTS category_actionability_settings;
DROP TABLE IF EXISTS budget_alerts;

PRAGMA foreign_keys = ON;
