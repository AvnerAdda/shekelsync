-- Migration: Add Optimizator structured profile and recommendations
-- Date: 2026-07-09
-- Rollout: startup migrations cover existing desktop installs; init_sqlite_db.js
-- covers fresh databases. Keep this file for audit and manual recovery.

CREATE TABLE IF NOT EXISTS optimizer_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_key TEXT NOT NULL UNIQUE,
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  value_json TEXT,
  value_text TEXT,
  status TEXT NOT NULL DEFAULT 'detected' CHECK(status IN ('detected', 'confirmed', 'edited', 'unknown', 'skipped')),
  source TEXT NOT NULL DEFAULT 'detected',
  confidence REAL DEFAULT 0.5 CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence_json TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS optimizer_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uuid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('complete', 'failed')),
  prompt_version TEXT NOT NULL,
  openai_model TEXT,
  input_snapshot_json TEXT,
  result_json TEXT,
  error_message TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS optimizer_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  smart_action_item_id INTEGER,
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  rationale TEXT,
  evidence_json TEXT,
  estimated_monthly_impact REAL DEFAULT 0,
  hassle_level TEXT NOT NULL DEFAULT 'medium' CHECK(hassle_level IN ('low', 'medium', 'high')),
  confidence REAL DEFAULT 0.5 CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  next_action TEXT,
  caveat TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'done', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES optimizer_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_optimizer_facts_status ON optimizer_facts(status);
CREATE INDEX IF NOT EXISTS idx_optimizer_facts_section ON optimizer_facts(section);
CREATE INDEX IF NOT EXISTS idx_optimizer_runs_generated ON optimizer_runs(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimizer_recommendations_status ON optimizer_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_optimizer_recommendations_run ON optimizer_recommendations(run_id);
