const database = require('../database.js');

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toNumber(value, fallback, { min, allowZero } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  if (!allowZero && parsed <= 0) return fallback;
  if (min !== undefined && parsed < min) return min;
  return parsed;
}

function mapTransactionRow(row) {
  return {
    identifier: row.identifier,
    vendor: row.vendor,
    name: row.name,
    date: row.date,
    price: row.price !== undefined && row.price !== null ? Number.parseFloat(row.price) : null,
    accountNumber: row.account_number,
    categoryDefinitionId: row.category_definition_id,
    categoryType: row.category_type,
    autoCategorized: row.auto_categorized,
    confidenceScore: row.confidence_score,
    categoryName: row.category_name,
    categoryNameEn: row.category_name_en,
  };
}

async function listCategoryTransactions(params = {}) {
  const categoryId =
    params.categoryId ||
    params.category_id ||
    params.category_definition_id;

  if (!categoryId) {
    throw serviceError(400, 'categoryId is required');
  }

  const resolvedCategoryId = Number.parseInt(categoryId, 10);
  if (Number.isNaN(resolvedCategoryId)) {
    throw serviceError(400, 'categoryId must be a valid number');
  }

  const limit = toNumber(params.limit, 100, { min: 1 });
  const offset = toNumber(params.offset, 0, { min: 0, allowZero: true });

  const transactionsQuery = `
    SELECT
      t.identifier,
      t.vendor,
      t.name,
      t.date,
      t.price,
      t.account_number,
      t.category_definition_id,
      t.category_type,
      t.auto_categorized,
      t.confidence_score,
      cd.name AS category_name,
      cd.name_en AS category_name_en
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE t.category_definition_id = $1
    ORDER BY t.date DESC
    LIMIT $2 OFFSET $3
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM transactions
    WHERE category_definition_id = $1
  `;

  const [transactionsResult, countResult] = await Promise.all([
    database.query(transactionsQuery, [resolvedCategoryId, limit, offset]),
    database.query(countQuery, [resolvedCategoryId]),
  ]);

  const totalCount = Number.parseInt(countResult.rows[0]?.total || 0, 10);

  return {
    transactions: transactionsResult.rows.map(mapTransactionRow),
    totalCount,
    limit,
    offset,
  };
}

module.exports = {
  listCategoryTransactions,
};

module.exports.default = module.exports;
