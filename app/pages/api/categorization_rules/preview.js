import { getDB } from '../db.js';

/**
 * Preview API for categorization rules
 * Shows which transactions match a given pattern
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { pattern, ruleId, limit = 100 } = req.query;

    if (!pattern && !ruleId) {
      return res.status(400).json({ error: 'Pattern or ruleId is required' });
    }

    let namePattern = pattern;

    // If ruleId provided, fetch the pattern from the rule
    if (ruleId) {
      const ruleResult = await client.query(
        'SELECT name_pattern FROM categorization_rules WHERE id = $1',
        [ruleId]
      );

      if (ruleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Rule not found' });
      }

      namePattern = ruleResult.rows[0].name_pattern;
    }

    // Add wildcards to pattern (same as apply_categorization_rules.js line 35)
    const patternWithWildcards = `%${namePattern}%`;

    // Query transactions that match the pattern
    // Use ILIKE for case-insensitive matching (same as categorization logic)
    const transactionsResult = await client.query(
      `SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.account_number,
        t.memo,
        cd.id as category_definition_id,
        cd.name as category_name,
        parent.name as parent_category_name
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE LOWER(t.name) LIKE LOWER($1)
      ORDER BY t.date DESC
      LIMIT $2`,
      [patternWithWildcards, parseInt(limit)]
    );

    // Get total count of matching transactions
    const countResult = await client.query(
      `SELECT COUNT(*) as total
      FROM transactions
      WHERE LOWER(name) LIKE LOWER($1)`,
      [patternWithWildcards]
    );

    const totalCount = parseInt(countResult.rows[0].total);
    const transactions = transactionsResult.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      date: row.date,
      name: row.name,
      price: parseFloat(row.price),
      category: row.category,
      parentCategory: row.parent_category,
      accountNumber: row.account_number,
      memo: row.memo,
    }));

    res.status(200).json({
      pattern: namePattern,
      totalCount,
      matchedTransactions: transactions,
      limitApplied: parseInt(limit),
    });

  } catch (error) {
    console.error('Error previewing pattern matches:', error);
    res.status(500).json({
      error: 'Failed to preview pattern matches',
      details: error.message,
    });
  } finally {
    client.release();
  }
}
