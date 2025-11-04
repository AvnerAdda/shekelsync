const database = require('../database.js');
const {
  resolveDateRange,
  buildTypeFilters,
  standardizeResponse,
  standardizeError,
} = require('../../../lib/server/query-utils.js');

const VALID_TYPES = new Set(['expense', 'income', 'investment']);
const VALID_GROUP_BY = new Set(['category', 'month', 'vendor', 'card']);

function parseId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function resolveCategoryIds(client, { category, parentId, subcategoryId }) {
  const parsedSubcategoryId = parseId(subcategoryId);
  if (subcategoryId !== undefined && parsedSubcategoryId === null) {
    throw standardizeError('Invalid subcategoryId parameter', 'INVALID_CATEGORY');
  }

  const parsedParentId = parseId(parentId);
  if (parentId !== undefined && parsedParentId === null) {
    throw standardizeError('Invalid parentId parameter', 'INVALID_CATEGORY');
  }

  if (parsedSubcategoryId !== null) {
    return {
      clause: 't.category_definition_id = $1',
      params: [parsedSubcategoryId],
    };
  }

  if (parsedParentId !== null) {
    return {
      clause: `t.category_definition_id IN (
        SELECT id FROM category_definitions WHERE parent_id = $1
      )`,
      params: [parsedParentId],
    };
  }

  if (category && typeof category === 'string' && category.trim()) {
    const normalizedCategoryName = category.trim();
    const { rows: categoryRows } = await client.query(
      `
          WITH matched AS (
            SELECT id
            FROM category_definitions
            WHERE LOWER(name) = LOWER($1) OR LOWER(name_en) = LOWER($1)
          ),
          hierarchy AS (
            SELECT id FROM matched
            UNION ALL
            SELECT cd.id
            FROM category_definitions cd
            JOIN hierarchy h ON cd.parent_id = h.id
          )
          SELECT DISTINCT id FROM hierarchy
        `,
      [normalizedCategoryName],
    );

    const matchedIds = categoryRows
      .map((row) => (typeof row.id === 'number' ? row.id : Number.parseInt(row.id, 10)))
      .filter((id) => Number.isFinite(id));

    if (matchedIds.length > 0) {
      return {
        clause: `t.category_definition_id IN (
          WITH RECURSIVE category_tree AS (
            SELECT id FROM category_definitions WHERE id = ANY($1::int[])
            UNION ALL
            SELECT cd.id FROM category_definitions cd
            JOIN category_tree ct ON cd.parent_id = ct.id
          )
          SELECT id FROM category_tree
        )`,
        params: [matchedIds],
      };
    }

    return {
      clause: `t.category_definition_id IN (
        WITH RECURSIVE category_tree AS (
          SELECT id FROM category_definitions
          WHERE LOWER(name) = LOWER($1) OR LOWER(name_en) = LOWER($1)
          UNION ALL
          SELECT cd.id FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.id
        )
        SELECT id FROM category_tree
      )`,
      params: [normalizedCategoryName],
    };
  }

  return {
    clause: '',
    params: [],
  };
}

function buildBreakdownConfig(groupBy) {
  switch (groupBy) {
    case 'category':
      return {
        select: `
          COALESCE(parent.name, cd.name) as category,
          CASE WHEN parent.id IS NOT NULL THEN cd.name ELSE NULL END as subcategory,
          COALESCE(parent.id, cd.id) as category_definition_id,
          cd.id as subcategory_id
        `,
        groupBy: 'COALESCE(parent.name, cd.name), cd.name, COALESCE(parent.id, cd.id), cd.id, parent.id',
        additionalWhere: '',
      };
    case 'month': {
      const monthExpr = "TO_CHAR(t.date, 'YYYY-MM')";
      return {
        select: `
          ${monthExpr} as month,
          ${monthExpr} as month_name
        `,
        groupBy: monthExpr,
        additionalWhere: '',
      };
    }
    case 'vendor':
      return {
        select: 't.vendor',
        groupBy: 't.vendor',
        additionalWhere: '',
      };
    case 'card':
      return {
        select: `
          t.account_number,
          t.vendor
        `,
        groupBy: 't.account_number, t.vendor',
        additionalWhere: ' AND t.account_number IS NOT NULL',
      };
    default:
      return {
        select: 't.vendor',
        groupBy: 't.vendor',
        additionalWhere: '',
      };
  }
}

