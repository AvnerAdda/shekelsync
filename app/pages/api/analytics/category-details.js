import { getDB } from '../db.js';
// Duplicate filter removed from './utils.js';
import { dialect } from '../../../lib/sql-dialect.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { category, parentId, subcategoryId, startDate, endDate, type = 'expense' } = req.query;

    if (!category && !parentId && !subcategoryId) {
      return res.status(400).json({ error: 'Category identifier is required' });
    }

    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();

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
      // Viewing all subcategories under a parent (including parent itself)
      categoryFilter = `t.category_definition_id IN (
        WITH RECURSIVE category_tree AS (
          SELECT id FROM category_definitions WHERE id = $1
          UNION ALL
          SELECT cd.id FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.id
        )
        SELECT id FROM category_tree
      )`;
      categoryParams = [parentId];
    } else {
      // Lookup by category name (search both name and name_en)
      categoryFilter = `t.category_definition_id IN (
        WITH RECURSIVE category_tree AS (
          SELECT id FROM category_definitions
          WHERE LOWER(name) = LOWER($1) OR LOWER(name_en) = LOWER($1)
          UNION ALL
          SELECT cd.id FROM category_definitions cd
          JOIN category_tree ct ON cd.parent_id = ct.id
        )
        SELECT id FROM category_tree
      )`;
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
      `,
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
        t.account_number,
        cd.id as category_definition_id,
        cd.name as category_name,
        parent.name as parent_name
      FROM transactions t
      JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE ${categoryFilter}
      ${priceFilterClause}
      AND t.date >= $${categoryParams.length + 1}
      AND t.date <= $${categoryParams.length + 2}
      
      ORDER BY t.date DESC
      LIMIT 20`,
      [...categoryParams, start, end]
    );

    // Get spending trend by month for this category
    const monthExpr = dialect.toChar('t.date', 'YYYY-MM');
    const trendResult = await client.query(
      `SELECT
        ${monthExpr} as month,
        SUM(${amountExpression}) as total,
        COUNT(*) as count
      FROM transactions t
      WHERE ${categoryFilter}
      ${priceFilterClause}
      AND t.date >= $${categoryParams.length + 1}
      AND t.date <= $${categoryParams.length + 2}
      
      GROUP BY ${monthExpr}
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
        categoryDefinitionId: row.category_definition_id,
        categoryName: row.category_name,
        parentName: row.parent_name,
        accountNumber: row.account_number,
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
