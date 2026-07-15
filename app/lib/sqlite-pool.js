const path = require('path');
const fs = require('fs');
const resolveBetterSqlite = require('./better-sqlite3-wrapper.js');

const PLACEHOLDER_REGEX = /\$(\d+)/g;
const SELECT_LIKE_REGEX = /^\s*(WITH|SELECT|PRAGMA)/i;
const RETURNING_REGEX = /\bRETURNING\b/i;

function normalizeValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === true) return 1;
  if (value === false) return 0;
  return value;
}

function normalizeParams(params) {
  if (!Array.isArray(params)) return [];
  return params.map(normalizeValue);
}

let cachedDatabaseCtor;

function resolveDatabaseCtor(override) {
  if (override) {
    return override;
  }

  if (!cachedDatabaseCtor) {
    const resolved = resolveBetterSqlite();
    cachedDatabaseCtor = resolved.default ?? resolved;
  }

  return cachedDatabaseCtor;
}

function resolveDefaultSqlitePath(cwd = process.cwd()) {
  const preferredPath = path.join(cwd, 'dist', 'shekelsync.sqlite');
  const legacyPath = path.join(cwd, 'dist', 'clarify.sqlite');

  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  return preferredPath;
}

function getTableSql(db, tableName) {
  try {
    const row = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(tableName);
    return row?.sql || '';
  } catch {
    return '';
  }
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info('${tableName}')`).all();
  const exists = Array.isArray(columns) && columns.some((column) => column?.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function rebuildInvestmentHoldingsForPikadonEntries(db) {
  const columns = db.prepare("PRAGMA table_info('investment_holdings')").all();
  if (!Array.isArray(columns) || columns.length === 0) {
    return;
  }

  db.exec(`
    UPDATE investment_holdings
    SET holding_type = 'standard'
    WHERE holding_type IS NULL OR TRIM(holding_type) = ''
  `);

  if (!getTableSql(db, 'investment_holdings').includes('UNIQUE(account_id, as_of_date)')) {
    return;
  }

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');

  try {
    db.exec(`
      CREATE TABLE investment_holdings__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        asset_name TEXT,
        asset_type TEXT,
        units REAL,
        current_value REAL NOT NULL,
        cost_basis REAL,
        as_of_date TEXT NOT NULL,
        notes TEXT,
        holding_type TEXT NOT NULL DEFAULT 'standard',
        deposit_transaction_id TEXT,
        deposit_transaction_vendor TEXT,
        return_transaction_id TEXT,
        return_transaction_vendor TEXT,
        maturity_date TEXT,
        interest_rate REAL,
        status TEXT DEFAULT 'active',
        parent_pikadon_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_pikadon_id) REFERENCES investment_holdings(id) ON DELETE SET NULL
      );
    `);
    db.exec(`
      INSERT INTO investment_holdings__new (
        id,
        account_id,
        asset_name,
        asset_type,
        units,
        current_value,
        cost_basis,
        as_of_date,
        notes,
        holding_type,
        deposit_transaction_id,
        deposit_transaction_vendor,
        return_transaction_id,
        return_transaction_vendor,
        maturity_date,
        interest_rate,
        status,
        parent_pikadon_id,
        created_at,
        updated_at
      )
      SELECT
        id,
        account_id,
        asset_name,
        asset_type,
        units,
        current_value,
        cost_basis,
        as_of_date,
        notes,
        COALESCE(NULLIF(TRIM(holding_type), ''), 'standard'),
        deposit_transaction_id,
        deposit_transaction_vendor,
        return_transaction_id,
        return_transaction_vendor,
        maturity_date,
        interest_rate,
        status,
        parent_pikadon_id,
        created_at,
        updated_at
      FROM investment_holdings;
    `);
    db.exec('DROP TABLE investment_holdings');
    db.exec('ALTER TABLE investment_holdings__new RENAME TO investment_holdings');
    db.exec('COMMIT');
  } catch (error) {
    if (db.inTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

const SMART_ACTION_COLUMNS = [
  ['id', 'id', 'NULL'],
  ['action_type', 'action_type', "'optimization'"],
  ['trigger_category_id', 'trigger_category_id', 'NULL'],
  ['severity', "COALESCE(severity, 'medium')", "'medium'"],
  ['title', 'title', "'Untitled action'"],
  ['description', 'description', 'NULL'],
  ['detected_at', "COALESCE(detected_at, datetime('now'))", "datetime('now')"],
  ['resolved_at', 'resolved_at', 'NULL'],
  ['dismissed_at', 'dismissed_at', 'NULL'],
  ['snoozed_until', 'snoozed_until', 'NULL'],
  ['user_status', "COALESCE(user_status, 'active')", "'active'"],
  ['metadata', 'metadata', 'NULL'],
  ['potential_impact', 'potential_impact', 'NULL'],
  ['detection_confidence', 'COALESCE(detection_confidence, 0.5)', '0.5'],
  ['is_recurring', 'COALESCE(is_recurring, 0)', '0'],
  ['recurrence_key', 'recurrence_key', 'NULL'],
  ['deadline', 'deadline', 'NULL'],
  ['accepted_at', 'accepted_at', 'NULL'],
  ['points_reward', 'COALESCE(points_reward, 0)', '0'],
  ['points_earned', 'COALESCE(points_earned, 0)', '0'],
  ['completion_criteria', 'completion_criteria', 'NULL'],
  ['completion_result', 'completion_result', 'NULL'],
  ['quest_difficulty', 'quest_difficulty', 'NULL'],
  ['quest_duration_days', 'quest_duration_days', 'NULL'],
  ['created_at', "COALESCE(created_at, datetime('now'))", "datetime('now')"],
  ['updated_at', "COALESCE(updated_at, datetime('now'))", "datetime('now')"],
];

const ACTION_ITEM_HISTORY_COLUMNS = [
  ['id', 'id', 'NULL'],
  ['smart_action_item_id', 'smart_action_item_id', 'NULL'],
  [
    'action',
    `CASE
      WHEN action IN (
        'created', 'dismissed', 'resolved', 'snoozed', 'reactivated',
        'updated', 'accepted', 'completed', 'failed'
      ) THEN action
      ELSE 'updated'
    END`,
    "'updated'",
  ],
  ['previous_status', 'previous_status', 'NULL'],
  ['new_status', 'new_status', 'NULL'],
  ['user_note', 'user_note', 'NULL'],
  ['metadata', 'metadata', 'NULL'],
  ['created_at', "COALESCE(created_at, datetime('now'))", "datetime('now')"],
];

function createSmartActionItemsTableSql(tableName = 'smart_action_items') {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL CHECK(action_type IN (
        'anomaly', 'budget_overrun', 'optimization', 'fixed_variation',
        'unusual_purchase', 'seasonal_alert', 'fixed_recurring_change',
        'fixed_recurring_missing', 'fixed_recurring_duplicate',
        'optimization_reallocate', 'optimization_add_budget',
        'optimization_low_confidence',
        'quest_reduce_spending', 'quest_savings_target', 'quest_budget_adherence',
        'quest_set_budget', 'quest_reduce_fixed_cost', 'quest_income_goal',
        'quest_merchant_limit', 'quest_weekend_limit'
      )),
      trigger_category_id INTEGER,
      severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      title TEXT NOT NULL,
      description TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      dismissed_at TEXT,
      snoozed_until TEXT,
      user_status TEXT NOT NULL DEFAULT 'active' CHECK(user_status IN ('active', 'dismissed', 'resolved', 'snoozed', 'accepted', 'failed')),
      metadata TEXT,
      potential_impact REAL,
      detection_confidence REAL DEFAULT 0.5 CHECK(detection_confidence >= 0 AND detection_confidence <= 1),
      is_recurring INTEGER NOT NULL DEFAULT 0 CHECK(is_recurring IN (0, 1)),
      recurrence_key TEXT,
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
  `;
}

