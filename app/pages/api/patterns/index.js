import { getDB } from '../db.js';

/**
 * Manage duplicate detection patterns
 * GET - List all patterns
 * POST - Create new pattern
 * PUT - Update pattern
 * DELETE - Delete pattern
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    // Check if table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'duplicate_patterns'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      return res.status(500).json({
        error: 'Pattern detection not available. Run migration first.'
      });
    }

    // GET - List patterns
    if (req.method === 'GET') {
      const { includeInactive = 'false' } = req.query;

      let query = `
        SELECT
          id,
          pattern_name,
          pattern_regex,
          description,
          match_type,
          override_category,
          is_user_defined,
          is_auto_learned,
          is_active,
          confidence,
          match_count,
          last_matched_at,
          created_at,
          notes
        FROM duplicate_patterns
      `;

      if (includeInactive === 'false') {
        query += ` WHERE is_active = true`;
      }

      query += ` ORDER BY is_active DESC, confidence DESC, match_count DESC`;

      const result = await client.query(query);

      return res.status(200).json({
        patterns: result.rows
      });
    }

    // POST - Create new pattern
    if (req.method === 'POST') {
      const {
        patternName,
        patternRegex,
        description,
        matchType,
        overrideCategory,
        notes
      } = req.body;

      if (!patternName || !patternRegex || !matchType) {
        return res.status(400).json({
          error: 'Missing required fields: patternName, patternRegex, matchType'
        });
      }

      // Validate regex
      try {
        new RegExp(patternRegex);
      } catch (e) {
        return res.status(400).json({
          error: 'Invalid regex pattern',
          details: e.message
        });
      }

      const insertResult = await client.query(
        `INSERT INTO duplicate_patterns (
          pattern_name,
          pattern_regex,
          description,
          match_type,
          override_category,
          is_user_defined,
          confidence,
          notes
        ) VALUES ($1, $2, $3, $4, $5, true, 1.0, $6)
        RETURNING *`,
        [patternName, patternRegex, description, matchType, overrideCategory, notes]
      );

      return res.status(201).json({
        message: 'Pattern created successfully',
        pattern: insertResult.rows[0]
      });
    }

    // PUT - Update pattern
    if (req.method === 'PUT') {
      const {
        id,
        patternName,
        patternRegex,
        description,
        matchType,
        overrideCategory,
        isActive,
        notes
      } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Pattern ID required' });
      }

      // Validate regex if provided
      if (patternRegex) {
        try {
          new RegExp(patternRegex);
        } catch (e) {
          return res.status(400).json({
            error: 'Invalid regex pattern',
            details: e.message
          });
        }
      }

      const updateResult = await client.query(
        `UPDATE duplicate_patterns
         SET
           pattern_name = COALESCE($1, pattern_name),
           pattern_regex = COALESCE($2, pattern_regex),
           description = COALESCE($3, description),
           match_type = COALESCE($4, match_type),
           override_category = $5,
           is_active = COALESCE($6, is_active),
           notes = $7
         WHERE id = $8
         RETURNING *`,
        [patternName, patternRegex, description, matchType, overrideCategory, isActive, notes, id]
      );

      if (updateResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pattern not found' });
      }

      return res.status(200).json({
        message: 'Pattern updated successfully',
        pattern: updateResult.rows[0]
      });
    }

    // DELETE - Delete pattern
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Pattern ID required' });
      }

      const deleteResult = await client.query(
        `DELETE FROM duplicate_patterns WHERE id = $1 RETURNING *`,
        [id]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pattern not found' });
      }

      return res.status(200).json({
        message: 'Pattern deleted successfully',
        pattern: deleteResult.rows[0]
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error managing patterns:', error);
    res.status(500).json({
      error: 'Failed to manage patterns',
      details: error.message
    });
  } finally {
    client.release();
  }
}
