const actualDatabase = require('../database.js');
const { CATEGORY_KEYS } = require('./categories.js');

let database = actualDatabase;

const VALID_SCOPES = new Set(['exclude_real_estate', 'all']);
const TARGET_TOLERANCE = 0.01;

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeScope(value) {
  const scope = String(value || 'exclude_real_estate').trim().toLowerCase();
  if (!VALID_SCOPES.has(scope)) {
    throw serviceError(400, `Invalid allocation scope. Use: ${Array.from(VALID_SCOPES).join(', ')}`);
  }
  return scope;
}

function normalizeTargets(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw serviceError(400, 'targets must contain at least one category target');
  }

  const seen = new Set();
  const targets = input.map((target) => {
    const category = String(target?.category || '').trim().toLowerCase();
    const rawPercentage = target?.target_percentage ?? target?.targetPercentage;
    const targetPercentage = Number(rawPercentage);

    if (!CATEGORY_KEYS.includes(category)) {
      throw serviceError(400, `Invalid target category: ${category || '(empty)'}`);
    }
    if (seen.has(category)) {
      throw serviceError(400, `Duplicate target category: ${category}`);
    }
    if (!Number.isFinite(targetPercentage) || targetPercentage < 0 || targetPercentage > 100) {
      throw serviceError(400, `Target for ${category} must be between 0 and 100`);
    }

    seen.add(category);
    return {
      category,
      targetPercentage: Math.round(targetPercentage * 100) / 100,
    };
  });

  const total = targets.reduce((sum, target) => sum + target.targetPercentage, 0);
  if (Math.abs(total - 100) > TARGET_TOLERANCE) {
    throw serviceError(400, `Allocation targets must total 100%. Current total: ${total.toFixed(2)}%`);
  }

  return targets;
}

function normalizeRow(row) {
  return {
    scope: row.scope,
    category: row.category,
    targetPercentage: Number(row.target_percentage),
    updatedAt: row.updated_at || null,
  };
}

async function listTargets(params = {}) {
  const scope = normalizeScope(params.scope);
  const result = await database.query(
    `SELECT scope, category, target_percentage, updated_at
       FROM investment_allocation_targets
      WHERE scope = $1
      ORDER BY category ASC`,
    [scope],
  );
  const targets = (result.rows || []).map(normalizeRow);

  return {
    scope,
    configured: targets.length > 0,
    totalPercentage: targets.reduce((sum, target) => sum + target.targetPercentage, 0),
    targets,
  };
}

async function replaceTargets(payload = {}) {
  const scope = normalizeScope(payload.scope);
  const targets = normalizeTargets(payload.targets);
  const client = typeof database.getClient === 'function'
    ? await database.getClient()
    : {
        query: (...args) => database.query(...args),
        release: () => {},
      };

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM investment_allocation_targets WHERE scope = $1', [scope]);
    for (const target of targets) {
      await client.query(
        `INSERT INTO investment_allocation_targets (
           scope, category, target_percentage, updated_at
         ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [scope, target.category, target.targetPercentage],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release?.();
  }

  return listTargets({ scope });
}

async function clearTargets(params = {}) {
  const scope = normalizeScope(params.scope);
  await database.query('DELETE FROM investment_allocation_targets WHERE scope = $1', [scope]);
  return { scope, configured: false, totalPercentage: 0, targets: [] };
}

module.exports = {
  VALID_SCOPES,
  listTargets,
  replaceTargets,
  clearTargets,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
