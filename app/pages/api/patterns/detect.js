import { getDB } from '../db.js';
import { BANK_CATEGORY_NAME } from '../../../lib/category-constants.js';

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

    // Check if tables exist (SQLite compatible)
    const patternsTableCheck = await client.query(`
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type = 'table' AND name = 'duplicate_patterns'
    `);

    if (parseInt(patternsTableCheck.rows[0].count) === 0) {
      return res.status(500).json({
        error: 'Pattern-based duplicate detection not available. Run migration first.',
        suggestions: []
      });
    }

    // Check if override_category_definition_id column exists
    const columnsCheck = await client.query(`
      SELECT sql FROM sqlite_master WHERE type='table' AND name='duplicate_patterns'
    `);
    const hasOverrideCategoryDefId = columnsCheck.rows[0]?.sql?.includes('override_category_definition_id');

    // Get active patterns
    let patternQuery = `
      SELECT
        dp.id,
        dp.pattern_name,
        dp.pattern_regex,
        dp.match_type,
        dp.confidence,
        dp.description${hasOverrideCategoryDefId ? `,
        dp.override_category_definition_id,
        cd.name AS override_category_name` : ''}
      FROM duplicate_patterns dp${hasOverrideCategoryDefId ? `
      LEFT JOIN category_definitions cd ON cd.id = dp.override_category_definition_id` : ''}
      WHERE dp.is_active = true
    `;

    if (patternId) {
      patternQuery += ` AND dp.id = ${parseInt(patternId)}`;
    }

    patternQuery += ` ORDER BY dp.confidence DESC, dp.match_count DESC`;

    const patternsResult = await client.query(patternQuery);
    const patterns = patternsResult.rows;

    const suggestions = [];

    // For each pattern, find matching transactions
    for (const pattern of patterns) {
      // Convert simple regex to LIKE pattern (basic support)
      // For now, just use LIKE with pattern as-is (assuming patterns are simple text matches)
      const likePattern = `%${pattern.pattern_regex.replace(/[.*+?^${}()|[\]\\]/g, '')}%`;

      const matchQuery = `
        SELECT
          t.identifier,
          t.vendor,
          t.date,
          t.name,
          t.price,
          cd.name as category,
          t.account_number
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
        WHERE t.name LIKE $1
        AND t.category_definition_id IN (
          SELECT id FROM category_definitions WHERE name = $4
        )
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

      const matchesResult = await client.query(matchQuery, [likePattern, start, end, BANK_CATEGORY_NAME]);

      if (matchesResult.rows.length > 0) {
        suggestions.push({
          pattern: {
            id: pattern.id,
            name: pattern.pattern_name,
            regex: pattern.pattern_regex,
            type: pattern.match_type,
            overrideCategory: pattern.override_category_name || pattern.override_category,
            overrideCategoryDefinitionId: pattern.override_category_definition_id || null,
            overrideCategoryName: pattern.override_category_name || null,
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
