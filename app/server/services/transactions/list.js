const actualDatabase = require('../database.js');
const { dialect, useSqlite } = require('../../../lib/sql-dialect.js');

let database = actualDatabase;
function __setDatabase(mock) {
  database = mock || actualDatabase;
}
function __resetDatabase() {
  database = actualDatabase;
}

/**
 * Build search condition using FTS5 when available, fallback to LIKE for PostgreSQL
 * @param {string} searchTerm - The search term
 * @param {number} paramIndex - The parameter index for placeholder
 * @returns {{ condition: string, value: string }} The SQL condition and value
 */
function buildSearchCondition(searchTerm, paramIndex) {
  const placeholder = `$${paramIndex}`;

  if (useSqlite) {
    // Use FTS5 for SQLite with LIKE fallback for all text fields
    // This ensures search works even if FTS index is out of sync
    const ftsQuery = dialect.prepareFtsQuery(searchTerm);
    return {
      condition: `(
        t.rowid IN (SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ${placeholder})
        OR ${dialect.likeInsensitive('t.name', placeholder)}
        OR ${dialect.likeInsensitive('t.memo', placeholder)}
        OR ${dialect.likeInsensitive('t.vendor', placeholder)}
        OR ${dialect.likeInsensitive('t.merchant_name', placeholder)}
        OR ${dialect.likeInsensitive('cd.name', placeholder)}
        OR ${dialect.likeInsensitive('parent.name', placeholder)}
      )`,
      value: ftsQuery || `%${searchTerm}%`,
      useFts: Boolean(ftsQuery),
    };
  }

  // PostgreSQL fallback: use ILIKE
  return {
    condition: `(
      t.memo ILIKE '%' || ${placeholder} || '%'
      OR t.name ILIKE '%' || ${placeholder} || '%'
      OR t.vendor ILIKE '%' || ${placeholder} || '%'
      OR t.merchant_name ILIKE '%' || ${placeholder} || '%'
      OR cd.name ILIKE '%' || ${placeholder} || '%'
      OR parent.name ILIKE '%' || ${placeholder} || '%'
    )`,
    value: searchTerm,
    useFts: false,
  };
}

function toInteger(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    const error = new Error(`Invalid ${fieldName} parameter`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

async function listRecentTransactions(params = {}) {
  const limit = toInteger(params.limit, 50, 'limit');
  const offset = toInteger(params.offset, 0, 'offset');

  const result = await database.query(
    `
      SELECT
        t.identifier,
        t.vendor,
        cd.name AS category,
        parent.name AS parent_category,
        t.memo,
        t.tags,
        t.price,
        t.date,
        t.processed_date,
        t.account_number,
        t.type,
        t.status
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE ${dialect.excludePikadon('t')}
      ORDER BY t.date DESC, t.processed_date DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );

  const transactions = result.rows.map((row) => ({
    ...row,
    price: parseFloat(row.price) || 0,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }));

  return {
    transactions,
    count: transactions.length,
    hasMore: transactions.length === limit,
  };
}

async function searchTransactions(params = {}) {
  const {
    query: searchQuery,
    category,
    vendor,
    startDate,
    endDate,
    limit = 100,
  } = params;

  const maxRows = toInteger(limit, 100, 'limit');
  const conditions = [];
  const values = [];

  if (searchQuery) {
    const searchResult = buildSearchCondition(searchQuery, values.length + 1);

    if (useSqlite && searchResult.useFts) {
      // For FTS5, we need the prepared FTS query for MATCH and original term for LIKE
      // Also add LIKE fallback for transaction fields in case FTS index is out of sync
      values.push(searchResult.value); // FTS query
      values.push(`%${searchQuery}%`); // Original for LIKE fallback
      const ftsParam = `$${values.length - 1}`;
      const likeParam = `$${values.length}`;
      conditions.push(`(
        t.rowid IN (SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ${ftsParam})
        OR ${dialect.likeInsensitive('t.name', likeParam)}
        OR ${dialect.likeInsensitive('t.memo', likeParam)}
        OR ${dialect.likeInsensitive('t.tags', likeParam)}
        OR ${dialect.likeInsensitive('t.vendor', likeParam)}
        OR ${dialect.likeInsensitive('t.merchant_name', likeParam)}
        OR ${dialect.likeInsensitive('cd.name', likeParam)}
        OR ${dialect.likeInsensitive('parent.name', likeParam)}
      )`);
    } else {
      // Fallback to LIKE for PostgreSQL or when FTS query is empty
      values.push(`%${searchQuery}%`);
      const queryParam = `$${values.length}`;
      conditions.push(`(${dialect.likeInsensitive('t.memo', queryParam)}
        OR ${dialect.likeInsensitive('t.name', queryParam)}
        OR ${dialect.likeInsensitive('t.tags', queryParam)}
        OR ${dialect.likeInsensitive('t.vendor', queryParam)}
        OR ${dialect.likeInsensitive('t.merchant_name', queryParam)}
        OR ${dialect.likeInsensitive('cd.name', queryParam)}
        OR ${dialect.likeInsensitive('parent.name', queryParam)})`);
    }
  }

  if (category) {
    const parsedCategoryId = Number.parseInt(category, 10);
    if (Number.isNaN(parsedCategoryId)) {
      values.push(category);
      conditions.push(`(cd.name = $${values.length} OR parent.name = $${values.length})`);
    } else {
      values.push(parsedCategoryId);
      conditions.push(`t.category_definition_id = $${values.length}`);
    }
  }

  if (vendor) {
    values.push(vendor);
    conditions.push(`t.vendor = $${values.length}`);
  }

  if (startDate) {
    values.push(startDate);
    conditions.push(`t.date >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    conditions.push(`t.date <= $${values.length}`);
  }

  // Always exclude pikadon transactions from search results
  conditions.push(dialect.excludePikadon('t'));

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(maxRows);
  const limitParam = values.length;

  const result = await database.query(
    `
      SELECT
        t.identifier,
        t.vendor,
        t.name,
        cd.name AS category,
        parent.name AS parent_category,
        t.category_definition_id,
        t.category_type,
        t.memo,
        t.tags,
        t.price,
        t.date,
        t.processed_date,
        t.account_number,
        t.type,
        t.status
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      ${whereClause}
      ORDER BY t.date DESC, t.processed_date DESC
      LIMIT $${limitParam}
    `,
    values,
  );

  const transactions = result.rows.map((row) => ({
    ...row,
    price: parseFloat(row.price) || 0,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }));

  return {
    transactions,
    count: transactions.length,
    searchQuery,
    filters: { category, vendor, startDate, endDate },
  };
}

async function getAllTags() {
  const result = await database.query(
    `
      SELECT DISTINCT tags
      FROM transactions
      WHERE tags IS NOT NULL AND tags != '' AND tags != '[]'
    `,
    [],
  );

  // Parse and dedupe all tags across transactions
  const tagSet = new Set();
  result.rows.forEach((row) => {
    try {
      const tags = JSON.parse(row.tags);
      if (Array.isArray(tags)) {
        tags.forEach((tag) => tagSet.add(tag));
      }
    } catch {
      // Skip invalid JSON
    }
  });

  return Array.from(tagSet).sort();
}

module.exports = {
  listRecentTransactions,
  searchTransactions,
  getAllTags,
  __setDatabase,
  __resetDatabase,
};
