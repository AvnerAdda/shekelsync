const actualDatabase = require('../database.js');

let database = actualDatabase;

const VALID_TYPES = new Set(['loan', 'credit_line', 'tax', 'other']);

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function nullableNumber(value, field, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw serviceError(400, `${field} must be a number greater than or equal to ${min}`);
  }
  return parsed;
}

function normalizeBoolean(value, field, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw serviceError(400, `${field} must be a boolean`);
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const normalized = String(value).slice(0, 10);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(normalized)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw serviceError(400, 'as_of_date must be a valid YYYY-MM-DD date');
  }
  return normalized;
}

function normalizeType(value) {
  const type = String(value || 'other').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) {
    throw serviceError(400, `Invalid liability_type. Use: ${Array.from(VALID_TYPES).join(', ')}`);
  }
  return type;
}

function normalizeRow(row) {
  return {
    ...row,
    id: Number(row.id),
    balance: Number(row.balance),
    interest_rate: row.interest_rate == null ? null : Number(row.interest_rate),
    monthly_payment: row.monthly_payment == null ? null : Number(row.monthly_payment),
    included_in_net_worth: Boolean(Number(row.included_in_net_worth)),
    is_active: Boolean(Number(row.is_active)),
  };
}

async function listLiabilities(params = {}) {
  const includeInactive = params.includeInactive === true
    || params.includeInactive === 'true'
    || params.include_inactive === true
    || params.include_inactive === 'true';
  const result = await database.query(
    `SELECT *
       FROM investment_liabilities
      ${includeInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY is_active DESC, as_of_date DESC, liability_name ASC`,
    [],
  );
  return { liabilities: (result.rows || []).map(normalizeRow) };
}

async function createLiability(payload = {}) {
  const name = String(payload.liability_name || payload.name || '').trim();
  if (!name) throw serviceError(400, 'liability_name is required');

  const balance = nullableNumber(payload.balance, 'balance');
  if (balance === null) throw serviceError(400, 'balance is required');

  const currency = String(payload.currency || 'ILS').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw serviceError(400, 'currency must be a three-letter code');

  const result = await database.query(
    `INSERT INTO investment_liabilities (
       liability_name, liability_type, balance, currency, interest_rate,
       monthly_payment, as_of_date, included_in_net_worth, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      name,
      normalizeType(payload.liability_type),
      balance,
      currency,
      nullableNumber(payload.interest_rate, 'interest_rate'),
      nullableNumber(payload.monthly_payment, 'monthly_payment'),
      normalizeDate(payload.as_of_date),
      normalizeBoolean(payload.included_in_net_worth, 'included_in_net_worth', true) ? 1 : 0,
      String(payload.notes || '').trim() || null,
    ],
  );

  return { liability: normalizeRow(result.rows[0]) };
}

async function updateLiability(payload = {}) {
  const id = Number(payload.id || payload.liability_id);
  if (!Number.isInteger(id) || id <= 0) throw serviceError(400, 'Liability id is required');

  const updates = [];
  const values = [];
  const add = (column, value) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  if (payload.liability_name !== undefined || payload.name !== undefined) {
    const name = String(payload.liability_name ?? payload.name).trim();
    if (!name) throw serviceError(400, 'liability_name cannot be empty');
    add('liability_name', name);
  }
  if (payload.liability_type !== undefined) add('liability_type', normalizeType(payload.liability_type));
  if (payload.balance !== undefined) {
    const balance = nullableNumber(payload.balance, 'balance');
    if (balance === null) throw serviceError(400, 'balance is required');
    add('balance', balance);
  }
  if (payload.currency !== undefined) {
    const currency = String(payload.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw serviceError(400, 'currency must be a three-letter code');
    add('currency', currency);
  }
  if (payload.interest_rate !== undefined) add('interest_rate', nullableNumber(payload.interest_rate, 'interest_rate'));
  if (payload.monthly_payment !== undefined) add('monthly_payment', nullableNumber(payload.monthly_payment, 'monthly_payment'));
  if (payload.as_of_date !== undefined) add('as_of_date', normalizeDate(payload.as_of_date));
  if (payload.included_in_net_worth !== undefined) {
    add(
      'included_in_net_worth',
      normalizeBoolean(payload.included_in_net_worth, 'included_in_net_worth', true) ? 1 : 0,
    );
  }
  if (payload.notes !== undefined) add('notes', String(payload.notes || '').trim() || null);
  if (payload.is_active !== undefined) {
    add('is_active', normalizeBoolean(payload.is_active, 'is_active', true) ? 1 : 0);
  }

  if (updates.length === 0) throw serviceError(400, 'No fields to update');
  values.push(id);
  const result = await database.query(
    `UPDATE investment_liabilities
        SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${values.length}
      RETURNING *`,
    values,
  );
  if (!result.rows?.length) throw serviceError(404, 'Liability not found');
  return { liability: normalizeRow(result.rows[0]) };
}

async function deactivateLiability(params = {}) {
  const id = Number(params.id || params.liability_id);
  if (!Number.isInteger(id) || id <= 0) throw serviceError(400, 'Liability id is required');
  const result = await database.query(
    `UPDATE investment_liabilities
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  if (!result.rows?.length) throw serviceError(404, 'Liability not found');
  return { liability: normalizeRow(result.rows[0]) };
}

module.exports = {
  VALID_TYPES,
  listLiabilities,
  createLiability,
  updateLiability,
  deactivateLiability,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
