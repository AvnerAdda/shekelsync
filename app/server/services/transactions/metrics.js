const actualDatabase = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');

// Helper to exclude pikadon transactions from analytics
const EXCLUDE_PIKADON = dialect.excludePikadon('t');

let database = actualDatabase;
function __setDatabase(mock) {
  database = mock || actualDatabase;
}
function __resetDatabase() {
  database = actualDatabase;
}

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function parseInteger(value, fieldName) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw serviceError(400, `Invalid ${fieldName} parameter`);
  }
  return parsed;
}

async function listAvailableMonths() {
  const monthExpr = dialect.toChar('t.date', 'YYYY-MM');

  const result = await database.query(
    `
      SELECT DISTINCT ${monthExpr} AS month_value
      FROM transactions t
      WHERE t.date IS NOT NULL
      ORDER BY month_value DESC
    `,
  );

  return result.rows
    .map((row) => row.month_value)
    .filter((month) => month !== null && month !== undefined);
}

async function getBoxPanelData() {
  const monthExpr = dialect.toChar('t.date', 'DD-MM-YYYY');

  const [categoriesResult, nonMappedResult, totalResult, lastMonthResult] = await Promise.all([
    database.query('SELECT COUNT(DISTINCT category) AS count FROM transactions'),
    database.query("SELECT COUNT(*) AS count FROM transactions WHERE category IS NULL OR category = 'N/A'"),
    database.query('SELECT COUNT(*) AS count FROM transactions'),
    database.query(
      `
        SELECT ${monthExpr} AS formatted_date
        FROM transactions t
        WHERE t.date IS NOT NULL
        ORDER BY t.date DESC
        LIMIT 1
      `,
    ),
  ]);

  const categories = Number.parseInt(categoriesResult.rows[0]?.count || 0, 10) || 0;
  const nonMapped = Number.parseInt(nonMappedResult.rows[0]?.count || 0, 10) || 0;
  const allTransactions = Number.parseInt(totalResult.rows[0]?.count || 0, 10) || 0;
  const lastMonth = lastMonthResult.rows[0]?.formatted_date || null;

  return {
    categories,
    nonMapped,
    allTransactions,
    lastMonth,
  };
}

