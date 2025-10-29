import { getDB } from '../db.js';
import { resolveDateRange, buildTypeFilters, standardizeResponse, standardizeError } from '../utils/queryUtils.js';

/**
 * Unified Category Analytics API
 * Consolidates functionality from:
 * - category_expenses.js
 * - expenses_by_month.js
 * - analytics/breakdown.js
 * - analytics/category-details.js
 */

const VALID_TYPES = new Set(['expense', 'income', 'investment']);
const VALID_GROUP_BY = new Set(['category', 'month', 'vendor', 'card']);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json(standardizeError('Method not allowed', 'METHOD_NOT_ALLOWED'));
  }

  const client = await getDB();

  try {
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
      limit = 100
    } = req.query;

    // Validation
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json(
        standardizeError(`Invalid type. Expected one of ${Array.from(VALID_TYPES).join(', ')}`, 'INVALID_TYPE')
      );
    }

    if (!VALID_GROUP_BY.has(groupBy)) {
      return res.status(400).json(
        standardizeError(`Invalid groupBy. Expected one of ${Array.from(VALID_GROUP_BY).join(', ')}`, 'INVALID_GROUP_BY')
      );
    }

    // Build query components
    const { start, end } = resolveDateRange({ startDate, endDate, months });
    const { priceFilter, amountExpression, categoryFilter } = buildTypeFilters(type);

    const parsedSubcategoryId =
      subcategoryId !== undefined && subcategoryId !== null
        ? parseInt(subcategoryId, 10)
        : null;
    if (subcategoryId !== undefined && (parsedSubcategoryId === null || Number.isNaN(parsedSubcategoryId))) {
      return res.status(400).json(
        standardizeError('Invalid subcategoryId parameter', 'INVALID_CATEGORY')
      );
    }

    const parsedParentId =
      parentId !== undefined && parentId !== null ? parseInt(parentId, 10) : null;
    if (parentId !== undefined && (parsedParentId === null || Number.isNaN(parsedParentId))) {
      return res.status(400).json(
        standardizeError('Invalid parentId parameter', 'INVALID_CATEGORY')
      );
    }

    // Build category filter if specific category requested
    let categoryFilterClause = '';
    let categoryParams = [];

    if (parsedSubcategoryId !== null) {
      categoryFilterClause = 't.category_definition_id = $1';
      categoryParams = [parsedSubcategoryId];
    } else if (parsedParentId !== null) {
      categoryFilterClause = `t.category_definition_id IN (
        SELECT id FROM category_definitions WHERE parent_id = $1
      )`;
      categoryParams = [parsedParentId];
    } else if (category && typeof category === 'string' && category.trim()) {
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
        [normalizedCategoryName]
      );

      const matchedIds = categoryRows
        .map((row) => (typeof row.id === 'number' ? row.id : parseInt(row.id, 10)))
        .filter((id) => Number.isFinite(id));

      if (matchedIds.length > 0) {
        // Use recursive CTE to include subcategories
        categoryFilterClause = `t.category_definition_id IN (
          WITH RECURSIVE category_tree AS (
            SELECT id FROM category_definitions WHERE id = ANY($1::int[])
            UNION ALL
            SELECT cd.id FROM category_definitions cd
            JOIN category_tree ct ON cd.parent_id = ct.id
          )
          SELECT id FROM category_tree
        )`;
        categoryParams = [matchedIds];
      } else {
        // Fallback: search by name with recursive CTE
        categoryFilterClause = `t.category_definition_id IN (
          WITH RECURSIVE category_tree AS (
            SELECT id FROM category_definitions
            WHERE LOWER(name) = LOWER($1) OR LOWER(name_en) = LOWER($1)
            UNION ALL
            SELECT cd.id FROM category_definitions cd
            JOIN category_tree ct ON cd.parent_id = ct.id
          )
          SELECT id FROM category_tree
        )`;
        categoryParams = [normalizedCategoryName];
      }
    }

    const paramOffset = categoryParams.length;

    // Build grouped breakdown based on groupBy parameter
    let breakdownSelect = '';
    let breakdownGroupBy = '';
    let additionalWhereClause = '';

    switch (groupBy) {
      case 'category':
        breakdownSelect = `
          COALESCE(parent.name, cd.name) as category,
          CASE WHEN parent.id IS NOT NULL THEN cd.name ELSE NULL END as subcategory,
          COALESCE(parent.id, cd.id) as category_definition_id,
          cd.id as subcategory_id
        `;
        breakdownGroupBy = 'COALESCE(parent.name, cd.name), cd.name, COALESCE(parent.id, cd.id), cd.id, parent.id';
        break;

      case 'month':
        const monthExpr = "TO_CHAR(t.date, 'YYYY-MM')";
        breakdownSelect = `
          ${monthExpr} as month,
          ${monthExpr} as month_name
        `;
        breakdownGroupBy = monthExpr;
        break;

      case 'vendor':
        breakdownSelect = 't.vendor';
        breakdownGroupBy = 't.vendor';
        break;

      case 'card':
        breakdownSelect = `
          t.account_number,
          t.vendor
        `;
        breakdownGroupBy = 't.account_number, t.vendor';
        additionalWhereClause = ' AND t.account_number IS NOT NULL';
        break;
    }

    // Build WHERE clause
    const whereClause = `
      WHERE t.date >= $${paramOffset + 1}
      AND t.date <= $${paramOffset + 2}
      ${priceFilter ? `AND ${priceFilter}` : ''}
      ${categoryFilter ? `AND ${categoryFilter}` : ''}
      ${categoryFilterClause ? `AND ${categoryFilterClause}` : ''}
      
      ${additionalWhereClause}
    `;

    const baseParams = [
      ...categoryParams,
      start,
      end
    ];

    // Get summary statistics
    const summaryResult = await client.query(`
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
    `, baseParams);

    const summary = summaryResult.rows[0] || {};

    const breakdownResult = await client.query(`
      SELECT
        ${breakdownSelect},
        COUNT(*) as count,
        SUM(${amountExpression}) as total
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      ${whereClause}
      GROUP BY ${breakdownGroupBy}
      ORDER BY total DESC
      LIMIT $${baseParams.length + 1}
    `, [...baseParams, limit]);

    // Get recent transactions if requested
    let transactions = [];
    if (includeTransactions === 'true') {
      const transactionsResult = await client.query(`
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
      `, baseParams);

      transactions = transactionsResult.rows.map(row => ({
        date: row.date,
        name: row.name,
        price: parseFloat(row.price),
        vendor: row.vendor,
        categoryDefinitionId: row.category_definition_id,
        categoryName: row.category_name,
        parentName: row.parent_name,
        accountNumber: row.account_number,
      }));
    }

    // Format response
    const response = standardizeResponse({
      dateRange: { start, end },
      type,
      groupBy,
      summary: {
        total: parseFloat(summary.total || 0),
        count: parseInt(summary.count || 0, 10),
        average: parseFloat(summary.average || 0),
        minAmount: parseFloat(summary.min_amount || 0),
        maxAmount: parseFloat(summary.max_amount || 0),
      },
      breakdown: breakdownResult.rows.map(row => ({
        ...row,
        count: parseInt(row.count || 0, 10),
        total: parseFloat(row.total || 0),
      })),
      ...(includeTransactions === 'true' ? { transactions } : {})
    }, {
      filters: {
        category: category || null,
        parentId: parentId || null,
        subcategoryId: subcategoryId || null,
        excludeDuplicates: excludeDuplicates === 'true'
      }
    });

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in unified category analytics:', error);
    res.status(500).json(
      standardizeError('Failed to fetch category analytics', 'DATABASE_ERROR', {
        message: error.message
      })
    );
  } finally {
    client.release();
  }
}
