import { getDB } from '../db.js';
import { buildDuplicateFilter } from './utils.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { category, parentId, subcategoryId, startDate, endDate, type = 'expense', excludeDuplicates = 'true' } = req.query;

    if (!category && !parentId && !subcategoryId) {
      return res.status(400).json({ error: 'Category identifier is required' });
    }

    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();

    const duplicateFilter = excludeDuplicates === 'true'
      ? await buildDuplicateFilter(client, 't')
      : '';

    // Determine price filter based on type
    let priceFilter;
    if (type === 'income') {
      priceFilter = 't.price > 0';
    } else if (type === 'investment') {
      priceFilter = '';
    } else {
      priceFilter = 't.price < 0';
    }
  const priceFilterClause = priceFilter ? `AND ${priceFilter}` : '';
  const amountExpression = type === 'income' ? 't.price' : 'ABS(t.price)';

    // Build WHERE clause based on what's provided
    let categoryFilter;
    let categoryParams;

    if (subcategoryId) {
      // Viewing a specific subcategory
      categoryFilter = 't.category_definition_id = $1';
      categoryParams = [subcategoryId];
    } else if (parentId) {
      // Viewing all subcategories under a parent
      categoryFilter = `t.category_definition_id IN (
        SELECT id FROM category_definitions WHERE parent_id = $1
      )`;
      categoryParams = [parentId];
    } else {
      // Legacy: fallback to category name
      categoryFilter = 'COALESCE(t.parent_category, t.category) = $1';
      categoryParams = [category];
    }

    // Get summary stats for this category
    const summaryResult = await client.query(
      `SELECT
        COUNT(*) as count,
  SUM(${amountExpression}) as total,
  AVG(${amountExpression}) as average,
  MIN(${amountExpression}) as min_amount,
  MAX(${amountExpression}) as max_amount
      FROM transactions t
      WHERE ${categoryFilter}
      ${priceFilterClause}
      AND t.date >= $${categoryParams.length + 1}
      AND t.date <= $${categoryParams.length + 2}
      ${duplicateFilter}`,
      [...categoryParams, start, end]
    );

    // Get breakdown by vendor for this category
    const vendorResult = await client.query(
      `SELECT
        t.vendor,
        COUNT(*) as count,
  SUM(${amountExpression}) as total
      FROM transactions t
      WHERE ${categoryFilter}
      ${priceFilterClause}
      AND t.date >= $${categoryParams.length + 1}
      AND t.date <= $${categoryParams.length + 2}
      ${duplicateFilter}
      GROUP BY t.vendor
      ORDER BY total DESC`,
      [...categoryParams, start, end]
    );

    // Get breakdown by card (account_number) for this category
    const cardResult = await client.query(
      `SELECT
        t.account_number,
        t.vendor,
        COUNT(*) as count,
  SUM(${amountExpression}) as total
      FROM transactions t
      WHERE ${categoryFilter}
      ${priceFilterClause}
      AND t.date >= $${categoryParams.length + 1}
      AND t.date <= $${categoryParams.length + 2}
      AND t.account_number IS NOT NULL
      ${duplicateFilter}
      GROUP BY t.account_number, t.vendor
      ORDER BY total DESC`,
      [...categoryParams, start, end]
    );

    // Get subcategory breakdown if viewing parent
    let subcategoryBreakdown = [];
    if (parentId) {
      const subcategoryResult = await client.query(
        `SELECT
          cd.id,
          cd.name,
          COUNT(t.identifier) as count,
          SUM(${amountExpression}) as total
        FROM transactions t
        JOIN category_definitions cd ON t.category_definition_id = cd.id
        WHERE cd.parent_id = $1
        ${priceFilterClause}
        AND t.date >= $2
        AND t.date <= $3
        ${duplicateFilter}
        GROUP BY cd.id, cd.name
        ORDER BY total DESC`,
        [parentId, start, end]
      );
      subcategoryBreakdown = subcategoryResult.rows;
    }

    // Get recent transactions for this category
    const transactionsResult = await client.query(
      `SELECT
        t.date,
        t.name,
        t.price,
        t.vendor,
        t.category,
        t.parent_category,
        t.account_number
      FROM transactions t
      WHERE ${categoryFilter}
      ${priceFilterClause}
      AND t.date >= $${categoryParams.length + 1}
      AND t.date <= $${categoryParams.length + 2}
      ${duplicateFilter}
      ORDER BY t.date DESC
      LIMIT 20`,
      [...categoryParams, start, end]
    );

    // Get spending trend by month for this category
    const trendResult = await client.query(
      `SELECT
        TO_CHAR(t.date, 'YYYY-MM') as month,
        SUM(${amountExpression}) as total,
        COUNT(*) as count
      FROM transactions t
      WHERE ${categoryFilter}
      ${priceFilterClause}
      AND t.date >= $${categoryParams.length + 1}
      AND t.date <= $${categoryParams.length + 2}
      ${duplicateFilter}
      GROUP BY TO_CHAR(t.date, 'YYYY-MM')
      ORDER BY month ASC`,
      [...categoryParams, start, end]
    );

  const summary = summaryResult.rows[0] || {};

    res.status(200).json({
      category: category || null,
      parentId: parentId || null,
      subcategoryId: subcategoryId || null,
      summary: {
        count: parseInt(summary.count || 0),
        total: parseFloat(summary.total || 0),
        average: parseFloat(summary.average || 0),
        minAmount: parseFloat(summary.min_amount || 0),
        maxAmount: parseFloat(summary.max_amount || 0),
      },
      subcategories: subcategoryBreakdown.map(row => ({
        id: row.id,
        name: row.name,
        count: parseInt(row.count),
        total: parseFloat(row.total),
      })),
      byVendor: vendorResult.rows.map(row => ({
        vendor: row.vendor,
        count: parseInt(row.count),
        total: parseFloat(row.total),
      })),
      byCard: cardResult.rows.map(row => ({
        accountNumber: row.account_number,
        vendor: row.vendor,
        count: parseInt(row.count),
        total: parseFloat(row.total),
      })),
      transactions: transactionsResult.rows.map(row => ({
        date: row.date,
        name: row.name,
        price: parseFloat(row.price),
        vendor: row.vendor,
        category: row.category,
        parentCategory: row.parent_category,
        account_number: row.account_number,
      })),
      trend: trendResult.rows.map(row => ({
        month: row.month,
        total: parseFloat(row.total),
        count: parseInt(row.count),
      })),
    });
  } catch (error) {
    console.error('Error fetching category details:', error);
    res.status(500).json({ error: 'Failed to fetch category details', details: error.message });
  } finally {
    client.release();
  }
}
