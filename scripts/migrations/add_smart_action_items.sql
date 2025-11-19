-- Migration: Add Smart Action Items System
-- Purpose: Auto-generated action items based on anomaly detection, budget tracking,
--          and spending pattern analysis
-- Date: 2025-01-18

-- Table: smart_action_items
-- Auto-generated action items with context and metadata
CREATE TABLE IF NOT EXISTS smart_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL CHECK(action_type IN (
    'anomaly',           -- Spending anomaly detected (>20% from average)
    'budget_overrun',    -- Budget exceeded or projected to exceed
    'optimization',      -- Optimization opportunity (recurring charge, etc.)
    'fixed_variation',   -- Fixed cost category showing variation
    'unusual_purchase',  -- Large one-time purchase detected
    'seasonal_alert'     -- Seasonal spending pattern detected
  )),
  trigger_category_id INTEGER,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  dismissed_at TEXT,
  snoozed_until TEXT,
  user_status TEXT NOT NULL DEFAULT 'active' CHECK(user_status IN ('active', 'dismissed', 'resolved', 'snoozed')),
  metadata TEXT, -- JSON string with detection details (thresholds, values, comparisons)
  potential_impact REAL, -- Potential savings (positive) or cost increase (negative)
  detection_confidence REAL DEFAULT 0.5 CHECK(detection_confidence >= 0 AND detection_confidence <= 1),
  is_recurring INTEGER NOT NULL DEFAULT 0 CHECK(is_recurring IN (0, 1)),
  recurrence_key TEXT, -- Unique key for recurring action items (prevents duplicates)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (trigger_category_id) REFERENCES category_definitions(id) ON DELETE SET NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_smart_action_items_type
  ON smart_action_items(action_type);

CREATE INDEX IF NOT EXISTS idx_smart_action_items_status
  ON smart_action_items(user_status);

CREATE INDEX IF NOT EXISTS idx_smart_action_items_severity
  ON smart_action_items(severity);

CREATE INDEX IF NOT EXISTS idx_smart_action_items_category
  ON smart_action_items(trigger_category_id);

CREATE INDEX IF NOT EXISTS idx_smart_action_items_detected_at
  ON smart_action_items(detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_smart_action_items_recurrence
  ON smart_action_items(recurrence_key, user_status);

-- Table: action_item_history
-- Tracks resolution history and user interactions
CREATE TABLE IF NOT EXISTS action_item_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  smart_action_item_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created', 'dismissed', 'resolved', 'snoozed', 'reactivated', 'updated')),
  previous_status TEXT,
  new_status TEXT,
  user_note TEXT,
  metadata TEXT, -- JSON string with action-specific data
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (smart_action_item_id) REFERENCES smart_action_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_action_item_history_item_id
  ON action_item_history(smart_action_item_id, created_at DESC);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_smart_action_items_timestamp
AFTER UPDATE ON smart_action_items
BEGIN
  UPDATE smart_action_items
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;

-- Trigger to log action item status changes
CREATE TRIGGER IF NOT EXISTS log_smart_action_item_status_change
AFTER UPDATE OF user_status ON smart_action_items
WHEN OLD.user_status != NEW.user_status
BEGIN
  INSERT INTO action_item_history (smart_action_item_id, action, previous_status, new_status)
  VALUES (
    NEW.id,
    CASE NEW.user_status
      WHEN 'dismissed' THEN 'dismissed'
      WHEN 'resolved' THEN 'resolved'
      WHEN 'snoozed' THEN 'snoozed'
      WHEN 'active' THEN 'reactivated'
      ELSE 'updated'
    END,
    OLD.user_status,
    NEW.user_status
  );
END;

-- Modify existing user_action_items table to mark as deprecated
-- Add column to track deprecation (for gradual migration)
ALTER TABLE user_action_items ADD COLUMN is_deprecated INTEGER NOT NULL DEFAULT 0 CHECK(is_deprecated IN (0, 1));
ALTER TABLE user_action_items ADD COLUMN migrated_to_smart_action_id INTEGER REFERENCES smart_action_items(id) ON DELETE SET NULL;

-- Migration complete
