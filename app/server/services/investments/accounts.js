const database = require('../database.js');
const {
  INSTITUTION_JOIN_INVESTMENT_ACCOUNT,
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  mapVendorCodeToInstitutionId,
  getInstitutionById,
  getInstitutionByVendorCode,
} = require('../institutions.js');

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
  'insurance',
  'bank_balance',
  'cash',
  'foreign_bank',
  'foreign_investment',
  'other',
]);

const LIQUID_TYPES = new Set(['brokerage', 'crypto', 'mutual_fund', 'bonds', 'real_estate', 'savings']);
const RESTRICTED_TYPES = new Set(['pension', 'provident', 'study_fund']);
const STABILITY_TYPES = new Set(['insurance']);
const CASH_TYPES = new Set(['bank_balance', 'cash', 'foreign_bank', 'foreign_investment', 'other']);

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
      ${INSTITUTION_SELECT_FIELDS},
      COUNT(DISTINCT ih.id) AS holdings_count,
      MAX(ih.as_of_date) AS last_update_date,
      (
        SELECT current_value
        FROM investment_holdings
        WHERE account_id = ia.id
        ORDER BY as_of_date DESC
        LIMIT 1
      ) AS current_value,
      (
        SELECT SUM(ABS(t.price))
        FROM transaction_account_links tal
        JOIN transactions t ON tal.transaction_identifier = t.identifier
          AND tal.transaction_vendor = t.vendor
        WHERE tal.account_id = ia.id
      ) AS total_invested
    FROM investment_accounts ia
    ${INSTITUTION_JOIN_INVESTMENT_ACCOUNT}
    LEFT JOIN investment_holdings ih ON ia.id = ih.account_id
    ${whereClause}
    GROUP BY ia.id, fi.id, fi.vendor_code, fi.display_name_he, fi.display_name_en,
             fi.institution_type, fi.category, fi.subcategory, fi.logo_url,
             fi.is_scrapable, fi.scraper_company_id
    ORDER BY ia.investment_category, ia.account_type, ia.account_name
  `;

  const result = await database.query(query, values);

  const accounts = await Promise.all(
    result.rows.map(async (row) => {
      const explicitValue = row.current_value ? Number.parseFloat(row.current_value) : null;
      const totalInvested = row.total_invested ? Number.parseFloat(row.total_invested) : null;
      let institution = buildInstitutionFromRow(row);

      if (!institution && row.account_type) {
        institution = await getInstitutionByVendorCode(database, row.account_type);
      }

      return {
        ...row,
        current_value: explicitValue || totalInvested, // Use explicit value if set, otherwise use sum of transactions
        current_value_explicit: explicitValue, // Keep track of whether it was explicitly set
        total_invested: totalInvested,
        holdings_count: Number.parseInt(row.holdings_count, 10),
        is_liquid: row.is_liquid,
        investment_category: row.investment_category,
        institution: institution || null, // Add institution object
      };
    }),
  );

  return { accounts };
}

async function createAccount(payload = {}) {
  const {
    account_name,
    account_type,
    institution,
    institution_id,
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

  // Map between account_type and institution_id
  let institutionIdValue = institution_id;
  let accountTypeValue = account_type;

  if (!institutionIdValue && accountTypeValue) {
    // Auto-map account_type (e.g., 'pension') to institution_id
    institutionIdValue = await mapVendorCodeToInstitutionId(database, accountTypeValue);
  } else if (institutionIdValue && !accountTypeValue) {
    // If only institution_id provided, get vendor_code for account_type
    const inst = await getInstitutionById(database, institutionIdValue);
    if (inst) {
      accountTypeValue = inst.vendor_code;
    }
  }

  let isLiquid = null;
  let investmentCategory = null;

  if (LIQUID_TYPES.has(accountTypeValue)) {
    isLiquid = true;
    investmentCategory = 'liquid';
  } else if (RESTRICTED_TYPES.has(accountTypeValue)) {
    isLiquid = false;
    investmentCategory = 'restricted';
  } else if (STABILITY_TYPES.has(accountTypeValue)) {
    isLiquid = false;
    investmentCategory = 'stability';
  } else if (CASH_TYPES.has(accountTypeValue)) {
    isLiquid = true;
    investmentCategory = 'cash';
  }

  if (!institutionIdValue) {
    throw serviceError(400, 'institution_id is required. Please select a known institution.');
  }

  const result = await database.query(
    `
      INSERT INTO investment_accounts (
        account_name, account_type, institution, account_number, currency, notes,
        is_liquid, investment_category, institution_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      account_name,
      accountTypeValue,
      institution || null,
      account_number || null,
      currency,
      notes || null,
      isLiquid,
      investmentCategory,
      institutionIdValue,
    ],
  );

  // Fetch with institution data
  const accountWithInstitution = await database.query(
    `
      SELECT ia.*, ${INSTITUTION_SELECT_FIELDS}
      FROM investment_accounts ia
      ${INSTITUTION_JOIN_INVESTMENT_ACCOUNT}
      WHERE ia.id = $1
    `,
    [result.rows[0].id]
  );

  const row = accountWithInstitution.rows[0];
  return {
    account: {
      ...row,
      institution: buildInstitutionFromRow(row),
    },
  };
}

async function updateAccount(payload = {}) {
  const {
    id,
    account_name,
    account_type,
    institution,
    institution_id,
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
    } else if (STABILITY_TYPES.has(account_type)) {
      updates.push(`is_liquid = $${paramIndex++}`);
      values.push(false);
      updates.push(`investment_category = $${paramIndex++}`);
      values.push('stability');
    } else if (CASH_TYPES.has(account_type)) {
      updates.push(`is_liquid = $${paramIndex++}`);
      values.push(true);
      updates.push(`investment_category = $${paramIndex++}`);
      values.push('cash');
    }

    // Auto-update institution_id when account_type changes
    if (account_type) {
      const instId = await mapVendorCodeToInstitutionId(database, account_type);
      if (instId) {
        updates.push(`institution_id = $${paramIndex++}`);
        values.push(instId);
      }
    }
  }

  if (institution !== undefined) {
    updates.push(`institution = $${paramIndex++}`);
    values.push(institution);
  }

  if (institution_id !== undefined) {
    if (institution_id === null) {
      throw serviceError(400, 'institution_id is required when updating an investment account');
    }
    updates.push(`institution_id = $${paramIndex++}`);
    values.push(institution_id);
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

  // Fetch with institution data
  const accountWithInstitution = await database.query(
    `
      SELECT ia.*, ${INSTITUTION_SELECT_FIELDS}
      FROM investment_accounts ia
      ${INSTITUTION_JOIN_INVESTMENT_ACCOUNT}
      WHERE ia.id = $1
    `,
    [id]
  );

  const row = accountWithInstitution.rows[0];
  return {
    account: {
      ...row,
      institution: buildInstitutionFromRow(row),
    },
  };
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
