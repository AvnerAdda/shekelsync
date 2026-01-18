const database = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const { resolveLocale, getLocalizedCategoryName } = require('../../../lib/server/locale-utils.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

const categoryDetailsCache = createTtlCache({ maxEntries: 50, defaultTtlMs: 30 * 1000 });

function buildCategoryFilter({ category, parentId, subcategoryId }) {
  if (subcategoryId) {
    return {
      clause: 't.category_definition_id = $1',
      params: [subcategoryId],
    };
  }

  if (parentId) {
    return {
      clause: `t.category_definition_id IN (
        WITH RECURSIVE category_tree AS (
          SELECT id FROM category_definitions WHERE id = $1
          UNION ALL
          SELECT cd.id FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.id
        )
        SELECT id FROM category_tree
      )`,
      params: [parentId],
    };
  }

  return {
    clause: `t.category_definition_id IN (
      WITH RECURSIVE category_tree AS (
        SELECT id FROM category_definitions
        WHERE LOWER(name) = LOWER($1) OR LOWER(name_en) = LOWER($1) OR LOWER(name_fr) = LOWER($1)
        UNION ALL
        SELECT cd.id FROM category_definitions cd
        JOIN category_tree ct ON cd.parent_id = ct.id
      )
      SELECT id FROM category_tree
    )`,
    params: [category],
  };
}

function buildPriceFilter(type) {
  if (type === 'income') {
    return {
      clause: 't.price > 0',
      amountExpression: 't.price',
    };
  }

  if (type === 'investment') {
    return {
      clause: '',
      amountExpression: 'ABS(t.price)',
    };
  }

  return {
    clause: 't.price < 0',
    amountExpression: 'ABS(t.price)',
  };
}

const PAIRING_EXCLUSION = `
  LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
    ON t.identifier = tpe.transaction_identifier
    AND t.vendor = tpe.transaction_vendor
`;

async function getCategoryDetails(params = {}) {
  const {
    category,
    parentId,
    subcategoryId,
    startDate,
    endDate,
    type = 'expense',
    locale: localeInput,
  } = params;
  const locale = resolveLocale(localeInput);

  if (!category && !parentId && !subcategoryId) {
    const error = new Error('Category identifier is required');
    error.status = 400;
    throw error;
  }

  const { clause: categoryFilter, params: categoryParams } = buildCategoryFilter({
    category,
    parentId,
    subcategoryId,
  });

  const { clause: priceFilter, amountExpression } = buildPriceFilter(type);
  const priceFilterClause = priceFilter ? `AND ${priceFilter}` : '';

  const start = startDate ? new Date(startDate) : new Date(0);
  const end = endDate ? new Date(endDate) : new Date();
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    params.noCache === true ||
    params.noCache === 'true' ||
    params.noCache === '1';
  const cacheKey = JSON.stringify({
    category: category || null,
    parentId: parentId ?? null,
    subcategoryId: subcategoryId ?? null,
    type,
    start: start.toISOString(),
    end: end.toISOString(),
    locale,
  });
  if (!skipCache) {
    const cached = categoryDetailsCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const boundParams = [...categoryParams, start, end];
  const dateStartIdx = categoryParams.length + 1;
  const dateEndIdx = categoryParams.length + 2;

  const client = await database.getClient();

  try {
    const summaryPromise = client.query(
      `
        SELECT
          COUNT(*) AS count,
          SUM(${amountExpression}) AS total,
          AVG(${amountExpression}) AS average,
          MIN(${amountExpression}) AS min_amount,
          MAX(${amountExpression}) AS max_amount
        FROM transactions t
        ${PAIRING_EXCLUSION}
        WHERE ${categoryFilter}
          ${priceFilterClause}
          AND t.date >= $${dateStartIdx}
          AND t.date <= $${dateEndIdx}
  AND tpe.transaction_identifier IS NULL
      `,
      boundParams,
    );

    const vendorsPromise = client.query(
      `
        SELECT
          t.vendor,
          COUNT(*) AS count,
          SUM(${amountExpression}) AS total
        FROM transactions t
        ${PAIRING_EXCLUSION}
        WHERE ${categoryFilter}
          ${priceFilterClause}
          AND t.date >= $${dateStartIdx}
          AND t.date <= $${dateEndIdx}
          AND tpe.transaction_identifier IS NULL
        GROUP BY t.vendor
        ORDER BY total DESC
      `,
      boundParams,
    );

    const cardsPromise = client.query(
      `
        SELECT
          t.account_number,
          t.vendor,
          COUNT(*) AS count,
          SUM(${amountExpression}) AS total
        FROM transactions t
        ${PAIRING_EXCLUSION}
        WHERE ${categoryFilter}
          ${priceFilterClause}
          AND t.date >= $${dateStartIdx}
          AND t.date <= $${dateEndIdx}
          AND t.account_number IS NOT NULL
          AND tpe.transaction_identifier IS NULL
        GROUP BY t.account_number, t.vendor
        ORDER BY total DESC
      `,
      boundParams,
    );

    let subcategoriesPromise = Promise.resolve({ rows: [] });
    if (parentId) {
      subcategoriesPromise = client.query(
        `
          SELECT
            cd.id,
            cd.name,
            cd.name_en,
            cd.name_fr,
            cd.color,
            cd.icon,
            cd.description,
            COUNT(t.identifier) AS count,
            SUM(${amountExpression}) AS total
          FROM transactions t
          JOIN category_definitions cd ON t.category_definition_id = cd.id
          ${PAIRING_EXCLUSION}
          WHERE cd.parent_id = $1
            ${priceFilterClause}
            AND t.date >= $2
            AND t.date <= $3
            AND tpe.transaction_identifier IS NULL
          GROUP BY cd.id, cd.name, cd.name_en, cd.name_fr, cd.color, cd.icon, cd.description
          ORDER BY total DESC
        `,
        [parentId, start, end],
      );
    }

    const transactionsPromise = client.query(
      `
        SELECT
          t.date,
          t.name,
          t.price,
          t.processed_date,
          t.vendor,
          t.account_number,
          cd.id AS category_definition_id,
          cd.name AS category_name,
          cd.name_en AS category_name_en,
          cd.name_fr AS category_name_fr,
          parent.name AS parent_name,
          parent.name_en AS parent_name_en,
          parent.name_fr AS parent_name_fr
        FROM transactions t
        JOIN category_definitions cd ON t.category_definition_id = cd.id
        LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
        ${PAIRING_EXCLUSION}
        WHERE ${categoryFilter}
          ${priceFilterClause}
          AND t.date >= $${dateStartIdx}
          AND t.date <= $${dateEndIdx}
          AND tpe.transaction_identifier IS NULL
        ORDER BY t.date DESC
        LIMIT 20
      `,
      boundParams,
    );

    const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
    const trendPromise = client.query(
      `
        SELECT
          ${monthExpr} AS month,
          SUM(${amountExpression}) AS total,
          COUNT(*) AS count
        FROM transactions t
        ${PAIRING_EXCLUSION}
        WHERE ${categoryFilter}
          ${priceFilterClause}
          AND t.date >= $${dateStartIdx}
          AND t.date <= $${dateEndIdx}
          AND tpe.transaction_identifier IS NULL
        GROUP BY ${monthExpr}
        ORDER BY month ASC
      `,
      boundParams,
    );

    const [summaryResult, vendorsResult, cardsResult, subcategoriesResult, transactionsResult, trendResult] =
      await Promise.all([
        summaryPromise,
        vendorsPromise,
        cardsPromise,
        subcategoriesPromise,
        transactionsPromise,
        trendPromise,
      ]);

    const summary = summaryResult.rows[0] || {};

    const response = {
      category: category || null,
      parentId: parentId || null,
      subcategoryId: subcategoryId || null,
      summary: {
        count: Number.parseInt(summary.count || 0, 10),
        total: Number.parseFloat(summary.total || 0),
        average: Number.parseFloat(summary.average || 0),
        minAmount: Number.parseFloat(summary.min_amount || 0),
        maxAmount: Number.parseFloat(summary.max_amount || 0),
      },
      subcategories: (subcategoriesResult.rows || []).map((row) => ({
        id: row.id,
        name: getLocalizedCategoryName({
          name: row.name,
          name_en: row.name_en,
          name_fr: row.name_fr,
        }, locale) || row.name,
        count: Number.parseInt(row.count, 10),
        total: Number.parseFloat(row.total),
      })),
      byVendor: vendorsResult.rows.map((row) => ({
        vendor: row.vendor,
        count: Number.parseInt(row.count, 10),
        total: Number.parseFloat(row.total),
      })),
      byCard: cardsResult.rows.map((row) => ({
        accountNumber: row.account_number,
        vendor: row.vendor,
        count: Number.parseInt(row.count, 10),
        total: Number.parseFloat(row.total),
      })),
      transactions: transactionsResult.rows.map((row) => ({
        date: row.date,
        name: row.name,
        price: Number.parseFloat(row.price),
        processedDate: row.processed_date,
        vendor: row.vendor,
        categoryDefinitionId: row.category_definition_id,
        categoryName: getLocalizedCategoryName({
          name: row.category_name,
          name_en: row.category_name_en,
          name_fr: row.category_name_fr,
        }, locale) || row.category_name,
        parentName: getLocalizedCategoryName({
          name: row.parent_name,
          name_en: row.parent_name_en,
          name_fr: row.parent_name_fr,
        }, locale) || row.parent_name,
        accountNumber: row.account_number,
      })),
      trend: trendResult.rows.map((row) => ({
        month: row.month,
        total: Number.parseFloat(row.total),
        count: Number.parseInt(row.count, 10),
      })),
    };

    if (!skipCache) {
      categoryDetailsCache.set(cacheKey, response);
    }
    return response;
  } finally {
    client.release();
  }
}

module.exports = {
  getCategoryDetails,
};

module.exports.default = module.exports;