function createActionItemHistoryTableSql(tableName = 'action_item_history') {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      smart_action_item_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN (
        'created', 'dismissed', 'resolved', 'snoozed', 'reactivated',
        'updated', 'accepted', 'completed', 'failed'
      )),
      previous_status TEXT,
      new_status TEXT,
      user_note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (smart_action_item_id) REFERENCES smart_action_items(id) ON DELETE CASCADE
    );
  `;
}

function createSmartActionIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_type ON smart_action_items(action_type);
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_status ON smart_action_items(user_status);
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_severity ON smart_action_items(severity);
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_category ON smart_action_items(trigger_category_id);
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_detected_at ON smart_action_items(detected_at DESC);
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_recurrence ON smart_action_items(recurrence_key, user_status);
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_deadline ON smart_action_items(deadline);
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_accepted_at ON smart_action_items(accepted_at);
    CREATE INDEX IF NOT EXISTS idx_smart_action_items_quest_difficulty ON smart_action_items(quest_difficulty);
  `);
}

function createSmartActionTriggers(db) {
  db.exec('DROP TRIGGER IF EXISTS update_smart_action_items_timestamp');
  db.exec('DROP TRIGGER IF EXISTS log_smart_action_item_status_change');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_smart_action_items_timestamp
    AFTER UPDATE ON smart_action_items
    BEGIN
      UPDATE smart_action_items SET updated_at = datetime('now') WHERE id = NEW.id;
    END
  `);
  db.exec(`
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
          WHEN 'accepted' THEN 'accepted'
          WHEN 'completed' THEN 'completed'
          WHEN 'failed' THEN 'failed'
          WHEN 'active' THEN 'reactivated'
          ELSE 'updated'
        END,
        OLD.user_status,
        NEW.user_status
      );
    END
  `);
}

function ensureSmartActionCompatibility(db) {
  const smartActionTableSql = getTableSql(db, 'smart_action_items');
  if (!smartActionTableSql) {
    return;
  }

  const historyTableSql = getTableSql(db, 'action_item_history');
  const smartActionNeedsRebuild = !(
    smartActionTableSql.includes("'optimization'")
    && smartActionTableSql.includes("'fixed_recurring_change'")
    && smartActionTableSql.includes("'optimization_reallocate'")
    && smartActionTableSql.includes("'quest_reduce_spending'")
    && smartActionTableSql.includes("'snoozed'")
    && smartActionTableSql.includes('snoozed_until')
    && smartActionTableSql.includes("'critical'")
  );
  const historyNeedsRebuild = !historyTableSql
    || historyTableSql.includes('smart_action_items_old')
    || !historyTableSql.includes("'snoozed'")
    || !historyTableSql.includes("'reactivated'")
    || !historyTableSql.includes("'updated'");

  if (!smartActionNeedsRebuild && !historyNeedsRebuild) {
    return;
  }

  const smartActionColumns = smartActionNeedsRebuild
    ? db.prepare("PRAGMA table_info('smart_action_items')").all()
    : [];
  const existingSmartActionColumns = new Set(smartActionColumns.map((column) => column.name));
  const historyColumns = historyTableSql
    ? db.prepare("PRAGMA table_info('action_item_history')").all()
    : [];
  const existingHistoryColumns = new Set(historyColumns.map((column) => column.name));

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');

  try {
    db.exec('DROP TRIGGER IF EXISTS update_smart_action_items_timestamp');
    db.exec('DROP TRIGGER IF EXISTS log_smart_action_item_status_change');

    if (smartActionNeedsRebuild) {
      const insertColumns = SMART_ACTION_COLUMNS.map(([column]) => column);
      const selectColumns = SMART_ACTION_COLUMNS.map(([column, existingExpression, fallback]) => (
        existingSmartActionColumns.has(column)
          ? `${existingExpression} AS ${column}`
          : `${fallback} AS ${column}`
      ));
      db.exec('DROP TABLE IF EXISTS smart_action_items__new');
      db.exec(createSmartActionItemsTableSql('smart_action_items__new'));
      db.exec(`
        INSERT INTO smart_action_items__new (${insertColumns.join(', ')})
        SELECT ${selectColumns.join(', ')}
        FROM smart_action_items
      `);
      db.exec('DROP TABLE smart_action_items');
      db.exec('ALTER TABLE smart_action_items__new RENAME TO smart_action_items');
    }

    if (historyNeedsRebuild) {
      db.exec('DROP TABLE IF EXISTS action_item_history__new');
      db.exec(createActionItemHistoryTableSql('action_item_history__new'));
      if (historyTableSql) {
        const insertColumns = ACTION_ITEM_HISTORY_COLUMNS.map(([column]) => column);
        const selectColumns = ACTION_ITEM_HISTORY_COLUMNS.map(([column, existingExpression, fallback]) => (
          existingHistoryColumns.has(column)
            ? `${existingExpression} AS ${column}`
            : `${fallback} AS ${column}`
        ));
        db.exec(`
          INSERT INTO action_item_history__new (${insertColumns.join(', ')})
          SELECT ${selectColumns.join(', ')}
          FROM action_item_history
        `);
        db.exec('DROP TABLE action_item_history');
      }
      db.exec('ALTER TABLE action_item_history__new RENAME TO action_item_history');
    }

    createSmartActionIndexes(db);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_action_item_history_item_id
      ON action_item_history(smart_action_item_id, created_at DESC)
    `);
    createSmartActionTriggers(db);

    const foreignKeyViolations = db
      .prepare("PRAGMA foreign_key_check('action_item_history')")
      .all();
    if (foreignKeyViolations.length > 0) {
      throw new Error('action_item_history contains invalid smart action references');
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.inTransaction) {
      db.exec('ROLLBACK');
    }
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function ensureOptimizerTables(db) {
  db.exec(`
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
  `);
}

