import { getDB } from '../db.js';
import { buildDuplicateFilter } from './utils.js';

/**
 * GET /api/analytics/transactions-by-date?date=2025-01-15&excludeDuplicates=true
 * Returns all transactions for a specific date
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { date, excludeDuplicates = 'true' } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    console.log('Fetching transactions for date:', date);

    const duplicateFilter = excludeDuplicates === 'true'
      ? await buildDuplicateFilter(client, 't')
      : '';

    const result = await client.query(
      `SELECT
        t.identifier,
        t.vendor,
        t.price,
        t.description,
        t.date,
        cd_child.name as category,
        cd_parent.name as parent_category,
        cd_parent.category_type
      FROM transactions t
      LEFT JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      LEFT JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      WHERE DATE(t.date) = DATE($1)
      ${duplicateFilter}
      ORDER BY t.price DESC`,
      [date]
    );

    console.log(`Found ${result.rows.length} transactions for date ${date}`);

    const transactions = result.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      price: parseFloat(row.price),
      description: row.description,
      date: row.date,
      category: row.category,
      parentCategory: row.parent_category,
      categoryType: row.category_type,
    }));

    res.status(200).json({ transactions });
  } catch (error) {
    console.error('Error fetching transactions by date:', error);
    res.status(500).json({ error: 'Failed to fetch transactions', details: error.message });
  } finally {
    client.release();
  }
}
