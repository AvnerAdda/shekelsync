const path = require('path');
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

function createSqlitePool(options = {}) {
  const dbPath =
    options.databasePath ||
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
  } catch (_error) {
    // Ignore: table may not exist yet (e.g., before init_sqlite_db runs).
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
