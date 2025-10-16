import { getDB } from '../db.js';
import { buildDuplicateFilter, resolveDateRange, buildTypeFilters, standardizeResponse, standardizeError } from '../utils/queryUtils.js';

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
      excludeDuplicates = 'true',
      groupBy = 'category',
      includeTransactions = 'false',
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
    const duplicateFilter = excludeDuplicates === 'true' ? await buildDuplicateFilter(client, 't') : '';

    // Build category filter if specific category requested
    let specificCategoryFilter = '';
    let categoryParams = [];

    if (subcategoryId) {
      specificCategoryFilter = 'AND t.category_definition_id = $';
      categoryParams = [subcategoryId];
    } else if (parentId) {
      specificCategoryFilter = `AND t.category_definition_id IN (
        SELECT id FROM category_definitions WHERE parent_id = $
      )`;
      categoryParams = [parentId];
    } else if (category) {
      specificCategoryFilter = 'AND COALESCE(t.parent_category, t.category) = $';
      categoryParams = [category];
    }

    const paramOffset = categoryParams.length;

    // Build grouped breakdown based on groupBy parameter
    let breakdownSelect = '';
    let breakdownGroupBy = '';
    let additionalWhereClause = '';

    switch (groupBy) {
      case 'category':
        breakdownSelect = `
          COALESCE(t.parent_category, t.category) as category,
          t.category as subcategory
        `;
        breakdownGroupBy = 'COALESCE(t.parent_category, t.category), t.category';
        break;

      case 'month':
        breakdownSelect = `
          TO_CHAR(t.date, 'YYYY-MM') as month,
          TO_CHAR(t.date, 'Mon YYYY') as month_name
        `;
        breakdownGroupBy = "TO_CHAR(t.date, 'YYYY-MM'), TO_CHAR(t.date, 'Mon YYYY')";
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
      ${specificCategoryFilter ? specificCategoryFilter + (paramOffset + 3) : ''}
      ${duplicateFilter}
      ${additionalWhereClause}
    `;

    const baseParams = [
      ...categoryParams,
      start,
      end,
      ...(specificCategoryFilter ? [] : [])
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
      ${whereClause}
    `, baseParams);

    const summary = summaryResult.rows[0] || {};

    const breakdownResult = await client.query(`
      SELECT
        ${breakdownSelect},
        COUNT(*) as count,
        SUM(${amountExpression}) as total
      FROM transactions t
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
          t.category,
          t.parent_category,
          t.account_number
        FROM transactions t
        ${whereClause}
        ORDER BY t.date DESC
        LIMIT 20
      `, baseParams);

      transactions = transactionsResult.rows.map(row => ({
        date: row.date,
        name: row.name,
        price: parseFloat(row.price),
        vendor: row.vendor,
        category: row.category,
        parentCategory: row.parent_category,
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