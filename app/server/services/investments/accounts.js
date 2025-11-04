const database = require('../database.js');

const VALID_TYPES = new Set([
  'pension',
  'provident',
  'study_fund',
  'savings',
  'brokerage',
  'crypto',
  'mutual_fund',
  'bonds',
  'real_estate',
  'other',
]);

const LIQUID_TYPES = new Set(['brokerage', 'crypto', 'mutual_fund', 'bonds', 'real_estate', 'savings', 'other']);
const RESTRICTED_TYPES = new Set(['pension', 'provident', 'study_fund']);

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

async function listAccounts(params = {}) {
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === true;
  const category = params.category;

  const filters = [];
  const values = [];

  if (!includeInactive) {
    filters.push('ia.is_active = true');
  }

  if (category && (category === 'liquid' || category === 'restricted')) {
    filters.push('ia.investment_category = $' + (values.length + 1));
    values.push(category);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const query = `
    SELECT
      ia.*,
      COUNT(DISTINCT ih.id) AS holdings_count,
      MAX(ih.as_of_date) AS last_update_date,
      (
        SELECT current_value
        FROM investment_holdings
        WHERE account_id = ia.id
        ORDER BY as_of_date DESC
        LIMIT 1
      ) AS current_value
    FROM investment_accounts ia
    LEFT JOIN investment_holdings ih ON ia.id = ih.account_id
    ${whereClause}
    GROUP BY ia.id
    ORDER BY ia.investment_category, ia.account_type, ia.account_name
  `;

  const result = await database.query(query, values);

  return {
    accounts: result.rows.map((row) => ({
      ...row,
      current_value: row.current_value ? Number.parseFloat(row.current_value) : null,
      holdings_count: Number.parseInt(row.holdings_count, 10),
      is_liquid: row.is_liquid,
      investment_category: row.investment_category,
    })),
  };
}

async function createAccount(payload = {}) {
  const {
    account_name,
    account_type,
    institution,
    account_number,
    currency = 'ILS',
    notes,
  } = payload;

  if (!account_name || !account_type) {
    throw serviceError(400, 'account_name and account_type are required');
  }

  if (!VALID_TYPES.has(account_type)) {
    throw serviceError(400, `Invalid account_type. Must be one of: ${Array.from(VALID_TYPES).join(', ')}`);
  }

  let isLiquid = null;
  let investmentCategory = null;

  if (LIQUID_TYPES.has(account_type)) {
    isLiquid = true;
    investmentCategory = 'liquid';
  } else if (RESTRICTED_TYPES.has(account_type)) {
    isLiquid = false;
    investmentCategory = 'restricted';
  }

  const result = await database.query(
    `
      INSERT INTO investment_accounts (
        account_name, account_type, institution, account_number, currency, notes,
        is_liquid, investment_category
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      account_name,
      account_type,
      institution || null,
      account_number || null,
      currency,
      notes || null,
      isLiquid,
      investmentCategory,
    ],
  );

  return { account: result.rows[0] };
}

async function updateAccount(payload = {}) {
  const {
    id,
    account_name,
    account_type,
    institution,
    account_number,
    currency,
    is_active,
    notes,
  } = payload;

  if (!id) {
    throw serviceError(400, 'Account id is required');
  }

  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (account_name !== undefined) {
    updates.push(`account_name = $${paramIndex++}`);
    values.push(account_name);
  }

  if (account_type !== undefined) {
    if (!VALID_TYPES.has(account_type)) {
      throw serviceError(400, `Invalid account_type. Must be one of: ${Array.from(VALID_TYPES).join(', ')}`);
    }

    updates.push(`account_type = $${paramIndex++}`);
    values.push(account_type);

    if (LIQUID_TYPES.has(account_type)) {
      updates.push(`is_liquid = $${paramIndex++}`);
      values.push(true);
      updates.push(`investment_category = $${paramIndex++}`);
      values.push('liquid');
    } else if (RESTRICTED_TYPES.has(account_type)) {
      updates.push(`is_liquid = $${paramIndex++}`);
      values.push(false);
      updates.push(`investment_category = $${paramIndex++}`);
      values.push('restricted');
    }
  }

  if (institution !== undefined) {
    updates.push(`institution = $${paramIndex++}`);
    values.push(institution);
  }

  if (account_number !== undefined) {
    updates.push(`account_number = $${paramIndex++}`);
    values.push(account_number);
  }

  if (currency !== undefined) {
    updates.push(`currency = $${paramIndex++}`);
    values.push(currency);
  }

  if (is_active !== undefined) {
    const normalizedActive = coerceBoolean(is_active);
    if (normalizedActive === undefined) {
      throw serviceError(400, 'is_active must be a boolean');
    }
    updates.push(`is_active = $${paramIndex++}`);
    values.push(normalizedActive);
  }

  if (notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    values.push(notes);
  }

  if (updates.length === 0) {
    throw serviceError(400, 'No fields to update');
  }

  values.push(id);
  const result = await database.query(
    `
      UPDATE investment_accounts
         SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramIndex}
       RETURNING *
    `,
    values,
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Account not found');
  }

  return { account: result.rows[0] };
}

async function deactivateAccount(params = {}) {
  const id = params.id || params.account_id;

  if (!id) {
    throw serviceError(400, 'Account id is required');
  }

  const result = await database.query(
    'UPDATE investment_accounts SET is_active = false WHERE id = $1 RETURNING *',
    [id],
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Account not found');
  }

  return {
    message: 'Account deactivated',
    account: result.rows[0],
  };
}

module.exports = {
  listAccounts,
  createAccount,
  updateAccount,
  deactivateAccount,
};

module.exports.default = module.exports;
