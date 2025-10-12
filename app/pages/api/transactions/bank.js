import { getDB } from '../db.js';

/**
 * Fetch bank transactions with exclusion status
 * GET /api/transactions/bank
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const {
      startDate,
      endDate,
      includeExcluded = 'true',
      search = '',
      limit = '100',
      offset = '0'
    } = req.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 3));
    const end = endDate ? new Date(endDate) : new Date();
    const searchPattern = `%${search.toLowerCase()}%`;

    // Check if manual_exclusions table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'manual_exclusions'
      );
    `);
    const hasManualExclusions = tableCheck.rows[0].exists;

    let query = `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.category,
        t.account_number,
        t.memo,
        ${hasManualExclusions ? `
        CASE
          WHEN me.id IS NOT NULL THEN true
          WHEN td.id IS NOT NULL THEN true
          ELSE false
        END as is_excluded,
        COALESCE(me.exclusion_reason, td.match_type) as exclusion_reason,
        COALESCE(me.override_category, td.override_category) as override_category,
        COALESCE(me.notes, td.notes) as exclusion_notes,
        CASE
          WHEN me.id IS NOT NULL THEN 'manual'
          WHEN td.id IS NOT NULL THEN 'duplicate'
          ELSE NULL
        END as exclusion_type
        ` : `
        false as is_excluded,
        NULL as exclusion_reason,
        NULL as override_category,
        NULL as exclusion_notes,
        NULL as exclusion_type
        `}
      FROM transactions t
      ${hasManualExclusions ? `
      LEFT JOIN manual_exclusions me ON (
        me.transaction_identifier = t.identifier
        AND me.transaction_vendor = t.vendor
      )
      LEFT JOIN transaction_duplicates td ON (
        td.exclude_from_totals = true AND (
          (td.transaction1_identifier = t.identifier AND td.transaction1_vendor = t.vendor) OR
          (td.transaction2_identifier = t.identifier AND td.transaction2_vendor = t.vendor)
        )
      )
      ` : ''}
      WHERE t.category = 'Bank'
      AND t.price < 0
      AND t.date >= $1
      AND t.date <= $2
      AND LOWER(t.name) LIKE $3
    `;

    const params = [start, end, searchPattern];

    // Filter out excluded if requested
    if (includeExcluded === 'false') {
      if (hasManualExclusions) {
        query += ` AND me.id IS NULL AND td.id IS NULL`;
      }
    }

    query += ` ORDER BY t.date DESC, ABS(t.price) DESC`;
    query += ` LIMIT $4 OFFSET $5`;

    params.push(parseInt(limit), parseInt(offset));

    const result = await client.query(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM transactions t
      ${hasManualExclusions ? `
      LEFT JOIN manual_exclusions me ON (
        me.transaction_identifier = t.identifier
        AND me.transaction_vendor = t.vendor
      )
      LEFT JOIN transaction_duplicates td ON (
        td.exclude_from_totals = true AND (
          (td.transaction1_identifier = t.identifier AND td.transaction1_vendor = t.vendor) OR
          (td.transaction2_identifier = t.identifier AND td.transaction2_vendor = t.vendor)
        )
      )
      ` : ''}
      WHERE t.category = 'Bank'
      AND t.price < 0
      AND t.date >= $1
      AND t.date <= $2
      AND LOWER(t.name) LIKE $3
    `;

    if (includeExcluded === 'false' && hasManualExclusions) {
      countQuery += ` AND me.id IS NULL AND td.id IS NULL`;
    }

    const countResult = await client.query(countQuery, [start, end, searchPattern]);
    const total = parseInt(countResult.rows[0].total);

    res.status(200).json({
      transactions: result.rows,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      hasMore: total > (parseInt(offset) + result.rows.length)
    });

  } catch (error) {
    console.error('Error fetching bank transactions:', error);
    res.status(500).json({
      error: 'Failed to fetch bank transactions',
      details: error.message
    });
  } finally {
    client.release();
  }
}