/**
 * Run startup-critical, idempotent schema migrations/fixes before the pool is returned.
 * These tables/columns are queried immediately by request handlers, so they must exist
 * before the first caller can use the database connection.
 */
function runStartupSchemaMigrations(db) {
  try {
    const pairingColumns = db.prepare("PRAGMA table_info('account_pairings')").all();
    if (Array.isArray(pairingColumns) && pairingColumns.length > 0) {
      const hasDiscrepancyAck = pairingColumns.some((col) => col && col.name === 'discrepancy_acknowledged');
      if (!hasDiscrepancyAck) {
        db.exec('ALTER TABLE account_pairings ADD COLUMN discrepancy_acknowledged INTEGER DEFAULT 0');
      }
    }

    const transactionColumns = db.prepare("PRAGMA table_info('transactions')").all();
    if (Array.isArray(transactionColumns) && transactionColumns.length > 0) {
      const hasTags = transactionColumns.some((col) => col && col.name === 'tags');
      if (!hasTags) {
        db.exec('ALTER TABLE transactions ADD COLUMN tags TEXT');
      }
    }
    const pairingExclusionInfo = db.prepare("PRAGMA table_info('transaction_pairing_exclusions')").all();
    const hasPairingExclusions = Array.isArray(pairingExclusionInfo) && pairingExclusionInfo.length > 0;
    const pairingIdPk = pairingExclusionInfo.some((col) => col && col.name === 'pairing_id' && col.pk);
    if (!hasPairingExclusions || !pairingIdPk) {
      db.exec('DROP TABLE IF EXISTS transaction_pairing_exclusions');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS transaction_pairing_exclusions (
        transaction_identifier TEXT NOT NULL,
        transaction_vendor TEXT NOT NULL,
        pairing_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (transaction_identifier, transaction_vendor, pairing_id),
        FOREIGN KEY (transaction_identifier, transaction_vendor)
          REFERENCES transactions(identifier, vendor)
          ON DELETE CASCADE,
        FOREIGN KEY (pairing_id) REFERENCES account_pairings(id) ON DELETE CASCADE
      );
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_pairing_exclusions_pairing_id ON transaction_pairing_exclusions(pairing_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pairing_exclusions_txn ON transaction_pairing_exclusions(transaction_identifier, transaction_vendor);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_processed_date ON transactions (processed_date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_status_date ON transactions (status, date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_date_desc ON transactions (date DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions (category_definition_id, date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_category_def ON transactions (category_definition_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_vendor_date ON transactions (vendor, date);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions (vendor);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_name ON transactions (name COLLATE NOCASE);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_category_definitions_type ON category_definitions (category_type);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_category_definitions_parent ON category_definitions (parent_id);');
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_holdings_standard_snapshot_unique
      ON investment_holdings(account_id, as_of_date)
      WHERE holding_type = 'standard';
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_holdings_pikadon_deposit_unique
      ON investment_holdings(deposit_transaction_id, deposit_transaction_vendor)
      WHERE holding_type = 'pikadon'
        AND deposit_transaction_id IS NOT NULL
        AND deposit_transaction_vendor IS NOT NULL;
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS profile_assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_type TEXT NOT NULL UNIQUE,
        profile_hash TEXT,
        benchmark_version TEXT,
        openai_model TEXT,
        generated_at TEXT,
        assessment_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS investment_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        position_name TEXT NOT NULL,
        asset_type TEXT,
        currency TEXT NOT NULL DEFAULT 'ILS',
        status TEXT NOT NULL DEFAULT 'open',
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        original_cost_basis REAL NOT NULL DEFAULT 0,
        open_cost_basis REAL NOT NULL DEFAULT 0,
        current_value REAL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS investment_position_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        effective_date TEXT NOT NULL,
        amount REAL,
        principal_amount REAL,
        income_amount REAL,
        fee_amount REAL,
        units REAL,
        current_value REAL,
        close_action TEXT,
        linked_transaction_identifier TEXT,
        linked_transaction_vendor TEXT,
        notes TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (position_id) REFERENCES investment_positions(id) ON DELETE CASCADE,
        FOREIGN KEY (linked_transaction_identifier, linked_transaction_vendor)
          REFERENCES transactions(identifier, vendor)
          ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS real_estate_properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL UNIQUE,
        city TEXT,
        neighborhood TEXT,
        property_type TEXT NOT NULL DEFAULT 'apartment',
        rooms REAL,
        square_meters REAL,
        floor REAL,
        total_floors REAL,
        has_elevator INTEGER CHECK (has_elevator IN (0,1) OR has_elevator IS NULL),
        has_parking INTEGER CHECK (has_parking IN (0,1) OR has_parking IS NULL),
        has_balcony INTEGER CHECK (has_balcony IN (0,1) OR has_balcony IS NULL),
        has_storage INTEGER CHECK (has_storage IN (0,1) OR has_storage IS NULL),
        ownership_percentage REAL NOT NULL DEFAULT 100,
        purchase_price REAL,
        purchase_date TEXT,
        mortgage_balance REAL,
        monthly_mortgage_payment REAL,
        mortgage_interest_rate REAL,
        mortgage_term_years REAL,
        monthly_rent REAL,
        annual_expenses REAL,
        price_per_sqm REAL,
        annual_growth_rate REAL,
        rental_yield_rate REAL,
        manual_estimated_value REAL,
        valuation_method TEXT NOT NULL DEFAULT 'blended',
        estimated_value REAL,
        estimated_net_equity REAL,
        confidence TEXT,
        scenario_conservative REAL,
        scenario_base REAL,
        scenario_optimistic REAL,
        assumptions_json TEXT,
        last_valuation_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
      );
    `);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_assessments_type ON profile_assessments(assessment_type);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_investment_positions_account ON investment_positions(account_id, status);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_investment_positions_status ON investment_positions(status, opened_at DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_investment_position_events_position ON investment_position_events(position_id, effective_date DESC);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_real_estate_properties_account ON real_estate_properties(account_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_real_estate_properties_city ON real_estate_properties(city);');
    addColumnIfMissing(db, 'real_estate_properties', 'monthly_mortgage_payment', 'REAL');
    addColumnIfMissing(db, 'real_estate_properties', 'mortgage_interest_rate', 'REAL');
    addColumnIfMissing(db, 'real_estate_properties', 'mortgage_term_years', 'REAL');
  } catch (_error) {
    // Ignore: table may not exist yet (e.g., before init_sqlite_db runs).
  }

  try {
    ensureOptimizerTables(db);
  } catch (_error) {
    // Ignore: database initialization may still be in progress.
  }

  try {
    ensureSmartActionCompatibility(db);
  } catch (_error) {
    // Ignore: Smart Actions tables may not exist before init_sqlite_db runs.
  }

  // Chat tables migration
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT NOT NULL UNIQUE,
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_message_at TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        total_tokens_used INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        tokens_used INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT,
        FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_external_id ON chat_conversations(external_id);
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_conversations_archived ON chat_conversations(is_archived, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_role ON chat_messages(role);
    `);
  } catch (_chatError) {
    // Ignore: chat tables migration may fail on older DBs
  }

}

/**
 * Run lower-priority maintenance after the pool is already available.
 * These repairs are not required for the first query to succeed.
 */
function runDeferredSchemaMaintenance(db) {
  try {
    rebuildInvestmentHoldingsForPikadonEntries(db);
  } catch (_error) {
    // Ignore: investment_holdings may not exist yet.
  }

  try {
    db.exec('DROP TRIGGER IF EXISTS trg_account_pairings_exclusions_insert');
    db.exec('DROP TRIGGER IF EXISTS trg_account_pairings_exclusions_update');
    db.exec('DROP TRIGGER IF EXISTS trg_account_pairings_exclusions_delete');
    db.exec('DROP TRIGGER IF EXISTS trg_transactions_exclusions_insert');
    db.exec('DROP TRIGGER IF EXISTS trg_transactions_exclusions_update');
    db.exec('DROP TRIGGER IF EXISTS transactions_fts_insert');
    db.exec('DROP TRIGGER IF EXISTS transactions_fts_delete');
    db.exec('DROP TRIGGER IF EXISTS transactions_fts_update');

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_account_pairings_exclusions_insert
      AFTER INSERT ON account_pairings
      BEGIN
        INSERT OR IGNORE INTO transaction_pairing_exclusions (
          transaction_identifier, transaction_vendor, pairing_id, created_at, updated_at
        )
        SELECT t.identifier, t.vendor, NEW.id, datetime('now'), datetime('now')
        FROM transactions t
        WHERE NEW.is_active = 1
          AND t.vendor = NEW.bank_vendor
          AND (NEW.bank_account_number IS NULL OR t.account_number = NEW.bank_account_number)
          AND NEW.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM json_each(COALESCE(NEW.match_patterns, '[]'))
            WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
          );
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_account_pairings_exclusions_update
      AFTER UPDATE OF is_active, bank_vendor, bank_account_number, match_patterns ON account_pairings
      BEGIN
        DELETE FROM transaction_pairing_exclusions WHERE pairing_id = OLD.id;
        INSERT OR IGNORE INTO transaction_pairing_exclusions (
          transaction_identifier, transaction_vendor, pairing_id, created_at, updated_at
        )
        SELECT t.identifier, t.vendor, NEW.id, datetime('now'), datetime('now')
        FROM transactions t
        WHERE NEW.is_active = 1
          AND t.vendor = NEW.bank_vendor
          AND (NEW.bank_account_number IS NULL OR t.account_number = NEW.bank_account_number)
          AND NEW.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM json_each(COALESCE(NEW.match_patterns, '[]'))
            WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
          );
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_account_pairings_exclusions_delete
      AFTER DELETE ON account_pairings
      BEGIN
        DELETE FROM transaction_pairing_exclusions WHERE pairing_id = OLD.id;
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_transactions_exclusions_insert
      AFTER INSERT ON transactions
      BEGIN
        INSERT OR IGNORE INTO transaction_pairing_exclusions (
          transaction_identifier, transaction_vendor, pairing_id, created_at, updated_at
        )
        SELECT NEW.identifier, NEW.vendor, ap.id, datetime('now'), datetime('now')
        FROM account_pairings ap
        WHERE ap.is_active = 1
          AND ap.bank_vendor = NEW.vendor
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = NEW.account_number)
          AND ap.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM json_each(COALESCE(ap.match_patterns, '[]'))
            WHERE LOWER(NEW.name) LIKE '%' || LOWER(json_each.value) || '%'
          );
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_transactions_exclusions_update
      AFTER UPDATE OF vendor, account_number, name ON transactions
      BEGIN
        DELETE FROM transaction_pairing_exclusions
          WHERE transaction_identifier = OLD.identifier AND transaction_vendor = OLD.vendor;
        INSERT OR IGNORE INTO transaction_pairing_exclusions (
          transaction_identifier, transaction_vendor, pairing_id, created_at, updated_at
        )
        SELECT NEW.identifier, NEW.vendor, ap.id, datetime('now'), datetime('now')
        FROM account_pairings ap
        WHERE ap.is_active = 1
          AND ap.bank_vendor = NEW.vendor
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = NEW.account_number)
          AND ap.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM json_each(COALESCE(ap.match_patterns, '[]'))
            WHERE LOWER(NEW.name) LIKE '%' || LOWER(json_each.value) || '%'
          );
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS transactions_fts_insert AFTER INSERT ON transactions
      BEGIN
        INSERT INTO transactions_fts(rowid, name, memo, vendor, merchant_name)
        VALUES (NEW.rowid, NEW.name, NEW.memo, NEW.vendor, NEW.merchant_name);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS transactions_fts_delete AFTER DELETE ON transactions
      BEGIN
        DELETE FROM transactions_fts WHERE rowid = OLD.rowid;
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS transactions_fts_update AFTER UPDATE ON transactions
      BEGIN
        DELETE FROM transactions_fts WHERE rowid = OLD.rowid;
        INSERT INTO transactions_fts(rowid, name, memo, vendor, merchant_name)
        VALUES (NEW.rowid, NEW.name, NEW.memo, NEW.vendor, NEW.merchant_name);
      END;
    `);

    const hasPairingExclusionsData = db.prepare(
      'SELECT 1 FROM transaction_pairing_exclusions LIMIT 1'
    ).get();
    if (!hasPairingExclusionsData) {
      db.exec(`
        INSERT OR IGNORE INTO transaction_pairing_exclusions (
          transaction_identifier, transaction_vendor, pairing_id, created_at, updated_at
        )
        SELECT t.identifier, t.vendor, ap.id, datetime('now'), datetime('now')
        FROM transactions t
        JOIN account_pairings ap
          ON t.vendor = ap.bank_vendor
          AND ap.is_active = 1
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
          AND ap.match_patterns IS NOT NULL
        WHERE EXISTS (
          SELECT 1 FROM json_each(COALESCE(ap.match_patterns, '[]'))
          WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
        );
      `);
    }
  } catch (_error) {
    // Ignore: tables may not exist yet (e.g., before init_sqlite_db runs).
  }

  // Fix orphaned triggers referencing smart_action_items_old
  try {
    const orphanedTriggers = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger'
      AND (sql LIKE '%smart_action_items_old%' OR tbl_name = 'smart_action_items_old')
    `).all();

    for (const trigger of orphanedTriggers) {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }

    const tableExists = db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'smart_action_items'
    `).get();

    if (tableExists) {
      createSmartActionTriggers(db);
    }
  } catch (_triggerError) {
    // Ignore: smart_action_items table may not exist yet
  }
}

function createSqlitePool(options = {}) {
  const dbPath =
    options.databasePath ||
    process.env.SQLITE_DB_PATH ||
    resolveDefaultSqlitePath();
  if (!fs.existsSync(dbPath)) {
    const resolvedPath = path.resolve(dbPath);
    throw new Error(
      `SQLite database not found at: ${resolvedPath}\n\n` +
      `To initialize the database, run:\n` +
      `  node scripts/init_sqlite_db.js\n\n` +
      `Or if you have a backup, copy it to: ${resolvedPath}`
    );
  }

  const Database = resolveDatabaseCtor(options.databaseCtor);
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Startup-critical schema objects must exist before the pool is exposed.
  runStartupSchemaMigrations(db);

  let isClosed = false;

  // Keep lower-priority maintenance off the critical path.
  setImmediate(() => {
    if (!isClosed) {
      runDeferredSchemaMaintenance(db);
    }
  });

  const prepareStatement = (sql, params) => {
    const indices = [];
    const convertedSql = sql.replace(PLACEHOLDER_REGEX, (_, index) => {
      const zeroBased = Number.parseInt(index, 10) - 1;
      indices.push(zeroBased);
      return '?';
    });

    if (indices.length > 0) {
      if (!Array.isArray(params)) {
        throw new RangeError('Positional parameters require an array of values');
      }
      const normalizedParams = indices.map((idx) => {
        if (idx < 0 || idx >= params.length) {
          throw new RangeError('Too few parameter values were provided');
        }
        return normalizeValue(params[idx]);
      });
      const stmt = db.prepare(convertedSql);
      return { stmt, convertedSql, normalizedParams };
    }

    const normalizedParams = normalizeParams(params);
    const stmt = db.prepare(convertedSql);
    return { stmt, convertedSql, normalizedParams };
  };

  const query = async (sql, params = []) => {
    const { stmt, convertedSql, normalizedParams } = prepareStatement(sql, params);
    const trimmed = convertedSql.trim();

    if (SELECT_LIKE_REGEX.test(trimmed) || RETURNING_REGEX.test(convertedSql)) {
      const rows = stmt.all(normalizedParams);
      return { rows, rowCount: rows.length };
    }

    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(trimmed)) {
      db.exec(convertedSql);
      return { rows: [], rowCount: 0 };
    }

    const info = stmt.run(normalizedParams);
    return { rows: [], rowCount: info.changes ?? 0 };
  };

  const connect = async () => ({
    query,
    release: () => {},
  });

  // Bulk mode state
  let bulkModeActive = false;

  /**
   * Enable bulk mode by disabling expensive triggers.
   * Call this before bulk insert operations to improve performance.
   * Remember to call exitBulkMode() after the operation to re-enable triggers
   * and rebuild any required data.
   */
  const enterBulkMode = () => {
    if (bulkModeActive) return;
    
    try {
      // Disable transaction exclusion triggers that scan account_pairings on each insert
      db.exec('DROP TRIGGER IF EXISTS trg_transactions_exclusions_insert');
      db.exec('DROP TRIGGER IF EXISTS trg_transactions_exclusions_update');
      
      // Disable FTS5 sync triggers for faster bulk inserts
      db.exec('DROP TRIGGER IF EXISTS transactions_fts_insert');
      db.exec('DROP TRIGGER IF EXISTS transactions_fts_update');
      
      bulkModeActive = true;
    } catch (_error) {
      // Ignore errors if triggers don't exist
    }
  };

  /**
   * Exit bulk mode by re-enabling triggers and rebuilding required data.
   * Call this after bulk insert operations complete.
   */
  const exitBulkMode = () => {
    if (!bulkModeActive) return;
    
    try {
      // Re-create transaction exclusion triggers
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_transactions_exclusions_insert
        AFTER INSERT ON transactions
        BEGIN
          INSERT OR IGNORE INTO transaction_pairing_exclusions (
            transaction_identifier,
            transaction_vendor,
            pairing_id,
            created_at,
            updated_at
          )
          SELECT
            NEW.identifier,
            NEW.vendor,
            ap.id,
            datetime('now'),
            datetime('now')
          FROM account_pairings ap
          WHERE ap.is_active = 1
            AND ap.bank_vendor = NEW.vendor
            AND (ap.bank_account_number IS NULL OR ap.bank_account_number = NEW.account_number)
            AND ap.match_patterns IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM json_each(COALESCE(ap.match_patterns, '[]'))
              WHERE LOWER(NEW.name) LIKE '%' || LOWER(json_each.value) || '%'
            )
          ;
        END;
      `);
      
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_transactions_exclusions_update
        AFTER UPDATE OF vendor, account_number, name ON transactions
        BEGIN
          DELETE FROM transaction_pairing_exclusions
            WHERE transaction_identifier = OLD.identifier
              AND transaction_vendor = OLD.vendor;
          INSERT OR IGNORE INTO transaction_pairing_exclusions (
            transaction_identifier,
            transaction_vendor,
            pairing_id,
            created_at,
            updated_at
          )
          SELECT
            NEW.identifier,
            NEW.vendor,
            ap.id,
            datetime('now'),
            datetime('now')
          FROM account_pairings ap
          WHERE ap.is_active = 1
            AND ap.bank_vendor = NEW.vendor
            AND (ap.bank_account_number IS NULL OR ap.bank_account_number = NEW.account_number)
            AND ap.match_patterns IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM json_each(COALESCE(ap.match_patterns, '[]'))
              WHERE LOWER(NEW.name) LIKE '%' || LOWER(json_each.value) || '%'
            )
          ;
        END;
      `);
      
      // Re-create FTS5 sync triggers
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS transactions_fts_insert AFTER INSERT ON transactions BEGIN
          INSERT INTO transactions_fts(rowid, name, memo, vendor, merchant_name)
          VALUES (NEW.rowid, NEW.name, NEW.memo, NEW.vendor, NEW.merchant_name);
        END;
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS transactions_fts_delete AFTER DELETE ON transactions BEGIN
          DELETE FROM transactions_fts
          WHERE rowid = OLD.rowid;
        END;
      `);
      
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS transactions_fts_update AFTER UPDATE ON transactions BEGIN
          DELETE FROM transactions_fts
          WHERE rowid = OLD.rowid;
          INSERT INTO transactions_fts(rowid, name, memo, vendor, merchant_name)
          VALUES (NEW.rowid, NEW.name, NEW.memo, NEW.vendor, NEW.merchant_name);
        END;
      `);
      
      bulkModeActive = false;
    } catch (_error) {
      // Ignore errors if triggers/tables don't exist
      bulkModeActive = false;
    }
  };

  /**
   * Rebuild FTS5 index after bulk operations.
   * This should be called after exitBulkMode() if FTS triggers were disabled.
   */
  const rebuildFtsIndex = () => {
    try {
      // Rebuild transactions FTS index
      db.exec('DELETE FROM transactions_fts');
      db.exec(`
        INSERT INTO transactions_fts(rowid, name, memo, vendor, merchant_name)
        SELECT rowid, name, memo, vendor, merchant_name FROM transactions
      `);
    } catch (_error) {
      // Ignore if FTS table doesn't exist
    }
  };

  /**
   * Rebuild pairing exclusions after bulk operations.
   * This should be called after exitBulkMode() to ensure all exclusions are populated.
   */
  const rebuildPairingExclusions = () => {
    try {
      db.exec(`
        INSERT OR IGNORE INTO transaction_pairing_exclusions (
          transaction_identifier,
          transaction_vendor,
          pairing_id,
          created_at,
          updated_at
        )
        SELECT
          t.identifier,
          t.vendor,
          ap.id,
          datetime('now'),
          datetime('now')
        FROM transactions t
        JOIN account_pairings ap
          ON t.vendor = ap.bank_vendor
          AND ap.is_active = 1
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
          AND ap.match_patterns IS NOT NULL
        WHERE EXISTS (
          SELECT 1
          FROM json_each(COALESCE(ap.match_patterns, '[]'))
          WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM transaction_pairing_exclusions tpe
          WHERE tpe.transaction_identifier = t.identifier
            AND tpe.transaction_vendor = t.vendor
            AND tpe.pairing_id = ap.id
        );
      `);
    } catch (_error) {
      // Ignore if tables don't exist
    }
  };

  /**
   * Check if bulk mode is currently active
   */
  const isBulkModeActive = () => bulkModeActive;

  return {
    query,
    connect,
    close: () => {
      isClosed = true;
      db.close();
    },
    _db: db,
    // Bulk mode functions for optimized insert operations
    enterBulkMode,
    exitBulkMode,
    rebuildFtsIndex,
    rebuildPairingExclusions,
    isBulkModeActive,
  };
}

module.exports = createSqlitePool;
module.exports.default = createSqlitePool;
