import { getDB } from './db.js';

/**
 * Intelligent transaction categorization using merchant catalog
 * This API attempts to auto-categorize a transaction based on its name
 * using pattern matching against the merchant_catalog
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { transaction_name, transaction_id, vendor } = req.body;

    if (!transaction_name) {
      return res.status(400).json({ error: 'transaction_name is required' });
    }

    // Clean the transaction name for better matching
    const cleanName = transaction_name.toLowerCase().trim();

    // Query merchant catalog for matching patterns
    const catalogResult = await client.query(
      `SELECT
        id,
        merchant_pattern,
        parent_category,
        subcategory,
        confidence
       FROM merchant_catalog
       WHERE is_active = true
       AND LOWER($1) LIKE '%' || LOWER(merchant_pattern) || '%'
       ORDER BY
         LENGTH(merchant_pattern) DESC,  -- Longer patterns first (more specific)
         confidence DESC
       LIMIT 5`,
      [cleanName]
    );

    const matches = catalogResult.rows;

    if (matches.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'No matching merchant pattern found',
        transaction_name,
        suggestions: []
      });
    }

    // Get the best match (first one due to ordering)
    const bestMatch = matches[0];

    // Calculate confidence based on pattern length and catalog confidence
    const patternLength = bestMatch.merchant_pattern.length;
    const nameLength = cleanName.length;
    const lengthRatio = patternLength / nameLength;
    const finalConfidence = bestMatch.confidence * Math.min(lengthRatio * 1.5, 1.0);

    // If transaction_id and vendor are provided, update the transaction
    if (transaction_id && vendor) {
      const updateResult = await client.query(
        `UPDATE transactions
         SET
           parent_category = $1,
           subcategory = $2,
           category = $3,
           merchant_name = $4,
           auto_categorized = true,
           confidence_score = $5
         WHERE identifier = $6 AND vendor = $7
         RETURNING *`,
        [
          bestMatch.parent_category,
          bestMatch.subcategory,
          bestMatch.subcategory || bestMatch.parent_category, // Fallback to parent if no subcategory
          transaction_name,
          finalConfidence,
          transaction_id,
          vendor
        ]
      );

      if (updateResult.rowCount === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'Transaction categorized successfully',
        transaction: updateResult.rows[0],
        match: bestMatch,
        confidence: finalConfidence,
        all_matches: matches
      });
    }

    // If no transaction to update, just return the suggestions
    return res.status(200).json({
      success: true,
      message: 'Categorization suggestions found',
      transaction_name,
      best_match: {
        parent_category: bestMatch.parent_category,
        subcategory: bestMatch.subcategory,
        confidence: finalConfidence,
        pattern: bestMatch.merchant_pattern
      },
      all_matches: matches.map(m => ({
        parent_category: m.parent_category,
        subcategory: m.subcategory,
        confidence: m.confidence,
        pattern: m.merchant_pattern
      }))
    });

  } catch (error) {
    console.error('Error in categorize_transaction API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    client.release();
  }
}

/**
 * Bulk categorize all transactions using merchant catalog
 */
export async function bulkCategorizeTransactions(client) {
  try {
    // Get all active merchant patterns
    const patternsResult = await client.query(`
      SELECT id, merchant_pattern, parent_category, subcategory, confidence
      FROM merchant_catalog
      WHERE is_active = true
      ORDER BY LENGTH(merchant_pattern) DESC, confidence DESC
    `);

    const patterns = patternsResult.rows;
    let totalUpdated = 0;

    // Apply each pattern to matching transactions
    for (const pattern of patterns) {
      const updateResult = await client.query(
        `UPDATE transactions
         SET
           parent_category = $1,
           subcategory = $2,
           category = COALESCE($2, $1),
           merchant_name = name,
           auto_categorized = true,
           confidence_score = $3
         WHERE
           LOWER(name) LIKE '%' || LOWER($4) || '%'
           AND category NOT IN ('Bank', 'Income')
           AND (
             parent_category IS NULL
             OR auto_categorized = false
             OR confidence_score < $3
           )`,
        [
          pattern.parent_category,
          pattern.subcategory,
          pattern.confidence,
          pattern.merchant_pattern
        ]
      );

      totalUpdated += updateResult.rowCount;
    }

    console.log(`Bulk categorization: Applied ${patterns.length} patterns to ${totalUpdated} transactions`);

    return {
      patternsApplied: patterns.length,
      transactionsUpdated: totalUpdated
    };
  } catch (error) {
    console.error('Error in bulk categorization:', error);
    throw error;
  }
}
