const actualDatabase = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');

let database = actualDatabase;
function __setDatabase(mock) {
  database = mock || actualDatabase;
}
function __resetDatabase() {
  database = actualDatabase;
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
        identifier,
        vendor,
        category,
        parent_category,
        memo,
        price,
        date,
        processed_date,
        account_number,
        type,
        status
      FROM transactions t
      WHERE ${dialect.excludePikadon('t')}
      ORDER BY t.date DESC, t.processed_date DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );

  const transactions = result.rows.map((row) => ({
    ...row,
    price: parseFloat(row.price) || 0,
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
    values.push(`%${searchQuery}%`);
    conditions.push(`memo ILIKE $${values.length}`);
  }

  if (category) {
    values.push(category);
    conditions.push(`category = $${values.length}`);
  }

  if (vendor) {
    values.push(vendor);
    conditions.push(`vendor = $${values.length}`);
  }

  if (startDate) {
    values.push(startDate);
    conditions.push(`date >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    conditions.push(`date <= $${values.length}`);
  }

  // Always exclude pikadon transactions from search results
  conditions.push(dialect.excludePikadon());

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(maxRows);
  const limitParam = values.length;

  const result = await database.query(
    `
      SELECT
        identifier,
        vendor,
        category,
        parent_category,
        memo,
        price,
        date,
        processed_date,
        account_number,
        type,
        status
      FROM transactions
      ${whereClause}
      ORDER BY date DESC, processed_date DESC
      LIMIT $${limitParam}
    `,
    values,
  );

  const transactions = result.rows.map((row) => ({
    ...row,
    price: parseFloat(row.price) || 0,
  }));

  return {
    transactions,
    count: transactions.length,
    searchQuery,
    filters: { category, vendor, startDate, endDate },
  };
}

module.exports = {
  listRecentTransactions,
  searchTransactions,
  __setDatabase,
  __resetDatabase,
};
