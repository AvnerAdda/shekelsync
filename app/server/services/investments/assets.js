const actualDatabase = require('../database.js');
let database = actualDatabase;
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  getInstitutionByVendorCode,
} = require('../institutions.js');

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function listAssets(params = {}) {
  const accountId = params.accountId || params.account_id;
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === true;

  const filters = [];
  const values = [];

  if (accountId) {
    filters.push('iasset.account_id = $' + (values.length + 1));
    values.push(accountId);
  }

  if (!includeInactive) {
    filters.push('iasset.is_active = true');
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const query = `
    SELECT
      iasset.*,
      ia.account_name,
      ia.account_type,
      ia.institution,
      ${INSTITUTION_SELECT_FIELDS}
    FROM investment_assets iasset
    JOIN investment_accounts ia ON iasset.account_id = ia.id
    LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
    ${whereClause}
    ORDER BY ia.account_name, iasset.asset_name
  `;

  const result = await database.query(query, values);

  const assets = await Promise.all(
    result.rows.map(async (row) => {
      let institution = buildInstitutionFromRow(row);
      if (!institution && row.account_type) {
        institution = await getInstitutionByVendorCode(database, row.account_type);
      }

      return {
        ...row,
        units: row.units !== null ? Number.parseFloat(row.units) : null,
        average_cost: row.average_cost !== null ? Number.parseFloat(row.average_cost) : null,
        institution: institution || null,
      };
    }),
  );

  return { assets };
}

async function verifyAccount(accountId) {
  const checkResult = await database.query(
    'SELECT id FROM investment_accounts WHERE id = $1',
    [accountId],
  );

  if (checkResult.rows.length === 0) {
    throw serviceError(404, 'Account not found');
  }
}

async function createAsset(payload = {}) {
  const {
    account_id,
    asset_symbol,
    asset_name,
    asset_type,
    units,
    average_cost,
    currency = 'USD',
    notes,
  } = payload;

  if (!account_id || !asset_name || units === undefined) {
    throw serviceError(400, 'account_id, asset_name, and units are required');
  }

  await verifyAccount(account_id);

  const insertResult = await database.query(
    `
      INSERT INTO investment_assets (
        account_id, asset_symbol, asset_name, asset_type,
        units, average_cost, currency, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      account_id,
      asset_symbol || null,
      asset_name,
      asset_type || null,
      units,
      average_cost || null,
      currency,
      notes || null,
    ],
  );

  const row = insertResult.rows[0];
  return {
    asset: {
      ...row,
      units: row.units !== null ? Number.parseFloat(row.units) : null,
      average_cost: row.average_cost !== null ? Number.parseFloat(row.average_cost) : null,
    },
  };
}

async function updateAsset(payload = {}) {
  const {
    id,
    asset_symbol,
    asset_name,
    asset_type,
    units,
    average_cost,
    currency,
    notes,
    is_active,
  } = payload;

  if (!id) {
    throw serviceError(400, 'Asset id is required');
  }

  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (asset_symbol !== undefined) {
    updates.push(`asset_symbol = $${paramIndex++}`);
    values.push(asset_symbol);
  }
  if (asset_name !== undefined) {
    updates.push(`asset_name = $${paramIndex++}`);
    values.push(asset_name);
  }
  if (asset_type !== undefined) {
    updates.push(`asset_type = $${paramIndex++}`);
    values.push(asset_type);
  }
  if (units !== undefined) {
    updates.push(`units = $${paramIndex++}`);
    values.push(units);
  }
  if (average_cost !== undefined) {
    updates.push(`average_cost = $${paramIndex++}`);
    values.push(average_cost);
  }
  if (currency !== undefined) {
    updates.push(`currency = $${paramIndex++}`);
    values.push(currency);
  }
  if (notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    values.push(notes);
  }
  if (is_active !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    values.push(is_active);
  }

  if (updates.length === 0) {
    throw serviceError(400, 'No fields to update');
  }

  values.push(id);
  const result = await database.query(
    `
      UPDATE investment_assets
         SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramIndex}
       RETURNING *
    `,
    values,
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Asset not found');
  }

  const row = result.rows[0];
  return {
    asset: {
      ...row,
      units: row.units !== null ? Number.parseFloat(row.units) : null,
      average_cost: row.average_cost !== null ? Number.parseFloat(row.average_cost) : null,
    },
  };
}

async function deactivateAsset(params = {}) {
  const id = params.id || params.asset_id;

  if (!id) {
    throw serviceError(400, 'Asset id is required');
  }

  const result = await database.query(
    'UPDATE investment_assets SET is_active = false WHERE id = $1 RETURNING *',
    [id],
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Asset not found');
  }

  return {
    message: 'Asset deactivated',
    asset: result.rows[0],
  };
}

module.exports = {
  listAssets,
  createAsset,
  updateAsset,
  deactivateAsset,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
