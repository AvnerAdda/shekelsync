import pool from '../db.js';

/**
 * API endpoint for fetching transactions by category
 * GET: Fetch all transactions for a specific category
 */

export default async function handler(req, res) {
  const { method } = req;

  if (method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    return await handleGet(req, res);
  } catch (error) {
    console.error('Category transactions API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

/**
 * GET: Fetch all transactions for a specific category
 */
async function handleGet(req, res) {
  const { categoryId, limit = 100, offset = 0 } = req.query;

  if (!categoryId) {
    return res.status(400).json({ error: 'categoryId is required' });
  }

  try {
    // Fetch transactions for the category
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
        cd.name as category_name,
        cd.name_en as category_name_en
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      WHERE t.category_definition_id = ?
      ORDER BY t.date DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM transactions t
      WHERE t.category_definition_id = ?
    `;

    const [transactionsResult, countResult] = await Promise.all([
      pool.query(transactionsQuery, [categoryId, limit, offset]),
      pool.query(countQuery, [categoryId])
    ]);

    const totalCount = parseInt(countResult.rows[0]?.total || 0);

    return res.status(200).json({
      transactions: transactionsResult.rows.map(row => ({
        identifier: row.identifier,
        vendor: row.vendor,
        name: row.name,
        date: row.date,
        price: parseFloat(row.price),
        accountNumber: row.account_number,
        categoryDefinitionId: row.category_definition_id,
        categoryType: row.category_type,
        autoCategorized: row.auto_categorized,
        confidenceScore: row.confidence_score,
        categoryName: row.category_name,
        categoryNameEn: row.category_name_en,
      })),
      totalCount,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error fetching category transactions:', error);
    throw error;
  }
}
