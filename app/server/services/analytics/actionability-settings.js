const database = require('../database.js');
const { getCategoryInfo } = require('../../../lib/category-helpers.js');

async function listSettings() {
  const result = await database.query(
    `
      SELECT
        cas.id,
        cas.category_definition_id,
        cas.actionability_level,
        cas.monthly_average,
        cas.transaction_count,
        cas.is_default,
        cas.user_notes,
        cas.created_at,
        cas.updated_at,
        cd.name AS subcategory,
        cd.name_en AS subcategory_en,
        parent.name AS parent_category,
        parent.name_en AS parent_category_en
      FROM category_actionability_settings cas
      JOIN category_definitions cd ON cd.id = cas.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      ORDER BY cas.monthly_average DESC, cd.display_order
    `,
  );

  return result.rows;
}

function normalizeSettingPayload(setting = {}) {
  const {
    category_definition_id: categoryDefinitionId,
    actionability_level: actionabilityLevel,
    monthly_average: monthlyAverage,
    transaction_count: transactionCount,
    user_notes: userNotes,
    is_default: isDefault,
  } = setting;

  return {
    categoryDefinitionId,
    actionabilityLevel,
    monthlyAverage,
    transactionCount,
    userNotes,
    isDefault,
  };
}

async function upsertSetting(client, setting) {
  const payload = normalizeSettingPayload(setting);

  if (!payload.categoryDefinitionId) {
    const error = new Error('category_definition_id is required');
    error.status = 400;
    throw error;
  }

  const result = await client.query(
    `
      INSERT INTO category_actionability_settings (
        category_definition_id,
        actionability_level,
        monthly_average,
        transaction_count,
        user_notes,
        is_default
      ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, false))
      ON CONFLICT (category_definition_id)
      DO UPDATE SET
        actionability_level = EXCLUDED.actionability_level,
        monthly_average = EXCLUDED.monthly_average,
        transaction_count = EXCLUDED.transaction_count,
        user_notes = EXCLUDED.user_notes,
        is_default = EXCLUDED.is_default,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    [
      payload.categoryDefinitionId,
      payload.actionabilityLevel || null,
      payload.monthlyAverage || null,
      payload.transactionCount || null,
      payload.userNotes || null,
      payload.isDefault || null,
    ],
  );

  return result.rows[0];
}

async function bulkUpsertSettings({ settings } = {}) {
  if (!Array.isArray(settings)) {
    const error = new Error('Settings array required');
    error.status = 400;
    throw error;
  }

  const client = await database.getClient();
  try {
    await client.query('BEGIN');

    const results = [];
    for (const setting of settings) {
      const upserted = await upsertSetting(client, setting);
      results.push(upserted);
    }

    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateSetting(setting = {}) {
  const payload = normalizeSettingPayload(setting);

  if (!payload.categoryDefinitionId) {
    const error = new Error('category_definition_id is required');
    error.status = 400;
    throw error;
  }

  const result = await database.query(
    `
      UPDATE category_actionability_settings
      SET
        actionability_level = COALESCE($2, actionability_level),
        monthly_average = COALESCE($3, monthly_average),
        transaction_count = COALESCE($4, transaction_count),
        user_notes = COALESCE($5, user_notes),
        is_default = COALESCE($6, is_default),
        updated_at = CURRENT_TIMESTAMP
      WHERE category_definition_id = $1
      RETURNING *
    `,
    [
      payload.categoryDefinitionId,
      payload.actionabilityLevel || null,
      payload.monthlyAverage || null,
      payload.transactionCount || null,
      payload.userNotes || null,
      payload.isDefault || null,
    ],
  );

  return result.rows[0];
}

async function resetSettings() {
  await database.query('TRUNCATE category_actionability_settings');
  return { success: true };
}

async function getCategoryInfoWithFallback(categoryDefinitionId) {
  if (!categoryDefinitionId) {
    return null;
  }

  return getCategoryInfo(categoryDefinitionId);
}

module.exports = {
  listSettings,
  bulkUpsertSettings,
  updateSetting,
  resetSettings,
  getCategoryInfoWithFallback,
};
