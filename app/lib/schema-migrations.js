const fs = require('fs');
const path = require('path');

/**
 * Versioned schema migrations, tracked with SQLite's PRAGMA user_version.
 *
 * Rules for adding a migration:
 * - Append a new entry to MIGRATIONS with the next integer version.
 * - Migrations must be idempotent. Fresh databases created by
 *   scripts/init_sqlite_db.js already contain the latest schema but start at
 *   user_version 0, so every migration re-runs against a schema where its
 *   change may already exist. Guard column adds with a PRAGMA table_info
 *   check and DDL with IF NOT EXISTS.
 * - Never edit or delete a shipped migration; released versions have already
 *   been stamped on user databases.
 *
 * Each pending migration runs inside its own IMMEDIATE transaction and the
 * version stamp is written in the same transaction, so a failure rolls back
 * both the schema change and the stamp. A file-level backup of the database
 * is taken before the first pending migration is applied.
 */
function tableExists(db, tableName) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(tableName));
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  if (!tableExists(db, tableName)) return;
  const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all();
  if (!columns.some((column) => column?.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function createLinkedPositionEventTransactionIndex(db) {
  if (!tableExists(db, 'investment_position_events')) return;

  // Retain every historical event. If legacy data already contains duplicate
  // transaction links, keep the earliest event as the canonical claim and
  // exclude only the later immutable event ids from this partial index.
  const duplicateRows = db.prepare(`
    SELECT duplicate_event.id
    FROM investment_position_events duplicate_event
    WHERE duplicate_event.linked_transaction_identifier IS NOT NULL
      AND duplicate_event.linked_transaction_vendor IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM investment_position_events canonical_event
        WHERE canonical_event.linked_transaction_identifier = duplicate_event.linked_transaction_identifier
          AND canonical_event.linked_transaction_vendor = duplicate_event.linked_transaction_vendor
          AND canonical_event.id < duplicate_event.id
      )
    ORDER BY duplicate_event.id
  `).all();
  const excludedIds = duplicateRows
    .map((row) => Number(row?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const legacyDuplicatePredicate = excludedIds.length > 0
    ? `AND id NOT IN (${excludedIds.join(', ')})`
    : '';

  db.exec(`
    DROP INDEX IF EXISTS idx_investment_position_events_linked_transaction_unique;
    CREATE UNIQUE INDEX idx_investment_position_events_linked_transaction_unique
    ON investment_position_events(
      linked_transaction_identifier,
      linked_transaction_vendor
    )
    WHERE linked_transaction_identifier IS NOT NULL
      AND linked_transaction_vendor IS NOT NULL
      ${legacyDuplicatePredicate};

    DROP TRIGGER IF EXISTS trg_position_event_link_unique_insert;
    CREATE TRIGGER trg_position_event_link_unique_insert
    BEFORE INSERT ON investment_position_events
    WHEN NEW.linked_transaction_identifier IS NOT NULL
      AND NEW.linked_transaction_vendor IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM investment_position_events existing_event
        WHERE existing_event.linked_transaction_identifier = NEW.linked_transaction_identifier
          AND existing_event.linked_transaction_vendor = NEW.linked_transaction_vendor
      )
    BEGIN
      SELECT RAISE(ABORT, 'position event transaction link already exists');
    END;

    DROP TRIGGER IF EXISTS trg_position_event_link_unique_update;
    CREATE TRIGGER trg_position_event_link_unique_update
    BEFORE UPDATE OF linked_transaction_identifier, linked_transaction_vendor
    ON investment_position_events
    WHEN NEW.linked_transaction_identifier IS NOT NULL
      AND NEW.linked_transaction_vendor IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM investment_position_events existing_event
        WHERE existing_event.linked_transaction_identifier = NEW.linked_transaction_identifier
          AND existing_event.linked_transaction_vendor = NEW.linked_transaction_vendor
          AND existing_event.id <> OLD.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'position event transaction link already exists');
    END;
  `);
}

function createLegacyAssetPositionMirrorTriggers(db) {
  if (
    !tableExists(db, 'investment_assets')
    || !tableExists(db, 'investment_positions')
    || !tableExists(db, 'investment_position_events')
  ) return;

  const upsertPositionSql = (assetReference) => `
    INSERT INTO investment_positions (
      account_id,
      position_name,
      asset_symbol,
      asset_type,
      currency,
      status,
      opened_at,
      closed_at,
      units,
      average_cost,
      current_price,
      valuation_date,
      source,
      legacy_asset_id,
      original_cost_basis,
      open_cost_basis,
      current_value,
      notes
    ) VALUES (
      ${assetReference}.account_id,
      ${assetReference}.asset_name,
      ${assetReference}.asset_symbol,
      ${assetReference}.asset_type,
      COALESCE(NULLIF(TRIM(${assetReference}.currency), ''), 'USD'),
      CASE WHEN COALESCE(${assetReference}.is_active, 1) = 1 THEN 'open' ELSE 'closed' END,
      COALESCE(substr(${assetReference}.created_at, 1, 10), date('now')),
      CASE WHEN COALESCE(${assetReference}.is_active, 1) = 1
        THEN NULL
        ELSE COALESCE(substr(${assetReference}.updated_at, 1, 10), date('now'))
      END,
      COALESCE(${assetReference}.units, 0),
      ${assetReference}.average_cost,
      COALESCE(${assetReference}.current_price,
        CASE WHEN ${assetReference}.asset_type = 'cash' THEN 1 ELSE NULL END),
      COALESCE(${assetReference}.valuation_date, substr(${assetReference}.updated_at, 1, 10)),
      'legacy_asset',
      ${assetReference}.id,
      COALESCE(
        ${assetReference}.cost_basis,
        CASE
          WHEN ${assetReference}.average_cost IS NOT NULL
            THEN COALESCE(${assetReference}.units, 0) * ${assetReference}.average_cost
          WHEN ${assetReference}.asset_type = 'cash' THEN COALESCE(${assetReference}.units, 0)
          ELSE 0
        END
      ),
      COALESCE(
        ${assetReference}.cost_basis,
        CASE
          WHEN ${assetReference}.average_cost IS NOT NULL
            THEN COALESCE(${assetReference}.units, 0) * ${assetReference}.average_cost
          WHEN ${assetReference}.asset_type = 'cash' THEN COALESCE(${assetReference}.units, 0)
          ELSE 0
        END
      ),
      COALESCE(
        ${assetReference}.current_value,
        CASE
          WHEN ${assetReference}.current_price IS NOT NULL
            THEN COALESCE(${assetReference}.units, 0) * ${assetReference}.current_price
          WHEN ${assetReference}.asset_type = 'cash' THEN COALESCE(${assetReference}.units, 0)
          ELSE NULL
        END
      ),
      ${assetReference}.notes
    )
    ON CONFLICT (legacy_asset_id) WHERE legacy_asset_id IS NOT NULL
    DO UPDATE SET
      account_id = excluded.account_id,
      position_name = excluded.position_name,
      asset_symbol = excluded.asset_symbol,
      asset_type = excluded.asset_type,
      currency = excluded.currency,
      status = excluded.status,
      closed_at = excluded.closed_at,
      units = excluded.units,
      average_cost = excluded.average_cost,
      current_price = excluded.current_price,
      valuation_date = excluded.valuation_date,
      source = excluded.source,
      original_cost_basis = excluded.original_cost_basis,
      open_cost_basis = excluded.open_cost_basis,
      current_value = excluded.current_value,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1
      FROM investment_position_events event
      WHERE event.position_id = investment_positions.id
    );
  `;

  db.exec('DROP TRIGGER IF EXISTS trg_investment_assets_position_insert');
  db.exec('DROP TRIGGER IF EXISTS trg_investment_assets_position_update');
  db.exec('DROP TRIGGER IF EXISTS trg_investment_assets_position_delete');
  db.exec(`
    CREATE TRIGGER trg_investment_assets_position_insert
    AFTER INSERT ON investment_assets
    BEGIN
      ${upsertPositionSql('NEW')}
    END;
  `);
  db.exec(`
    CREATE TRIGGER trg_investment_assets_position_update
    AFTER UPDATE ON investment_assets
    BEGIN
      ${upsertPositionSql('NEW')}
    END;
  `);
  db.exec(`
    CREATE TRIGGER trg_investment_assets_position_delete
    AFTER DELETE ON investment_assets
    BEGIN
      UPDATE investment_positions
      SET status = 'closed',
          closed_at = COALESCE(substr(OLD.updated_at, 1, 10), date('now')),
          updated_at = CURRENT_TIMESTAMP
      WHERE legacy_asset_id = OLD.id
        AND NOT EXISTS (
          SELECT 1
          FROM investment_position_events event
          WHERE event.position_id = investment_positions.id
        );
    END;
  `);
}

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline-v0.1.33',
    // Pure version stamp: no schema change, so no pre-migration backup is
    // needed. Schemas up to v0.1.33 are converged by init_sqlite_db.js (fresh
    // installs) and the idempotent startup fixes in sqlite-pool.js (existing
    // installs), which run before this.
    mutatesSchema: false,
    up: () => {},
  },
  {
    version: 2,
    name: 'canonical-investment-position-ledger',
    up: (db) => {
      addColumnIfMissing(db, 'investment_assets', 'current_price', 'REAL');
      addColumnIfMissing(db, 'investment_assets', 'current_value', 'REAL');
      addColumnIfMissing(db, 'investment_assets', 'cost_basis', 'REAL');
      addColumnIfMissing(db, 'investment_assets', 'valuation_date', 'TEXT');

      addColumnIfMissing(db, 'investment_positions', 'asset_symbol', 'TEXT');
      addColumnIfMissing(db, 'investment_positions', 'units', 'REAL NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'investment_positions', 'average_cost', 'REAL');
      addColumnIfMissing(db, 'investment_positions', 'current_price', 'REAL');
      addColumnIfMissing(db, 'investment_positions', 'valuation_date', 'TEXT');
      addColumnIfMissing(db, 'investment_positions', 'source', "TEXT NOT NULL DEFAULT 'manual'");
      addColumnIfMissing(db, 'investment_positions', 'legacy_asset_id', 'INTEGER');

      addColumnIfMissing(db, 'investment_position_events', 'tax_amount', 'REAL');
      addColumnIfMissing(db, 'investment_position_events', 'proceeds_amount', 'REAL');
      addColumnIfMissing(db, 'investment_position_events', 'disposed_cost_basis', 'REAL');
      addColumnIfMissing(db, 'investment_position_events', 'realized_gain_loss', 'REAL');
      addColumnIfMissing(db, 'investment_position_events', 'reinvested', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'investment_position_events', 'deducted_from_position', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'investment_position_events', 'current_price', 'REAL');

      if (tableExists(db, 'investment_positions')) {
        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_positions_legacy_asset
          ON investment_positions(legacy_asset_id)
          WHERE legacy_asset_id IS NOT NULL
        `);
      }

      if (
        tableExists(db, 'investment_assets')
        && tableExists(db, 'investment_positions')
        && tableExists(db, 'investment_accounts')
      ) {
        db.exec(`
          INSERT INTO investment_positions (
            account_id,
            position_name,
            asset_symbol,
            asset_type,
            currency,
            status,
            opened_at,
            closed_at,
            units,
            average_cost,
            current_price,
            valuation_date,
            source,
            legacy_asset_id,
            original_cost_basis,
            open_cost_basis,
            current_value,
            notes
          )
          SELECT
            asset.account_id,
            asset.asset_name,
            asset.asset_symbol,
            asset.asset_type,
            COALESCE(NULLIF(TRIM(asset.currency), ''), account.currency, 'USD'),
            CASE WHEN COALESCE(asset.is_active, 1) = 1 THEN 'open' ELSE 'closed' END,
            COALESCE(substr(asset.created_at, 1, 10), date('now')),
            CASE WHEN COALESCE(asset.is_active, 1) = 1
              THEN NULL
              ELSE COALESCE(substr(asset.updated_at, 1, 10), date('now'))
            END,
            COALESCE(asset.units, 0),
            asset.average_cost,
            COALESCE(asset.current_price, CASE WHEN asset.asset_type = 'cash' THEN 1 ELSE NULL END),
            COALESCE(asset.valuation_date, substr(asset.updated_at, 1, 10)),
            'legacy_asset',
            asset.id,
            COALESCE(
              asset.cost_basis,
              CASE
                WHEN asset.average_cost IS NOT NULL THEN COALESCE(asset.units, 0) * asset.average_cost
                WHEN asset.asset_type = 'cash' THEN COALESCE(asset.units, 0)
                ELSE 0
              END
            ),
            COALESCE(
              asset.cost_basis,
              CASE
                WHEN asset.average_cost IS NOT NULL THEN COALESCE(asset.units, 0) * asset.average_cost
                WHEN asset.asset_type = 'cash' THEN COALESCE(asset.units, 0)
                ELSE 0
              END
            ),
            COALESCE(
              asset.current_value,
              CASE
                WHEN asset.current_price IS NOT NULL THEN COALESCE(asset.units, 0) * asset.current_price
                WHEN asset.asset_type = 'cash' THEN COALESCE(asset.units, 0)
                ELSE NULL
              END
            ),
            asset.notes
          FROM investment_assets asset
          JOIN investment_accounts account ON account.id = asset.account_id
          WHERE NOT EXISTS (
            SELECT 1
            FROM investment_positions position
            WHERE position.legacy_asset_id = asset.id
          )
        `);

        createLegacyAssetPositionMirrorTriggers(db);
      }
    },
  },
  {
    version: 3,
    name: 'investment-completeness-settings',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS investment_allocation_targets (
          scope TEXT NOT NULL,
          category TEXT NOT NULL,
          target_percentage REAL NOT NULL CHECK (target_percentage >= 0 AND target_percentage <= 100),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (scope, category)
        );

        CREATE TABLE IF NOT EXISTS investment_liabilities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          liability_name TEXT NOT NULL,
          liability_type TEXT NOT NULL DEFAULT 'other',
          balance REAL NOT NULL CHECK (balance >= 0),
          currency TEXT NOT NULL DEFAULT 'ILS',
          interest_rate REAL,
          monthly_payment REAL,
          as_of_date TEXT NOT NULL,
          included_in_net_worth INTEGER NOT NULL DEFAULT 1 CHECK (included_in_net_worth IN (0, 1)),
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS investment_fx_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          base_currency TEXT NOT NULL DEFAULT 'ILS',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS investment_fx_rates (
          rate_date TEXT NOT NULL,
          from_currency TEXT NOT NULL,
          to_currency TEXT NOT NULL,
          rate REAL NOT NULL CHECK (rate > 0),
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (rate_date, from_currency, to_currency)
        );

        CREATE TABLE IF NOT EXISTS investment_benchmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          currency TEXT NOT NULL DEFAULT 'ILS',
          is_total_return INTEGER NOT NULL DEFAULT 0 CHECK (is_total_return IN (0, 1)),
          source TEXT NOT NULL,
          source_version TEXT,
          is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS investment_benchmark_points (
          benchmark_id INTEGER NOT NULL,
          point_date TEXT NOT NULL,
          point_value REAL NOT NULL CHECK (point_value > 0),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (benchmark_id, point_date),
          FOREIGN KEY (benchmark_id) REFERENCES investment_benchmarks(id) ON DELETE CASCADE
        );

        INSERT INTO investment_fx_preferences (id, base_currency)
        VALUES (1, 'ILS')
        ON CONFLICT (id) DO NOTHING;

        CREATE INDEX IF NOT EXISTS idx_investment_liabilities_active
          ON investment_liabilities(is_active, as_of_date DESC);
        CREATE INDEX IF NOT EXISTS idx_investment_fx_rates_lookup
          ON investment_fx_rates(from_currency, to_currency, rate_date DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_benchmarks_default
          ON investment_benchmarks(is_default) WHERE is_default = 1;
        CREATE INDEX IF NOT EXISTS idx_investment_benchmark_points_date
          ON investment_benchmark_points(benchmark_id, point_date ASC);
      `);
    },
  },
  {
    version: 4,
    name: 'auditable-position-prices-and-safe-legacy-mirror',
    up: (db) => {
      addColumnIfMissing(db, 'investment_position_events', 'current_price', 'REAL');
      if (tableExists(db, 'investment_position_events')) {
        db.exec(`
          DROP INDEX IF EXISTS idx_position_events_position;
          CREATE INDEX IF NOT EXISTS idx_investment_position_events_position
          ON investment_position_events(position_id, effective_date DESC);
        `);
      }
      createLegacyAssetPositionMirrorTriggers(db);
    },
  },
  {
    version: 5,
    name: 'unique-position-event-transaction-links',
    up: (db) => {
      createLinkedPositionEventTransactionIndex(db);
    },
  },
  {
    // Existing ShekelSync databases may already carry PRAGMA user_version 5
    // from the pre-registry migration path. This must therefore be v6 rather
    // than v2 or those databases would silently skip the optimizer schema.
    version: 6,
    name: 'optimizer-v2-review-scope-action',
    mutatesSchema: true,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS optimizer_v2_review_groups (
          group_key TEXT PRIMARY KEY CHECK(group_key IN (
            'household', 'cash_flow', 'banking', 'investments', 'real_estate'
          )),
          fingerprint TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('confirmed', 'excluded')),
          confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS optimizer_v2_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_uuid TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('complete', 'failed')),
          primary_scope TEXT NOT NULL,
          extra_scopes_json TEXT NOT NULL DEFAULT '[]',
          constraints_json TEXT NOT NULL,
          review_fingerprints_json TEXT NOT NULL,
          timings_json TEXT NOT NULL DEFAULT '{}',
          checked_areas_json TEXT NOT NULL DEFAULT '[]',
          source_metadata_json TEXT NOT NULL DEFAULT '[]',
          research_status TEXT NOT NULL DEFAULT 'not_requested',
          score_version TEXT NOT NULL DEFAULT 'optimizer-v2-score-1',
          openai_model TEXT,
          error_codes_json TEXT NOT NULL DEFAULT '[]',
          generated_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS optimizer_v2_candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL,
          action_id TEXT NOT NULL,
          smart_action_item_id INTEGER,
          scope TEXT NOT NULL,
          provider TEXT,
          product TEXT,
          title TEXT NOT NULL,
          rationale TEXT NOT NULL,
          next_action TEXT NOT NULL,
          caveat TEXT,
          eligibility_status TEXT NOT NULL CHECK(eligibility_status IN ('matched', 'possible', 'ineligible')),
          eligibility_json TEXT NOT NULL DEFAULT '{}',
          one_time_low REAL NOT NULL DEFAULT 0,
          one_time_high REAL NOT NULL DEFAULT 0,
          monthly_low REAL NOT NULL DEFAULT 0,
          monthly_high REAL NOT NULL DEFAULT 0,
          annual_low REAL NOT NULL DEFAULT 0,
          annual_high REAL NOT NULL DEFAULT 0,
          score REAL NOT NULL,
          confidence TEXT NOT NULL CHECK(confidence IN ('low', 'medium', 'high')),
          effort TEXT NOT NULL CHECK(effort IN ('low', 'medium', 'high')),
          evidence_json TEXT NOT NULL DEFAULT '[]',
          public_terms_json TEXT NOT NULL DEFAULT '{}',
          source_urls_json TEXT NOT NULL DEFAULT '[]',
          retrieved_at TEXT,
          valid_until TEXT,
          reverify_required INTEGER NOT NULL DEFAULT 0 CHECK(reverify_required IN (0, 1)),
          lifecycle_state TEXT NOT NULL DEFAULT 'candidate' CHECK(lifecycle_state IN (
            'candidate', 'added', 'started', 'snoozed', 'done', 'dismissed'
          )),
          feedback_code TEXT CHECK(feedback_code IS NULL OR feedback_code IN ('useful', 'not_useful', 'unsure')),
          feedback_reasons_json TEXT NOT NULL DEFAULT '[]',
          outcome_band TEXT CHECK(outcome_band IS NULL OR outcome_band IN (
            'none', 'below_estimate', 'within_estimate', 'above_estimate', 'unknown'
          )),
          snooze_preset TEXT CHECK(snooze_preset IS NULL OR snooze_preset IN ('1_week', '1_month', '3_months')),
          dismiss_reason TEXT,
          source_verified_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(run_id, action_id),
          FOREIGN KEY (run_id) REFERENCES optimizer_v2_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (smart_action_item_id) REFERENCES smart_action_items(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS optimizer_v2_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL,
          candidate_id INTEGER,
          url TEXT NOT NULL,
          domain TEXT NOT NULL,
          title TEXT,
          trust_tier TEXT NOT NULL CHECK(trust_tier IN ('regulator', 'provider', 'established', 'lead')),
          retrieved_at TEXT NOT NULL,
          valid_until TEXT,
          verified_at TEXT,
          availability_status TEXT NOT NULL DEFAULT 'unverified' CHECK(availability_status IN (
            'unverified', 'available', 'unavailable'
          )),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (run_id) REFERENCES optimizer_v2_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (candidate_id) REFERENCES optimizer_v2_candidates(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_review_status
          ON optimizer_v2_review_groups(status);
        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_runs_generated
          ON optimizer_v2_runs(generated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_candidates_run_score
          ON optimizer_v2_candidates(run_id, score DESC);
        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_candidates_lifecycle
          ON optimizer_v2_candidates(lifecycle_state);
        CREATE INDEX IF NOT EXISTS idx_optimizer_v2_sources_run
          ON optimizer_v2_sources(run_id);
      `);
    },
  },
  {
    version: 7,
    name: 'connected-financial-truth',
    mutatesSchema: true,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS financial_patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fingerprint TEXT NOT NULL UNIQUE,
          normalized_name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('expense', 'income')),
          category_definition_id INTEGER,
          detected_frequency TEXT NOT NULL CHECK(detected_frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'yearly', 'variable')),
          detected_amount REAL NOT NULL DEFAULT 0,
          amount_tolerance REAL NOT NULL DEFAULT 0,
          confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
          first_seen_date TEXT,
          last_seen_date TEXT,
          next_expected_date TEXT,
          occurrence_count INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'detected' CHECK(source IN ('detected', 'manual', 'legacy_subscription')),
          is_subscription INTEGER NOT NULL DEFAULT 0 CHECK(is_subscription IN (0, 1)),
          evidence_signature TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS financial_pattern_transactions (
          pattern_id INTEGER NOT NULL,
          transaction_identifier TEXT NOT NULL,
          transaction_vendor TEXT NOT NULL,
          transaction_date TEXT NOT NULL,
          amount REAL NOT NULL,
          match_score REAL NOT NULL DEFAULT 1 CHECK(match_score >= 0 AND match_score <= 1),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (pattern_id, transaction_identifier, transaction_vendor),
          FOREIGN KEY (pattern_id) REFERENCES financial_patterns(id) ON DELETE CASCADE,
          FOREIGN KEY (transaction_identifier, transaction_vendor) REFERENCES transactions(identifier, vendor) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS financial_corrections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL UNIQUE,
          target_kind TEXT NOT NULL CHECK(target_kind IN ('pattern', 'occurrence', 'category')),
          pattern_id INTEGER,
          occurrence_id TEXT,
          category_definition_id INTEGER,
          action TEXT NOT NULL CHECK(action IN ('skip_occurrence', 'suppress_pattern', 'end_pattern', 'pause_pattern', 'override_pattern', 'set_category_expectation')),
          scope TEXT NOT NULL CHECK(scope IN ('occurrence', 'from_date', 'current_month', 'ongoing')),
          effective_date TEXT,
          effective_end_date TEXT,
          reason_code TEXT,
          source_feature TEXT NOT NULL,
          source_key TEXT,
          overrides_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'reverted', 'superseded')),
          supersedes_id INTEGER,
          reverted_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (pattern_id) REFERENCES financial_patterns(id) ON DELETE CASCADE,
          FOREIGN KEY (category_definition_id) REFERENCES category_definitions(id) ON DELETE CASCADE,
          FOREIGN KEY (supersedes_id) REFERENCES financial_corrections(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS financial_truth_state (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          revision INTEGER NOT NULL DEFAULT 0,
          materialized_transaction_signature TEXT,
          materialized_at TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO financial_truth_state (id, revision) VALUES (1, 0);

        CREATE TABLE IF NOT EXISTS presentation_dismissals (
          source_key TEXT PRIMARY KEY,
          source_type TEXT NOT NULL,
          hidden INTEGER NOT NULL DEFAULT 1 CHECK(hidden IN (0, 1)),
          hidden_at TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_financial_patterns_lookup
          ON financial_patterns(normalized_name, direction, detected_frequency);
        CREATE INDEX IF NOT EXISTS idx_financial_pattern_transactions_transaction
          ON financial_pattern_transactions(transaction_identifier, transaction_vendor);
        CREATE INDEX IF NOT EXISTS idx_financial_corrections_active_pattern
          ON financial_corrections(pattern_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_financial_corrections_active_category
          ON financial_corrections(category_definition_id, status, created_at DESC);
      `);

      if (tableExists(db, 'transactions')) {
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_financial_truth_transactions_insert
          AFTER INSERT ON transactions
          BEGIN
            UPDATE financial_truth_state
            SET materialized_transaction_signature = NULL, updated_at = datetime('now')
            WHERE id = 1;
          END;
          CREATE TRIGGER IF NOT EXISTS trg_financial_truth_transactions_update
          AFTER UPDATE ON transactions
          BEGIN
            UPDATE financial_truth_state
            SET materialized_transaction_signature = NULL, updated_at = datetime('now')
            WHERE id = 1;
          END;
          CREATE TRIGGER IF NOT EXISTS trg_financial_truth_transactions_delete
          AFTER DELETE ON transactions
          BEGIN
            UPDATE financial_truth_state
            SET materialized_transaction_signature = NULL, updated_at = datetime('now')
            WHERE id = 1;
          END;
        `);
      }

      addColumnIfMissing(db, 'subscriptions', 'financial_pattern_id', 'INTEGER REFERENCES financial_patterns(id) ON DELETE SET NULL');

      if (!tableExists(db, 'subscriptions')) return;
      const legacySubscriptions = db.prepare(`
        SELECT s.*,
          COALESCE((
            SELECT event_date FROM subscription_history history
            WHERE history.subscription_id = s.id AND history.event_type = 'status_change'
            ORDER BY history.event_date DESC, history.id DESC LIMIT 1
          ), substr(s.updated_at, 1, 10)) AS status_effective_date
        FROM subscriptions s
      `).all();
      const insertPattern = db.prepare(`
        INSERT INTO financial_patterns (
          fingerprint, normalized_name, display_name, direction, category_definition_id,
          detected_frequency, detected_amount, amount_tolerance, confidence,
          first_seen_date, last_seen_date, next_expected_date, source, is_subscription
        ) VALUES (?, ?, ?, 'expense', ?, ?, ?, ?, ?, ?, ?, ?, 'legacy_subscription', 1)
        ON CONFLICT(fingerprint) DO UPDATE SET
          display_name = excluded.display_name,
          category_definition_id = COALESCE(financial_patterns.category_definition_id, excluded.category_definition_id),
          is_subscription = 1,
          updated_at = datetime('now')
        RETURNING id
      `);
      const insertCorrection = db.prepare(`
        INSERT OR IGNORE INTO financial_corrections (
          request_id, target_kind, pattern_id, action, scope, effective_date,
          reason_code, source_feature, source_key, overrides_json
        ) VALUES (?, 'pattern', ?, ?, ?, ?, 'legacy_explicit_choice', 'migration', ?, ?)
      `);
      const updateSubscription = db.prepare('UPDATE subscriptions SET financial_pattern_id = ? WHERE id = ?');

      for (const sub of legacySubscriptions) {
        const normalizedName = String(sub.pattern_key || sub.display_name || '')
          .toLowerCase().trim().replace(/[^a-z0-9\u0590-\u05ff]+/g, '_').replace(/^_+|_+$/g, '');
        if (!normalizedName) continue;
        const frequency = sub.user_frequency || sub.detected_frequency || 'monthly';
        const amount = Number(sub.user_amount ?? sub.detected_amount) || 0;
        const fingerprint = `legacy:${normalizedName}:expense:${frequency}`;
        const pattern = insertPattern.get(
          fingerprint, normalizedName, sub.display_name || normalizedName,
          sub.category_definition_id || null, frequency, amount,
          Math.max(5, Math.abs(amount) * 0.15), Number(sub.consistency_score) || 0.5,
          sub.first_detected_date || null, sub.last_charge_date || null,
          sub.next_expected_date || null,
        );
        updateSubscription.run(pattern.id, sub.id);

        let action = null;
        let scope = 'ongoing';
        let effectiveDate = null;
        if (sub.status === 'cancelled') {
          action = 'end_pattern';
          scope = 'from_date';
          effectiveDate = sub.status_effective_date;
        } else if (sub.status === 'paused') {
          action = 'pause_pattern';
        } else if (sub.user_amount != null || sub.user_frequency != null || sub.billing_day != null || sub.status === 'keep') {
          action = 'override_pattern';
        }
        if (action) {
          insertCorrection.run(
            `migration:subscription:${sub.id}:${action}`,
            pattern.id,
            action,
            scope,
            effectiveDate,
            `subscription:${sub.id}`,
            JSON.stringify({
              ...(sub.user_amount != null ? { amount: Number(sub.user_amount) } : {}),
              ...(sub.user_frequency ? { frequency: sub.user_frequency } : {}),
              ...(sub.billing_day != null ? { billingDay: Number(sub.billing_day) } : {}),
              ...(sub.status === 'keep' ? { confirmed: true } : {}),
            }),
          );
        }
      }
    },
  },
];

const CURRENT_SCHEMA_VERSION = MIGRATIONS.length
  ? MIGRATIONS[MIGRATIONS.length - 1].version
  : 0;

function getSchemaVersion(db) {
  const value = db.pragma('user_version', { simple: true });
  return Number.isInteger(value) ? value : Number(value) || 0;
}

function validateMigrations(migrations) {
  let previousVersion = 0;
  for (const migration of migrations) {
    if (!migration || !Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(
        `[schema-migrations] invalid migration version: ${migration && migration.version}`,
      );
    }
    if (migration.version <= previousVersion) {
      throw new Error(
        `[schema-migrations] migration versions must be strictly ascending; ` +
        `found v${migration.version} after v${previousVersion}`,
      );
    }
    if (typeof migration.up !== 'function') {
      throw new Error(`[schema-migrations] migration v${migration.version} has no up() function`);
    }
    previousVersion = migration.version;
  }
}

function createPreMigrationBackup(dbPath, fromVersion, toVersion) {
  const parsedPath = path.parse(dbPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(parsedPath.dir, 'backups');
  const backupPath = path.join(
    backupDir,
    `${parsedPath.name || 'shekelsync'}-pre-migration-v${fromVersion}-to-v${toVersion}-${timestamp}${parsedPath.ext || '.sqlite'}`,
  );

  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(dbPath, backupPath);

  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) {
    fs.copyFileSync(walPath, `${backupPath}-wal`);
  }
  if (fs.existsSync(shmPath)) {
    fs.copyFileSync(shmPath, `${backupPath}-shm`);
  }

  return backupPath;
}

/**
 * Apply all migrations newer than the database's current user_version.
 * Throws (after rolling back the failing migration) so callers fail closed
 * instead of serving a half-migrated database.
 *
 * @param {import('better-sqlite3').Database} db open database handle
 * @param {object} [options]
 * @param {string} [options.dbPath] file path, enables the pre-migration backup
 * @param {object} [options.logger] console-like logger
 * @param {Array} [options.migrations] override registry (tests only)
 * @returns {{fromVersion: number, toVersion: number, applied: string[], backupPath: string|null}}
 */
function runSchemaMigrations(db, options = {}) {
  const { dbPath = null, logger = console, migrations = MIGRATIONS } = options;
  validateMigrations(migrations);

  const fromVersion = getSchemaVersion(db);
  const pending = migrations.filter((migration) => migration.version > fromVersion);
  if (pending.length === 0) {
    return { fromVersion, toVersion: fromVersion, applied: [], backupPath: null };
  }

  const targetVersion = pending[pending.length - 1].version;

  // Back up only when a pending migration actually changes the database.
  // Pure version stamps (mutatesSchema === false) have nothing to lose.
  const needsBackup = pending.some((migration) => migration.mutatesSchema !== false);

  let backupPath = null;
  if (needsBackup && dbPath && fs.existsSync(dbPath)) {
    // Fail closed: if we cannot secure a backup, do not touch the schema.
    backupPath = createPreMigrationBackup(dbPath, fromVersion, targetVersion);
  }

  const applied = [];
  for (const migration of pending) {
    try {
      db.exec('BEGIN IMMEDIATE');
      // Another connection may have migrated while we waited for the lock.
      if (getSchemaVersion(db) >= migration.version) {
        db.exec('ROLLBACK');
        continue;
      }
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      if (db.inTransaction) {
        try {
          db.exec('ROLLBACK');
        } catch (_rollbackError) {
          // Preserve the original migration error.
        }
      }
      error.message =
        `[schema-migrations] migration v${migration.version} (${migration.name}) failed: ` +
        `${error.message}. Database left at schema version ${getSchemaVersion(db)}.` +
        (backupPath ? ` Pre-migration backup: ${backupPath}` : '');
      throw error;
    }
    applied.push(`v${migration.version} ${migration.name}`);
  }

  if (applied.length > 0) {
    logger.log(
      `[schema-migrations] migrated ${fromVersion} -> ${targetVersion}: ${applied.join(', ')}`,
    );
  }

  return { fromVersion, toVersion: targetVersion, applied, backupPath };
}

module.exports = {
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  runSchemaMigrations,
};
module.exports.default = module.exports;
