const path = require('path');
const resolveBetterSqlite = require('./better-sqlite3-wrapper.js');
const {
  isSqlCipherEnabled,
  resolveSqlCipherKey,
  applySqlCipherKey,
  verifySqlCipherKey,
} = require('./sqlcipher-utils.js');

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

function createSqlitePool(options = {}) {
  const useSqlCipher = isSqlCipherEnabled();
  const dbPath =
    options.databasePath ||
    (useSqlCipher ? process.env.SQLCIPHER_DB_PATH : null) ||
    process.env.SQLITE_DB_PATH ||
    process.env.SQLCIPHER_DB_PATH ||
    path.join(process.cwd(), 'dist', 'clarify.sqlite');

  const fs = require('fs');
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
  if (useSqlCipher) {
    const keyInfo = resolveSqlCipherKey({ requireKey: true });
    applySqlCipherKey(db, keyInfo);
    verifySqlCipherKey(db);
  }
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Lightweight schema fixes for older DBs.
  // Keep this minimal and idempotent: only additive, safe ALTER TABLE statements.
  try {
    const pairingColumns = db.prepare("PRAGMA table_info('account_pairings')").all();
    if (Array.isArray(pairingColumns) && pairingColumns.length > 0) {
      const hasDiscrepancyAck = pairingColumns.some((col) => col && col.name === 'discrepancy_acknowledged');
      if (!hasDiscrepancyAck) {
        db.exec('ALTER TABLE account_pairings ADD COLUMN discrepancy_acknowledged INTEGER DEFAULT 0');
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

    db.exec('DROP TRIGGER IF EXISTS trg_account_pairings_exclusions_insert');
    db.exec('DROP TRIGGER IF EXISTS trg_account_pairings_exclusions_update');
    db.exec('DROP TRIGGER IF EXISTS trg_account_pairings_exclusions_delete');
    db.exec('DROP TRIGGER IF EXISTS trg_transactions_exclusions_insert');
    db.exec('DROP TRIGGER IF EXISTS trg_transactions_exclusions_update');

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_account_pairings_exclusions_insert
      AFTER INSERT ON account_pairings
      BEGIN
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
          NEW.id,
          datetime('now'),
          datetime('now')
        FROM transactions t
        WHERE NEW.is_active = 1
          AND t.vendor = NEW.bank_vendor
          AND (NEW.bank_account_number IS NULL OR t.account_number = NEW.bank_account_number)
          AND NEW.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM json_each(COALESCE(NEW.match_patterns, '[]'))
            WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
          );
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_account_pairings_exclusions_update
      AFTER UPDATE OF is_active, bank_vendor, bank_account_number, match_patterns ON account_pairings
      BEGIN
        DELETE FROM transaction_pairing_exclusions
          WHERE pairing_id = OLD.id;
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
          NEW.id,
          datetime('now'),
          datetime('now')
        FROM transactions t
        WHERE NEW.is_active = 1
          AND t.vendor = NEW.bank_vendor
          AND (NEW.bank_account_number IS NULL OR t.account_number = NEW.bank_account_number)
          AND NEW.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM json_each(COALESCE(NEW.match_patterns, '[]'))
            WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
          );
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_account_pairings_exclusions_delete
      AFTER DELETE ON account_pairings
      BEGIN
        DELETE FROM transaction_pairing_exclusions
          WHERE pairing_id = OLD.id;
      END;
    `);
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

    const hasPairingExclusionsData = db.prepare(
      'SELECT 1 FROM transaction_pairing_exclusions LIMIT 1'
    ).get();
    if (!hasPairingExclusionsData) {
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
        );
      `);
    }
  } catch (_error) {
    // Ignore: table may not exist yet (e.g., before init_sqlite_db runs).
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

  // Fix orphaned triggers referencing smart_action_items_old
  // This can happen if a migration renamed the table but didn't properly cleanup triggers
  try {
    // Check for any triggers referencing the old table name
    const orphanedTriggers = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger'
      AND (sql LIKE '%smart_action_items_old%' OR tbl_name = 'smart_action_items_old')
    `).all();

    for (const trigger of orphanedTriggers) {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }

    // Ensure proper triggers exist on smart_action_items table
    const tableExists = db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'smart_action_items'
    `).get();

    if (tableExists) {
      // Drop and recreate triggers to ensure they reference the correct table
      db.exec('DROP TRIGGER IF EXISTS update_smart_action_items_timestamp');
      db.exec('DROP TRIGGER IF EXISTS log_smart_action_item_status_change');

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS update_smart_action_items_timestamp
        AFTER UPDATE ON smart_action_items
        BEGIN
          UPDATE smart_action_items
          SET updated_at = datetime('now')
          WHERE id = NEW.id;
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
  } catch (_triggerError) {
    // Ignore: smart_action_items table may not exist yet
  }

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

  return {
    query,
    connect,
    close: () => db.close(),
    _db: db,
  };
}

module.exports = createSqlitePool;
module.exports.default = createSqlitePool;
