import { getDB } from '../db.js';

/**
 * Detect transactions matching duplicate patterns
 * GET /api/patterns/detect
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { startDate, endDate, patternId, onlyUnreviewed = 'true' } = req.query;

    const start = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 3));
    const end = endDate ? new Date(endDate) : new Date();

    // Check if tables exist
    const patternsTableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'duplicate_patterns'
      );
    `);

    if (!patternsTableCheck.rows[0].exists) {
      return res.status(500).json({
        error: 'Pattern-based duplicate detection not available. Run migration first.',
        suggestions: []
      });
    }

    // Get active patterns
    let patternQuery = `
      SELECT id, pattern_name, pattern_regex, match_type, override_category, confidence, description
      FROM duplicate_patterns
      WHERE is_active = true
    `;

    if (patternId) {
      patternQuery += ` AND id = ${parseInt(patternId)}`;
    }

    patternQuery += ` ORDER BY confidence DESC, match_count DESC`;

    const patternsResult = await client.query(patternQuery);
    const patterns = patternsResult.rows;

    const suggestions = [];

    // For each pattern, find matching transactions
    for (const pattern of patterns) {
      const matchQuery = `
        SELECT
          t.identifier,
          t.vendor,
          t.date,
          t.name,
          t.price,
          t.category,
          t.account_number
        FROM transactions t
        WHERE t.name ~* $1
        AND t.category = 'Bank'
        AND t.price < 0
        AND t.date >= $2
        AND t.date <= $3
        AND NOT EXISTS (
          SELECT 1 FROM manual_exclusions me
          WHERE me.transaction_identifier = t.identifier
          AND me.transaction_vendor = t.vendor
        )
        AND NOT EXISTS (
          SELECT 1 FROM transaction_duplicates td
          WHERE td.exclude_from_totals = true
          AND (
            (td.transaction1_identifier = t.identifier AND td.transaction1_vendor = t.vendor) OR
            (td.transaction2_identifier = t.identifier AND td.transaction2_vendor = t.vendor)
          )
        )
        ORDER BY t.date DESC
        LIMIT 50
      `;

      const matchesResult = await client.query(matchQuery, [pattern.pattern_regex, start, end]);

      if (matchesResult.rows.length > 0) {
        suggestions.push({
          pattern: {
            id: pattern.id,
            name: pattern.pattern_name,
            regex: pattern.pattern_regex,
            type: pattern.match_type,
            overrideCategory: pattern.override_category,
            confidence: pattern.confidence,
            description: pattern.description
          },
          matches: matchesResult.rows,
          matchCount: matchesResult.rows.length
        });
      }
    }

    // Sort by match count (most matches first)
    suggestions.sort((a, b) => b.matchCount - a.matchCount);

    res.status(200).json({
      suggestions,
      totalPatterns: patterns.length,
      totalMatches: suggestions.reduce((sum, s) => sum + s.matchCount, 0)
    });

  } catch (error) {
    console.error('Error detecting pattern matches:', error);
    res.status(500).json({
      error: 'Failed to detect pattern matches',
      details: error.message
    });
  } finally {
    client.release();
  }
}