async function getCategoryExpenses(params = {}) {
  const { month, categoryId: rawCategoryId, all } = params;

  if (!month) {
    throw serviceError(400, 'Month parameter is required');
  }

  if (!rawCategoryId && normalizeBoolean(all) !== true) {
    throw serviceError(400, 'Either categoryId must be provided or all=true');
  }

  let categoryId;
  if (rawCategoryId !== undefined) {
    categoryId = parseInteger(rawCategoryId, 'categoryId');
  }

  const monthExpr = dialect.toChar('t.date', 'YYYY-MM');

  if (normalizeBoolean(all) === true) {
    const parameters = [];
    const whereClauses = [];

    if (month !== 'all') {
      parameters.push(month);
      whereClauses.push(`${monthExpr} = $${parameters.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const result = await database.query(
      `
        SELECT
          t.name,
          t.price,
          t.date,
          t.identifier,
          t.vendor,
          t.account_number,
          t.category_definition_id,
          cd.name AS category_name,
          cd.name_en AS category_name_en,
          cd.category_type,
          parent.id AS parent_category_definition_id,
          parent.name AS parent_category_name,
          parent.name_en AS parent_category_name_en
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
        LEFT JOIN account_pairings ap ON (
          t.vendor = ap.bank_vendor
          AND ap.is_active = 1
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
          AND ap.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM json_each(ap.match_patterns)
            WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
          )
        )
        ${whereSql ? `${whereSql} AND ap.id IS NULL AND ${EXCLUDE_PIKADON}` : `WHERE ap.id IS NULL AND ${EXCLUDE_PIKADON}`}
        ORDER BY t.date DESC
      `,
      parameters,
    );

    return result.rows;
  }

  if (!categoryId) {
    throw serviceError(400, 'Category filtering requires categoryId parameter');
  }

  const parameters = [categoryId];
  let monthClause = '';

  if (month && month !== 'all') {
    parameters.push(month);
    monthClause = `AND ${monthExpr} = $${parameters.length}`;
  }

  const result = await database.query(
    `
      WITH RECURSIVE category_tree AS (
        SELECT id FROM category_definitions WHERE id = $1
        UNION ALL
        SELECT cd.id
        FROM category_definitions cd
        JOIN category_tree ct ON cd.parent_id = ct.id
      )
      SELECT
        t.name,
        t.price,
        t.date,
        t.identifier,
        t.vendor,
        t.account_number,
        t.category_definition_id,
        cd.name AS category_name,
        cd.name_en AS category_name_en,
        cd.category_type,
        parent.id AS parent_category_definition_id,
        parent.name AS parent_category_name,
        parent.name_en AS parent_category_name_en
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      LEFT JOIN account_pairings ap ON (
        t.vendor = ap.bank_vendor
        AND ap.is_active = 1
        AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
        AND ap.match_patterns IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM json_each(ap.match_patterns)
          WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
        )
      )
      WHERE t.category_definition_id IN (SELECT id FROM category_tree)
        AND ap.id IS NULL
        AND ${EXCLUDE_PIKADON}
      ${monthClause}
      ORDER BY t.date DESC
    `,
    parameters,
  );

  return result.rows;
}

async function getCategorySpendingTimeline(params = {}) {
  const { category, categoryId: rawCategoryId, month, groupByYear } = params;

  if (!month || !groupByYear) {
    throw serviceError(400, 'month and groupByYear are required');
  }

  if (!rawCategoryId && !category) {
    throw serviceError(400, 'categoryId or category is required');
  }

  const groupByYearFlag = normalizeBoolean(groupByYear);
  const limit = parseInteger(month, 'month');

  const yearExpr = dialect.toChar('t.date', 'YYYY');
  const monthExpr = dialect.toChar('t.date', 'MM');
  const yearMonthExpr = dialect.toChar('t.date', 'MM-YYYY');
  const yearTrunc = dialect.dateTrunc('year', 't.date');
  const monthTrunc = dialect.dateTrunc('month', 't.date');

  if (rawCategoryId !== undefined) {
    const categoryId = parseInteger(rawCategoryId, 'categoryId');
    const parameters = [categoryId, limit];

    if (groupByYearFlag) {
      const result = await database.query(
        `
          WITH RECURSIVE category_tree AS (
            SELECT id FROM category_definitions WHERE id = $1
            UNION ALL
            SELECT cd.id
            FROM category_definitions cd
            JOIN category_tree ct ON cd.parent_id = ct.id
          ),
          temp AS (
            SELECT
              SUM(t.price) AS amount,
              ${yearExpr} AS year,
              ${yearTrunc} AS year_sort
            FROM transactions t
            LEFT JOIN account_pairings ap ON (
              t.vendor = ap.bank_vendor
              AND ap.is_active = 1
              AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
              AND ap.match_patterns IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM json_each(ap.match_patterns)
                WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
              )
            )
            WHERE t.category_definition_id IN (SELECT id FROM category_tree)
              AND ap.id IS NULL
            GROUP BY ${yearExpr}, ${yearTrunc}
            ORDER BY year_sort DESC
            LIMIT $2
          )
          SELECT amount, year
          FROM temp
          ORDER BY year ASC
        `,
        parameters,
      );

      return result.rows;
    }

    const result = await database.query(
      `
        WITH RECURSIVE category_tree AS (
          SELECT id FROM category_definitions WHERE id = $1
          UNION ALL
          SELECT cd.id
          FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.id
        ),
        temp AS (
          SELECT
            SUM(t.price) AS amount,
            ${yearExpr} AS year,
            ${monthExpr} AS month,
            ${yearMonthExpr} AS year_month,
            ${monthTrunc} AS month_sort
          FROM transactions t
          LEFT JOIN account_pairings ap ON (
            t.vendor = ap.bank_vendor
            AND ap.is_active = 1
            AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
            AND ap.match_patterns IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM json_each(ap.match_patterns)
              WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
            )
          )
          WHERE t.category_definition_id IN (SELECT id FROM category_tree)
            AND ap.id IS NULL
          GROUP BY ${yearExpr}, ${monthExpr}, ${yearMonthExpr}, ${monthTrunc}
          ORDER BY month_sort DESC
          LIMIT $2
        )
        SELECT amount, year, month, year_month
        FROM temp
        ORDER BY year ASC, month ASC
      `,
      parameters,
    );

    return result.rows;
  }

  const parameters = [category, limit];

  if (groupByYearFlag) {
    const result = await database.query(
      `
        WITH temp AS (
          SELECT
            SUM(t.price) AS amount,
            ${yearExpr} AS year,
            ${yearTrunc} AS year_sort
          FROM transactions t
          WHERE t.category = $1
          GROUP BY ${yearExpr}, ${yearTrunc}
          ORDER BY year_sort DESC
          LIMIT $2
        )
        SELECT amount, year
        FROM temp
        ORDER BY year ASC
      `,
      parameters,
    );

    return result.rows;
  }

  const result = await database.query(
    `
      WITH temp AS (
        SELECT
          SUM(t.price) AS amount,
          ${yearExpr} AS year,
          ${monthExpr} AS month,
          ${yearMonthExpr} AS year_month,
          ${monthTrunc} AS month_sort
        FROM transactions t
        WHERE t.category = $1
        GROUP BY ${yearExpr}, ${monthExpr}, ${yearMonthExpr}, ${monthTrunc}
        ORDER BY month_sort DESC
        LIMIT $2
      )
      SELECT amount, year, month, year_month
      FROM temp
      ORDER BY year ASC, month ASC
    `,
    parameters,
  );

  return result.rows;
}

async function getExpensesByMonth(params = {}) {
  const { month, groupByYear } = params;

  if (!month || !groupByYear) {
    throw serviceError(400, 'month and groupByYear are required');
  }

  const limit = parseInteger(month, 'month');
  const groupByYearFlag = normalizeBoolean(groupByYear) === true;

  const yearExpr = dialect.toChar('t.date', 'YYYY');
  const monthExpr = dialect.toChar('t.date', 'MM');
  const yearMonthExpr = dialect.toChar('t.date', 'MM-YYYY');
  const yearTrunc = dialect.dateTrunc('year', 't.date');
  const monthTrunc = dialect.dateTrunc('month', 't.date');

  if (groupByYearFlag) {
    const result = await database.query(
      `
        SELECT
          SUM(t.price) AS amount,
          ${yearExpr} AS year,
          ${yearTrunc} AS year_sort
        FROM transactions t
        JOIN category_definitions cd ON cd.id = t.category_definition_id
        LEFT JOIN account_pairings ap ON (
          t.vendor = ap.bank_vendor
          AND ap.is_active = 1
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
          AND ap.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM json_each(ap.match_patterns)
            WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
          )
        )
        WHERE cd.name != $2
          AND cd.category_type = 'expense'
          AND ap.id IS NULL
        GROUP BY ${yearExpr}, ${yearTrunc}
        ORDER BY year_sort DESC
        LIMIT $1
      `,
      [limit, BANK_CATEGORY_NAME],
    );

    return result.rows.map((row) => ({
      ...row,
      amount: Number.parseFloat(row.amount) || 0,
    }));
  }

  const result = await database.query(
    `
      SELECT
        SUM(t.price) AS amount,
        ${yearExpr} AS year,
        ${monthExpr} AS month,
        ${yearMonthExpr} AS year_month,
        ${monthTrunc} AS year_sort
      FROM transactions t
      JOIN category_definitions cd ON cd.id = t.category_definition_id
      LEFT JOIN account_pairings ap ON (
        t.vendor = ap.bank_vendor
        AND ap.is_active = 1
        AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
        AND ap.match_patterns IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM json_each(ap.match_patterns)
          WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
        )
      )
      WHERE cd.name != $2
        AND cd.category_type = 'expense'
        AND ap.id IS NULL
      GROUP BY
        ${yearExpr},
        ${monthExpr},
        ${yearMonthExpr},
        ${monthTrunc}
      ORDER BY year_sort DESC
      LIMIT $1
    `,
    [limit, BANK_CATEGORY_NAME],
  );

  return result.rows.map((row) => ({
    ...row,
    amount: Number.parseFloat(row.amount) || 0,
  }));
}

async function getMonthByCategories(params = {}) {
  const { month } = params;

  if (!month) {
    throw serviceError(400, 'Month parameter is required');
  }

  const result = await database.query(
    `
      WITH monthly_transactions AS (
        SELECT
          t.price,
          t.auto_categorized,
          cd.id AS category_id,
          cd.name AS category_name,
          cd.name_en AS category_name_en,
          cd.icon AS category_icon,
          cd.color AS category_color,
          cd.category_type AS category_type,
          cd.parent_id AS parent_id,
          parent.id AS parent_category_id,
          parent.name AS parent_category_name,
          parent.name_en AS parent_category_name_en,
          parent.icon AS parent_category_icon,
          parent.color AS parent_category_color,
          parent.category_type AS parent_category_type
        FROM transactions t
        LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
        LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
        LEFT JOIN account_pairings ap ON (
          t.vendor = ap.bank_vendor
          AND ap.is_active = 1
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
          AND ap.match_patterns IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM json_each(ap.match_patterns)
            WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
          )
        )
        WHERE ${dialect.toChar('t.date', 'YYYY-MM')} = $1
          AND t.category_definition_id IS NOT NULL
          AND ap.id IS NULL
      )
      SELECT
        COALESCE(parent_category_id, category_id) AS category_definition_id,
        COALESCE(parent_category_name, category_name) AS name,
        COALESCE(parent_category_name_en, category_name_en) AS name_en,
        COALESCE(parent_category_icon, category_icon) AS icon,
        COALESCE(parent_category_color, category_color) AS color,
        COALESCE(parent_category_type, category_type) AS category_type,
        COUNT(*) AS transaction_count,
        ROUND(SUM(price)) AS value,
        SUM(CASE WHEN auto_categorized = true THEN 1 ELSE 0 END) AS auto_count,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) AS expenses_total,
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) AS income_total
      FROM monthly_transactions
      WHERE COALESCE(parent_category_type, category_type) = 'expense'
      GROUP BY
        COALESCE(parent_category_id, category_id),
        COALESCE(parent_category_name, category_name),
        COALESCE(parent_category_name_en, category_name_en),
        COALESCE(parent_category_icon, category_icon),
        COALESCE(parent_category_color, category_color),
        COALESCE(parent_category_type, category_type)
      ORDER BY ABS(SUM(price)) DESC
    `,
    [month],
  );

  return result.rows.map((row) => ({
    ...row,
    value: Number.parseFloat(row.value) || 0,
    expenses_total: Number.parseFloat(row.expenses_total) || 0,
    income_total: Number.parseFloat(row.income_total) || 0,
    transaction_count: Number.parseInt(row.transaction_count, 10) || 0,
    auto_count: Number.parseInt(row.auto_count, 10) || 0,
  }));
}

async function listCategories() {
  const result = await database.query(
    `
      SELECT
        cd.id,
        cd.name,
        cd.name_en,
        cd.category_type,
        cd.parent_id,
        parent.name AS parent_name,
        parent.name_en AS parent_name_en,
        cd.display_order,
        parent.display_order AS parent_display_order
      FROM category_definitions cd
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE cd.is_active = 1
      ORDER BY
        cd.category_type,
        COALESCE(parent.display_order, 0),
        cd.display_order,
        cd.name
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    nameEn: row.name_en,
    categoryType: row.category_type,
    parentId: row.parent_id,
    parentName: row.parent_name,
    parentNameEn: row.parent_name_en,
  }));
}

module.exports = {
  listAvailableMonths,
  getBoxPanelData,
  getCategoryExpenses,
  getCategorySpendingTimeline,
  getExpensesByMonth,
  getMonthByCategories,
  listCategories,
  __setDatabase,
  __resetDatabase,
};

module.exports.default = module.exports;
