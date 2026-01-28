const dbMode = (process.env.CLARIFY_DB_MODE || '').toLowerCase();
const explicitSqlite =
  process.env.USE_SQLITE === 'true' ||
  Boolean(process.env.SQLITE_DB_PATH) ||
  dbMode === 'sqlite';
const explicitPostgres = process.env.USE_SQLITE === 'false' || dbMode === 'postgres';

const useSqlite = explicitPostgres ? false : explicitSqlite || !process.env.DATABASE_URL;

const dialect = {
  useSqlite,

  dateTrunc(unit, column) {
    if (!useSqlite) {
      return `DATE_TRUNC('${unit}', ${column})`;
    }
    const map = {
      day: `date(${column})`,
      week: `date(${column}, 'weekday 0', '-6 days')`,
      month: `date(${column}, 'start of month')`,
      year: `date(${column}, 'start of year')`,
    };
    return map[unit] || `date(${column})`;
  },

  toChar(column, format) {
    if (!useSqlite) {
      return `TO_CHAR(${column}, '${format}')`;
    }
    let converted = format;
    converted = converted.replace(/YYYY/g, '%Y');
    converted = converted.replace(/YY/g, '%y');
    converted = converted.replace(/MM/g, '%m');
    converted = converted.replace(/DD/g, '%d');
    converted = converted.replace(/HH24/g, '%H');
    converted = converted.replace(/MI/g, '%M');
    converted = converted.replace(/SS/g, '%S');
    converted = converted.replace(/Mon/g, '%b');
    converted = converted.replace(/WW/g, '%W');
    return `strftime('${converted}', ${column})`;
  },

  extract(part, column) {
    if (!useSqlite) {
      return `EXTRACT(${part.toUpperCase()} FROM ${column})`;
    }
    const lower = part.toLowerCase();
    if (lower === 'dow') {
      return `CAST(strftime('%w', ${column}) AS INTEGER)`;
    }
    if (lower === 'hour') {
      return `CAST(strftime('%H', ${column}) AS INTEGER)`;
    }
    if (lower === 'day') {
      return `CAST(strftime('%d', ${column}) AS INTEGER)`;
    }
    if (lower === 'month') {
      return `CAST(strftime('%m', ${column}) AS INTEGER)`;
    }
    if (lower === 'year') {
      return `CAST(strftime('%Y', ${column}) AS INTEGER)`;
    }
    return `CAST(strftime('%${lower[0]}', ${column}) AS INTEGER)`;
  },

  castNumeric(column) {
    if (!useSqlite) {
      return `${column}::numeric`;
    }
    return `CAST(${column} AS REAL)`;
  },

  likeInsensitive(column, placeholder) {
    return `LOWER(${column}) LIKE LOWER(${placeholder})`;
  },

  /**
   * SQL clause to exclude pikadon-related transactions
   * Use in WHERE clauses: `WHERE ... AND ${dialect.excludePikadon('t')}`
   * @param {string} tableAlias - The alias for the transactions table (e.g., 't')
   */
  excludePikadon(tableAlias = 't') {
    return `(${tableAlias}.is_pikadon_related IS NULL OR ${tableAlias}.is_pikadon_related = 0)`;
  },

  /**
   * Full-text search using FTS5 for transactions.
   * Falls back to LIKE for PostgreSQL or when FTS5 is not available.
   * @param {string} tableAlias - The alias for the transactions table (e.g., 't')
   * @param {string} placeholder - The placeholder for the search term (e.g., '$1')
   * @param {string[]} columns - Optional array of columns to search (default: all text columns)
   * @returns {string} SQL condition for full-text search
   */
  ftsSearch(tableAlias, placeholder, columns = ['name', 'memo', 'vendor', 'merchant_name']) {
    if (!useSqlite) {
      // PostgreSQL fallback: use ILIKE on each column
      const conditions = columns.map(
        (col) => `${tableAlias}.${col} ILIKE '%' || ${placeholder} || '%'`
      );
      return `(${conditions.join(' OR ')})`;
    }
    // SQLite FTS5: use MATCH with transactions_fts virtual table
    // The query must be transformed to FTS5 syntax (escape special chars, add *)
    return `${tableAlias}.rowid IN (
      SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ${placeholder}
    )`;
  },

  /**
   * Check if a transaction name matches a pattern (for categorization rules).
   * Uses FTS5 when available on SQLite, falls back to LIKE otherwise.
   * @param {string} nameColumn - The column containing the transaction name
   * @param {string} patternColumn - The column containing the pattern to match
   * @returns {string} SQL condition for pattern matching
   */
  patternMatch(nameColumn, patternColumn) {
    // For pattern matching, we need to use LIKE because patterns are substrings
    // FTS5 is better for word-based search, LIKE is better for substring matching
    return `LOWER(${nameColumn}) LIKE '%' || LOWER(${patternColumn}) || '%'`;
  },

  /**
   * Transform a search query for FTS5 usage.
   * Escapes special characters and adds prefix matching.
   * @param {string} query - The raw search query
   * @returns {string} FTS5-compatible search query
   */
  prepareFtsQuery(query) {
    if (!query || typeof query !== 'string') return '';
    // Escape FTS5 special characters: " * ( ) -
    let escaped = query.trim();
    // Remove special FTS5 operators for safety
    escaped = escaped.replace(/["\*\(\)\-\+\:]/g, ' ');
    // Split into words and add prefix matching
    const words = escaped.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return '';
    // Use prefix matching for partial word matches
    return words.map((w) => `"${w}"*`).join(' ');
  },
};

module.exports = { dialect, useSqlite };
module.exports.default = { dialect, useSqlite };
