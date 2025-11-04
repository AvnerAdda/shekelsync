const database = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function tableExists(client) {
  if (dialect.useSqlite) {
    const result = await client.query(
      `SELECT COUNT(*) AS count
         FROM sqlite_master
        WHERE type = 'table' AND name = 'duplicate_patterns'`,
    );
    return Number.parseInt(result.rows[0]?.count || 0, 10) > 0;
  }

  const result = await client.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_name = 'duplicate_patterns'`,
  );
  return Number.parseInt(result.rows[0]?.count || 0, 10) > 0;
}

async function hasOverrideCategoryColumn(client) {
  if (dialect.useSqlite) {
    const pragma = await client.query(
      `SELECT sql
         FROM sqlite_master
        WHERE type = 'table' AND name = 'duplicate_patterns'`,
    );
    const sql = pragma.rows[0]?.sql || '';
    return sql.includes('override_category_definition_id');
  }

  const result = await client.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.columns
      WHERE table_name = 'duplicate_patterns'
        AND column_name = 'override_category_definition_id'`,
  );
  return Number.parseInt(result.rows[0]?.count || 0, 10) > 0;
}

async function ensurePatternsTable(client) {
  const exists = await tableExists(client);
  if (!exists) {
    throw serviceError(500, 'Pattern detection not available. Run migration first.');
  }
}

async function listPatterns(params = {}) {
  const client = await database.getClient();

  try {
    await ensurePatternsTable(client);

    const includeInactive = params.includeInactive === 'true' || params.includeInactive === true;
    const hasOverride = await hasOverrideCategoryColumn(client);

    const overrideColumns = hasOverride
      ? `
        dp.override_category_definition_id,
        cd.name AS override_category_name`
      : '';
    const overrideJoin = hasOverride
      ? `
      LEFT JOIN category_definitions cd ON cd.id = dp.override_category_definition_id`
      : '';

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
        dp.created_at${overrideColumns}
      FROM duplicate_patterns dp${overrideJoin}
    `;

    if (!includeInactive) {
      query += ' WHERE dp.is_active = true';
    }

    query += ' ORDER BY dp.is_active DESC, dp.confidence DESC, dp.match_count DESC';

    const result = await client.query(query);
    return { patterns: result.rows };
  } finally {
    client.release();
  }
}

async function validateOverrideCategory(client, overrideCategoryDefinitionId) {
  if (overrideCategoryDefinitionId === null || overrideCategoryDefinitionId === undefined) {
    return { overrideCategoryId: null, overrideCategory: null };
  }

  const result = await client.query(
    `SELECT id, name, category_type
       FROM category_definitions
      WHERE id = $1`,
    [overrideCategoryDefinitionId],
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Override category not found');
  }

  if (result.rows[0].category_type !== 'expense') {
    throw serviceError(400, 'Override category must be an expense category');
  }

  return {
    overrideCategoryId: result.rows[0].id,
    overrideCategory: result.rows[0].name,
  };
}

function validateRegex(patternRegex) {
  if (!patternRegex) return;
  try {
    // eslint-disable-next-line no-new
    new RegExp(patternRegex);
  } catch (error) {
    throw serviceError(400, `Invalid regex pattern: ${error.message}`);
  }
}

async function createPattern(payload = {}) {
  const {
    patternName,
    patternRegex,
    description,
    matchType,
    overrideCategoryDefinitionId,
    notes,
  } = payload;

  if (!patternName || !patternRegex || !matchType) {
    throw serviceError(400, 'Missing required fields: patternName, patternRegex, matchType');
  }

  validateRegex(patternRegex);

  const client = await database.getClient();

  try {
    await ensurePatternsTable(client);

    const { overrideCategoryId, overrideCategory } = await validateOverrideCategory(
      client,
      overrideCategoryDefinitionId,
    );

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
      [patternName, patternRegex, description || null, matchType, overrideCategory, overrideCategoryId, notes || null],
    );

    return {
      message: 'Pattern created successfully',
      pattern: insertResult.rows[0],
    };
  } finally {
    client.release();
  }
}

async function updatePattern(payload = {}) {
  const {
    id,
    patternName,
    patternRegex,
    description,
    matchType,
    overrideCategoryDefinitionId,
    isActive,
    notes,
  } = payload;

  if (!id) {
    throw serviceError(400, 'Pattern ID required');
  }

  validateRegex(patternRegex);

  const client = await database.getClient();

  try {
    await ensurePatternsTable(client);

    let overrideCategoryId = undefined;
    let overrideCategory = undefined;

    if (overrideCategoryDefinitionId !== undefined) {
      if (overrideCategoryDefinitionId === null) {
        overrideCategoryId = null;
        overrideCategory = null;
      } else {
        const resolved = await validateOverrideCategory(client, overrideCategoryDefinitionId);
        overrideCategoryId = resolved.overrideCategoryId;
        overrideCategory = resolved.overrideCategory;
      }
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (patternName !== undefined) {
      updates.push(`pattern_name = $${idx++}`);
      values.push(patternName);
    }
    if (patternRegex !== undefined) {
      updates.push(`pattern_regex = $${idx++}`);
      values.push(patternRegex);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description);
    }
    if (matchType !== undefined) {
      updates.push(`match_type = $${idx++}`);
      values.push(matchType);
    }
    if (overrideCategory !== undefined) {
      updates.push(`override_category = $${idx++}`);
      values.push(overrideCategory);
    }
    if (overrideCategoryId !== undefined) {
      updates.push(`override_category_definition_id = $${idx++}`);
      values.push(overrideCategoryId);
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(isActive);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(notes);
    }

    if (updates.length === 0) {
      throw serviceError(400, 'No fields to update');
    }

    values.push(id);

    const result = await client.query(
      `UPDATE duplicate_patterns
          SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${idx}
        RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      throw serviceError(404, 'Pattern not found');
    }

    return {
      message: 'Pattern updated successfully',
      pattern: result.rows[0],
    };
  } finally {
    client.release();
  }
}

async function deletePattern(params = {}) {
  const id = params.id || params.patternId;

  if (!id) {
    throw serviceError(400, 'Pattern ID required');
  }

  const client = await database.getClient();

  try {
    await ensurePatternsTable(client);

    const result = await client.query(
      'DELETE FROM duplicate_patterns WHERE id = $1 RETURNING *',
      [id],
    );

    if (result.rows.length === 0) {
      throw serviceError(404, 'Pattern not found');
    }

    return {
      message: 'Pattern deleted successfully',
      pattern: result.rows[0],
    };
  } finally {
    client.release();
  }
}

module.exports = {
  listPatterns,
  createPattern,
  updatePattern,
  deletePattern,
};

module.exports.default = module.exports;
