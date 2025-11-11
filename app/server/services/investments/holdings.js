const database = require('../database.js');
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
} = require('../institutions.js');

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function listHoldings(params = {}) {
  const accountId = params.accountId || params.account_id;
  const includeHistory = params.includeHistory === 'true' || params.includeHistory === true;

  if (includeHistory) {
    const query = accountId
      ? `
        SELECT
          ihh.*,
          ia.account_name,
          ia.account_type,
          ia.institution,
          ${INSTITUTION_SELECT_FIELDS}
        FROM investment_holdings_history ihh
        JOIN investment_accounts ia ON ihh.account_id = ia.id
        LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
        WHERE ihh.account_id = $1
        ORDER BY ihh.snapshot_date DESC
      `
      : `
        SELECT
          ihh.*,
          ia.account_name,
          ia.account_type,
          ia.institution,
          ${INSTITUTION_SELECT_FIELDS}
        FROM investment_holdings_history ihh
        JOIN investment_accounts ia ON ihh.account_id = ia.id
        LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
        ORDER BY ihh.snapshot_date DESC, ia.account_name
      `;

    const result = accountId
      ? await database.query(query, [accountId])
      : await database.query(query);

    return {
      history: result.rows.map((row) => ({
        ...row,
        total_value: row.total_value !== null ? Number.parseFloat(row.total_value) : null,
        cost_basis: row.cost_basis !== null ? Number.parseFloat(row.cost_basis) : null,
        institution: buildInstitutionFromRow(row),
      })),
    };
  }

  const query = accountId
    ? `
      SELECT
        ih.*,
        ia.account_name,
        ia.account_type,
        ia.institution,
        ia.currency,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_holdings ih
      JOIN investment_accounts ia ON ih.account_id = ia.id
      LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
      WHERE ih.account_id = $1
      ORDER BY ih.as_of_date DESC
      LIMIT 1
    `
    : `
      SELECT DISTINCT ON (ih.account_id)
        ih.*,
        ia.account_name,
        ia.account_type,
        ia.institution,
        ia.currency,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_holdings ih
      JOIN investment_accounts ia ON ih.account_id = ia.id
      LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
      WHERE ia.is_active = true
      ORDER BY ih.account_id, ih.as_of_date DESC
    `;

  const result = accountId
    ? await database.query(query, [accountId])
    : await database.query(query);

  return {
    holdings: result.rows.map((row) => ({
      ...row,
      current_value: row.current_value !== null ? Number.parseFloat(row.current_value) : null,
      cost_basis: row.cost_basis !== null ? Number.parseFloat(row.cost_basis) : null,
      units: row.units !== null ? Number.parseFloat(row.units) : null,
      institution: buildInstitutionFromRow(row),
    })),
  };
}

async function verifyAccount(accountId) {
  const check = await database.query(
    'SELECT id FROM investment_accounts WHERE id = $1',
    [accountId],
  );

  if (check.rows.length === 0) {
    throw serviceError(404, 'Account not found');
  }
}

async function upsertHolding(payload = {}) {
  const {
    account_id,
    current_value,
    cost_basis,
    as_of_date,
    asset_name,
    asset_type,
    units,
    notes,
    save_history = true,
  } = payload;

  if (!account_id || current_value === undefined || !as_of_date) {
    throw serviceError(400, 'account_id, current_value, and as_of_date are required');
  }

  await verifyAccount(account_id);

  const client = await database.getClient();

  try {
    await client.query('BEGIN');

    const holdingsResult = await client.query(
      `
        INSERT INTO investment_holdings (
          account_id, current_value, cost_basis, as_of_date,
          asset_name, asset_type, units, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (account_id, as_of_date)
        DO UPDATE SET
          current_value = EXCLUDED.current_value,
          cost_basis = EXCLUDED.cost_basis,
          asset_name = EXCLUDED.asset_name,
          asset_type = EXCLUDED.asset_type,
          units = EXCLUDED.units,
          notes = EXCLUDED.notes,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        account_id,
        current_value,
        cost_basis || null,
        as_of_date,
        asset_name || null,
        asset_type || null,
        units || null,
        notes || null,
      ],
    );

    if (save_history) {
      await client.query(
        `
          INSERT INTO investment_holdings_history (
            account_id, total_value, cost_basis, snapshot_date, notes
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (account_id, snapshot_date)
          DO UPDATE SET
            total_value = EXCLUDED.total_value,
            cost_basis = EXCLUDED.cost_basis,
            notes = EXCLUDED.notes
        `,
        [account_id, current_value, cost_basis || null, as_of_date, notes || null],
      );
    }

    await client.query('COMMIT');

    const row = holdingsResult.rows[0];
    return {
      holding: {
        ...row,
        current_value: Number.parseFloat(row.current_value),
        cost_basis: row.cost_basis !== null ? Number.parseFloat(row.cost_basis) : null,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteHolding(params = {}) {
  const id = params.id || params.holding_id;

  if (!id) {
    throw serviceError(400, 'Holding id is required');
  }

  const result = await database.query(
    'DELETE FROM investment_holdings WHERE id = $1 RETURNING *',
    [id],
  );

  if (result.rows.length === 0) {
    throw serviceError(404, 'Holding not found');
  }

  return {
    message: 'Holding deleted',
    holding: result.rows[0],
  };
}

module.exports = {
  listHoldings,
  upsertHolding,
  deleteHolding,
};

module.exports.default = module.exports;
