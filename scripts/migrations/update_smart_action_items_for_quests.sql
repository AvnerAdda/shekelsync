-- Migration: Update smart_action_items table to support quest action types
-- SQLite doesn't support ALTER CHECK, so we recreate the table

-- Step 1: Rename the old table
ALTER TABLE smart_action_items RENAME TO smart_action_items_old;

-- Step 2: Create new table with updated CHECK constraint (quest types only)
CREATE TABLE IF NOT EXISTS smart_action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL CHECK(action_type IN (
      'quest_reduce_spending', 'quest_savings_target', 'quest_budget_adherence', 
      'quest_set_budget', 'quest_reduce_fixed_cost', 'quest_income_goal'
    )),
    trigger_category_id INTEGER,
    severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high')),
    title TEXT NOT NULL,
    description TEXT,
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    dismissed_at TEXT,
    user_status TEXT NOT NULL DEFAULT 'active' CHECK(user_status IN ('active', 'dismissed', 'resolved', 'accepted', 'failed')),
    metadata TEXT,
    potential_impact REAL,
    detection_confidence REAL DEFAULT 0.5 CHECK(detection_confidence >= 0 AND detection_confidence <= 1),
    is_recurring INTEGER NOT NULL DEFAULT 0 CHECK(is_recurring IN (0, 1)),
    recurrence_key TEXT,
    -- Quest-specific columns
    deadline TEXT,
    accepted_at TEXT,
    points_reward INTEGER DEFAULT 0,
    points_earned INTEGER DEFAULT 0,
    completion_criteria TEXT,
    completion_result TEXT,
    quest_difficulty TEXT CHECK(quest_difficulty IS NULL OR quest_difficulty IN ('easy', 'medium', 'hard')),
    quest_duration_days INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (trigger_category_id) REFERENCES category_definitions(id) ON DELETE SET NULL
);

-- Step 3: Copy quest data from old table (if any quests exist)
INSERT INTO smart_action_items (
    id, action_type, trigger_category_id, severity, title, description,
    detected_at, resolved_at, dismissed_at, user_status, metadata,
    potential_impact, detection_confidence, is_recurring, recurrence_key,
    deadline, accepted_at, points_reward, points_earned, completion_criteria,
    completion_result, quest_difficulty, quest_duration_days, created_at, updated_at
)
SELECT 
    id, action_type, trigger_category_id, severity, title, description,
    detected_at, resolved_at, dismissed_at, user_status, metadata,
    potential_impact, detection_confidence, is_recurring, recurrence_key,
    deadline, accepted_at, points_reward, points_earned, completion_criteria,
    completion_result, quest_difficulty, quest_duration_days, created_at, updated_at
FROM smart_action_items_old
WHERE action_type LIKE 'quest_%';

-- Step 4: Drop old table
DROP TABLE smart_action_items_old;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_smart_action_items_type ON smart_action_items(action_type);
CREATE INDEX IF NOT EXISTS idx_smart_action_items_status ON smart_action_items(user_status);
CREATE INDEX IF NOT EXISTS idx_smart_action_items_severity ON smart_action_items(severity);
CREATE INDEX IF NOT EXISTS idx_smart_action_items_category ON smart_action_items(trigger_category_id);
CREATE INDEX IF NOT EXISTS idx_smart_action_items_detected_at ON smart_action_items(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_smart_action_items_recurrence ON smart_action_items(recurrence_key, user_status);
CREATE INDEX IF NOT EXISTS idx_smart_action_items_deadline ON smart_action_items(deadline);
CREATE INDEX IF NOT EXISTS idx_smart_action_items_accepted_at ON smart_action_items(accepted_at);
CREATE INDEX IF NOT EXISTS idx_smart_action_items_quest_difficulty ON smart_action_items(quest_difficulty);

-- Step 6: Ensure user_quest_stats table exists
CREATE TABLE IF NOT EXISTS user_quest_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_points INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    quests_completed INTEGER NOT NULL DEFAULT 0,
    quests_failed INTEGER NOT NULL DEFAULT 0,
    quests_declined INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    last_completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 7: Initialize user stats if not exists
INSERT OR IGNORE INTO user_quest_stats (id, total_points, current_streak, best_streak, quests_completed, quests_failed, quests_declined, level)
VALUES (1, 0, 0, 0, 0, 0, 0, 1);
