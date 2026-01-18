const database = require('../database.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

const transactionsByDateCache = createTtlCache({ maxEntries: 60, defaultTtlMs: 30 * 1000 });

const PAIRING_EXCLUSION = `
  LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
    ON t.identifier = tpe.transaction_identifier
    AND t.vendor = tpe.transaction_vendor
`;

async function listTransactionsByDate(params = {}) {
  const { date } = params;

  if (!date) {
    const error = new Error('Date parameter is required');
    error.status = 400;
    throw error;
  }
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    params.noCache === true ||
    params.noCache === 'true' ||
    params.noCache === '1';
  const cacheKey = `date:${date}`;
  if (!skipCache) {
    const cached = transactionsByDateCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const result = await database.query(
    `
      SELECT
        t.identifier,
        t.vendor,
        t.price,
        t.name AS description,
        t.date,
        cd_child.name AS category,
        cd_parent.name AS parent_category,
        cd_parent.category_type
      FROM transactions t
      LEFT JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      LEFT JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      ${PAIRING_EXCLUSION}
      WHERE DATE(t.date) = DATE($1)
        AND tpe.transaction_identifier IS NULL
      ORDER BY t.price DESC
    `,
    [date],
  );

  const transactions = result.rows.map((row) => ({
    identifier: row.identifier,
    vendor: row.vendor,
    price: Number.parseFloat(row.price),
    description: row.description,
    date: row.date,
    category: row.category,
    parentCategory: row.parent_category,
    categoryType: row.category_type,
    category_name: row.category,
    parent_name: row.parent_category,
  }));

  const response = { transactions };
  if (!skipCache) {
    transactionsByDateCache.set(cacheKey, response);
  }
  return response;
}

module.exports = {
  listTransactionsByDate,
};

module.exports.default = module.exports;
