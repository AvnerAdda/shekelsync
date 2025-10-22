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
    // Check if table exists (SQLite compatible)
    const tableCheck = await client.query(`
      SELECT COUNT(*) as count
      FROM sqlite_master
      WHERE type = 'table' AND name = 'duplicate_patterns'
    `);

    if (parseInt(tableCheck.rows[0].count) === 0) {
      return res.status(500).json({
        error: 'Pattern detection not available. Run migration first.'
      });
    }

    // GET - List patterns
    if (req.method === 'GET') {
      const { includeInactive = 'false' } = req.query;

      // Check if override_category_definition_id column exists
      const columnsCheck = await client.query(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='duplicate_patterns'
      `);
      const hasOverrideCategoryDefId = columnsCheck.rows[0]?.sql?.includes('override_category_definition_id');

      let query = `
        SELECT
          dp.id,
          dp.pattern_name,
          dp.pattern_regex,
          dp.description,
          dp.match_type,
          dp.is_user_defined,
          dp.is_auto_learned,
          dp.is_active,
          dp.confidence,
          dp.match_count,
          dp.last_matched_at,
          dp.created_at${hasOverrideCategoryDefId ? `,
          dp.override_category_definition_id,
          cd.name AS override_category_name` : ''}
        FROM duplicate_patterns dp${hasOverrideCategoryDefId ? `
        LEFT JOIN category_definitions cd ON cd.id = dp.override_category_definition_id` : ''}
      `;

      if (includeInactive === 'false') {
        query += ` WHERE dp.is_active = true`;
      }

      query += ` ORDER BY dp.is_active DESC, dp.confidence DESC, dp.match_count DESC`;

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
        overrideCategoryDefinitionId,
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

      let overrideCategory = null;
      let overrideCategoryId = null;
      if (overrideCategoryDefinitionId !== null && overrideCategoryDefinitionId !== undefined) {
        const categoryResult = await client.query(
          `SELECT id, name, category_type FROM category_definitions WHERE id = $1`,
          [overrideCategoryDefinitionId]
        );

        if (categoryResult.rows.length === 0) {
          return res.status(404).json({ error: 'Override category not found' });
        }

        if (categoryResult.rows[0].category_type !== 'expense') {
          return res.status(400).json({ error: 'Override category must be an expense category' });
        }

        overrideCategoryId = categoryResult.rows[0].id;
        overrideCategory = categoryResult.rows[0].name;
      }

      const insertResult = await client.query(
        `INSERT INTO duplicate_patterns (
          pattern_name,
          pattern_regex,
          description,
          match_type,
          override_category,
          override_category_definition_id,
          is_user_defined,
          confidence,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6, true, 1.0, $7)
        RETURNING *`,
        [patternName, patternRegex, description, matchType, overrideCategory, overrideCategoryId, notes]
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
        overrideCategoryDefinitionId,
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

      let overrideCategory = null;
      let overrideCategoryId = null;
      if (overrideCategoryDefinitionId !== undefined) {
        if (overrideCategoryDefinitionId !== null) {
          const categoryResult = await client.query(
            `SELECT id, name, category_type FROM category_definitions WHERE id = $1`,
            [overrideCategoryDefinitionId]
          );

          if (categoryResult.rows.length === 0) {
            return res.status(404).json({ error: 'Override category not found' });
          }

          if (categoryResult.rows[0].category_type !== 'expense') {
            return res.status(400).json({ error: 'Override category must be an expense category' });
          }

          overrideCategoryId = categoryResult.rows[0].id;
          overrideCategory = categoryResult.rows[0].name;
        }
      }

      const updateResult = await client.query(
        `UPDATE duplicate_patterns
         SET
           pattern_name = COALESCE($1, pattern_name),
           pattern_regex = COALESCE($2, pattern_regex),
           description = COALESCE($3, description),
           match_type = COALESCE($4, match_type),
           override_category = COALESCE($5, override_category),
           override_category_definition_id = COALESCE($6, override_category_definition_id),
           is_active = COALESCE($7, is_active),
           notes = $8
         WHERE id = $9
         RETURNING *`,
        [patternName, patternRegex, description, matchType, overrideCategory, overrideCategoryId, isActive, notes, id]
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