async function getUnifiedCategoryAnalytics(query = {}) {
  const {
    type = 'expense',
    startDate,
    endDate,
    months = 3,
    category,
    parentId,
    subcategoryId,
    groupBy = 'category',
    includeTransactions = 'false',
    excludeDuplicates = 'false',
    limit = 100,
  } = query;

  if (!VALID_TYPES.has(type)) {
    throw standardizeError(
      `Invalid type. Expected one of ${Array.from(VALID_TYPES).join(', ')}`,
      'INVALID_TYPE',
    );
  }

  if (!VALID_GROUP_BY.has(groupBy)) {
    throw standardizeError(
      `Invalid groupBy. Expected one of ${Array.from(VALID_GROUP_BY).join(', ')}`,
      'INVALID_GROUP_BY',
    );
  }

  const client = await database.getClient();

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, months });
    const { priceFilter, amountExpression, categoryFilter } = buildTypeFilters(type);

    const categoryResolution = await resolveCategoryIds(client, {
      category,
      parentId,
      subcategoryId,
    });

    const { select, groupBy: breakdownGroupBy, additionalWhere } = buildBreakdownConfig(groupBy);

    const whereClause = `
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
      WHERE t.date >= $${categoryResolution.params.length + 1}
      AND t.date <= $${categoryResolution.params.length + 2}
      ${priceFilter ? `AND ${priceFilter}` : ''}
      ${categoryFilter ? `AND ${categoryFilter}` : ''}
      ${categoryResolution.clause ? `AND ${categoryResolution.clause}` : ''}
      AND ap.id IS NULL
      ${additionalWhere}
    `;

    const baseParams = [
      ...categoryResolution.params,
      start,
      end,
    ];

    const summaryResult = await client.query(
      `
        SELECT
          COUNT(*) as count,
          SUM(${amountExpression}) as total,
          AVG(${amountExpression}) as average,
          MIN(${amountExpression}) as min_amount,
          MAX(${amountExpression}) as max_amount
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
        LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
        ${whereClause}
      `,
      baseParams,
    );

    const breakdownResult = await client.query(
      `
        SELECT
          ${select},
          COUNT(*) as count,
          SUM(${amountExpression}) as total
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
        LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
        ${whereClause}
        GROUP BY ${breakdownGroupBy}
        ORDER BY total DESC
        LIMIT $${baseParams.length + 1}
      `,
      [...baseParams, limit],
    );

    let transactions = [];
    if (includeTransactions === 'true') {
      const transactionsResult = await client.query(
        `
          SELECT
            t.date,
            t.name,
            t.price,
            t.vendor,
            t.account_number,
            cd.id as category_definition_id,
            cd.name as category_name,
            parent.name as parent_name
          FROM transactions t
          LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
          LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
          ${whereClause}
          ORDER BY t.date DESC
          LIMIT 20
        `,
        baseParams,
      );

      transactions = transactionsResult.rows.map((row) => ({
        date: row.date,
        name: row.name,
        price: Number.parseFloat(row.price),
        vendor: row.vendor,
        categoryDefinitionId: row.category_definition_id,
        categoryName: row.category_name,
        parentName: row.parent_name,
        accountNumber: row.account_number,
      }));
    }

    const summary = summaryResult.rows[0] || {};

    return standardizeResponse({
      dateRange: { start, end },
      type,
      groupBy,
      summary: {
        total: Number.parseFloat(summary.total || 0),
        count: Number.parseInt(summary.count || 0, 10) || 0,
        average: Number.parseFloat(summary.average || 0),
        minAmount: Number.parseFloat(summary.min_amount || 0),
        maxAmount: Number.parseFloat(summary.max_amount || 0),
      },
      breakdown: breakdownResult.rows.map((row) => ({
        ...row,
        count: Number.parseInt(row.count || 0, 10) || 0,
        total: Number.parseFloat(row.total || 0),
      })),
      ...(includeTransactions === 'true' ? { transactions } : {}),
    }, {
      filters: {
        category: category || null,
        parentId: parentId || null,
        subcategoryId: subcategoryId || null,
        excludeDuplicates: excludeDuplicates === 'true',
      },
    });
  } catch (error) {
    if (error?.error) {
      throw error;
    }
    throw standardizeError('Failed to fetch category analytics', 'DATABASE_ERROR', {
      message: error.message,
    });
  } finally {
    if (typeof client.release === 'function') {
      client.release();
    }
  }
}

module.exports = {
  getUnifiedCategoryAnalytics,
};
module.exports.default = module.exports;
