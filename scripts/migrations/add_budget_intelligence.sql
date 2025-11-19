-- Migration: Add Budget Intelligence System
-- Purpose: Automated budget suggestions based on historical spending patterns
--          with confidence scoring and trajectory forecasting
-- Date: 2025-01-18

-- Table: budget_suggestions
-- Auto-generated budget recommendations based on historical analysis
CREATE TABLE IF NOT EXISTS budget_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_definition_id INTEGER NOT NULL,
  period_type TEXT NOT NULL CHECK(period_type IN ('weekly', 'monthly', 'yearly')),
  suggested_limit REAL NOT NULL CHECK(suggested_limit > 0),
  confidence_score REAL DEFAULT 0.5 CHECK(confidence_score >= 0 AND confidence_score <= 1),
  variability_coefficient REAL, -- Coefficient of variation (std_dev / mean)
  based_on_months INTEGER NOT NULL DEFAULT 3 CHECK(based_on_months > 0),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
  activated_at TEXT,
  deactivated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  historical_data TEXT, -- JSON: monthly breakdown used for calculation
  calculation_metadata TEXT, -- JSON: algorithm details (mean, std_dev, min, max, median)
  FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE,
  UNIQUE(category_definition_id, period_type)
);

-- Indexes for budget suggestions
CREATE INDEX IF NOT EXISTS idx_budget_suggestions_category
  ON budget_suggestions(category_definition_id);

CREATE INDEX IF NOT EXISTS idx_budget_suggestions_active
  ON budget_suggestions(is_active, category_definition_id);

CREATE INDEX IF NOT EXISTS idx_budget_suggestions_confidence
  ON budget_suggestions(confidence_score DESC);

-- Table: budget_trajectory
-- Tracks budget performance and forecasting over time
CREATE TABLE IF NOT EXISTS budget_trajectory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  budget_limit REAL NOT NULL,
  spent_amount REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL,
  days_remaining INTEGER NOT NULL,
  days_total INTEGER NOT NULL,
  daily_limit REAL NOT NULL, -- Suggested daily spend to stay within budget
  projected_total REAL, -- Forecasted total spend based on current trajectory
  is_on_track INTEGER NOT NULL DEFAULT 1 CHECK(is_on_track IN (0, 1)),
  overrun_risk TEXT CHECK(overrun_risk IN ('none', 'low', 'medium', 'high', 'critical')),
  snapshot_date TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT, -- JSON: trajectory calculation details
  FOREIGN KEY (budget_id) REFERENCES category_budgets(id) ON DELETE CASCADE
);

-- Indexes for trajectory tracking
CREATE INDEX IF NOT EXISTS idx_budget_trajectory_budget_id
  ON budget_trajectory(budget_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_budget_trajectory_risk
  ON budget_trajectory(overrun_risk, snapshot_date DESC);

-- Table: budget_alerts
-- Generated alerts when budgets are at risk
CREATE TABLE IF NOT EXISTS budget_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL CHECK(alert_type IN (
    'approaching_limit',  -- 80% of budget used
    'exceeded',           -- Budget exceeded
    'projected_overrun',  -- Projected to exceed based on trajectory
    'unusual_spike'       -- Unusual spending spike in category
  )),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
  message TEXT NOT NULL,
  threshold_percentage REAL, -- Percentage of budget that triggered alert
  current_amount REAL NOT NULL,
  budget_limit REAL NOT NULL,
  triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  resolved_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  metadata TEXT, -- JSON: alert details
  FOREIGN KEY (budget_id) REFERENCES category_budgets(id) ON DELETE CASCADE
);

-- Indexes for budget alerts
CREATE INDEX IF NOT EXISTS idx_budget_alerts_budget_id
  ON budget_alerts(budget_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_budget_alerts_active
  ON budget_alerts(is_active, severity);

-- Modify existing category_budgets table
-- Add columns to integrate with suggestion system
ALTER TABLE category_budgets ADD COLUMN is_auto_suggested INTEGER NOT NULL DEFAULT 0 CHECK(is_auto_suggested IN (0, 1));
ALTER TABLE category_budgets ADD COLUMN suggestion_id INTEGER REFERENCES budget_suggestions(id) ON DELETE SET NULL;
ALTER TABLE category_budgets ADD COLUMN auto_adjust INTEGER NOT NULL DEFAULT 0 CHECK(auto_adjust IN (0, 1));
ALTER TABLE category_budgets ADD COLUMN alert_threshold REAL DEFAULT 0.8 CHECK(alert_threshold > 0 AND alert_threshold <= 1);

-- Triggers for timestamp updates
CREATE TRIGGER IF NOT EXISTS update_budget_suggestions_timestamp
AFTER UPDATE ON budget_suggestions
BEGIN
  UPDATE budget_suggestions
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;

-- Trigger to set activation timestamp
CREATE TRIGGER IF NOT EXISTS set_budget_suggestion_activation
AFTER UPDATE OF is_active ON budget_suggestions
WHEN NEW.is_active = 1 AND OLD.is_active = 0
BEGIN
  UPDATE budget_suggestions
  SET activated_at = datetime('now')
  WHERE id = NEW.id;
END;

-- Trigger to set deactivation timestamp
CREATE TRIGGER IF NOT EXISTS set_budget_suggestion_deactivation
AFTER UPDATE OF is_active ON budget_suggestions
WHEN NEW.is_active = 0 AND OLD.is_active = 1
BEGIN
  UPDATE budget_suggestions
  SET deactivated_at = datetime('now')
  WHERE id = NEW.id;
END;

-- Migration complete
