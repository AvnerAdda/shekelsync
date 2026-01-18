const actualDatabase = require('../database.js');
let database = actualDatabase;

function normalizePairing(row) {
  return {
    id: row.id,
    creditCardVendor: row.credit_card_vendor,
    creditCardAccountNumber: row.credit_card_account_number,
    bankVendor: row.bank_vendor,
    bankAccountNumber: row.bank_account_number,
    matchPatterns: row.match_patterns ? JSON.parse(row.match_patterns) : [],
    isActive: Boolean(row.is_active),
    discrepancyAcknowledged: Boolean(row.discrepancy_acknowledged),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildNullSafeEquality(column, placeholder) {
  return `(
    (${column} IS NULL AND ${placeholder} IS NULL)
    OR ${column} = ${placeholder}
  )`;
}

async function listPairings(params = {}) {
  const includeInactive = params.include_inactive !== undefined
    ? params.include_inactive === true || params.include_inactive === 'true'
    : false;
  let query = `
    SELECT
      id,
      credit_card_vendor,
      credit_card_account_number,
      bank_vendor,
      bank_account_number,
      match_patterns,
      is_active,
      discrepancy_acknowledged,
      created_at,
      updated_at
    FROM account_pairings
  `;

  if (!includeInactive) {
    query += ' WHERE is_active = 1';
  }

  query += ' ORDER BY created_at DESC';

  const result = await database.query(query);
  return result.rows.map(normalizePairing);
}

async function createPairing(payload = {}) {
  const {
    creditCardVendor,
    creditCardAccountNumber = null,
    bankVendor,
    bankAccountNumber = null,
    matchPatterns = [],
  } = payload;

  if (!creditCardVendor || !bankVendor) {
    const error = new Error('creditCardVendor and bankVendor are required');
    error.status = 400;
    throw error;
  }

  if (!Array.isArray(matchPatterns) || matchPatterns.length === 0) {
    const error = new Error('At least one match pattern is required');
    error.status = 400;
    throw error;
  }

  const client = await database.getClient();

  try {
    const existing = await client.query(
      `
        SELECT id
        FROM account_pairings
        WHERE
          credit_card_vendor = $1
          AND ${buildNullSafeEquality('credit_card_account_number', '$2')}
          AND bank_vendor = $3
          AND ${buildNullSafeEquality('bank_account_number', '$4')}
      `,
      [creditCardVendor, creditCardAccountNumber, bankVendor, bankAccountNumber],
    );

    if (existing.rows.length > 0) {
      const error = new Error('Pairing already exists');
      error.status = 409;
      error.existingId = existing.rows[0].id;
      throw error;
    }

    const insertResult = await client.query(
      `
        INSERT INTO account_pairings (
          credit_card_vendor,
          credit_card_account_number,
          bank_vendor,
          bank_account_number,
          match_patterns,
          is_active,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [
        creditCardVendor,
        creditCardAccountNumber,
        bankVendor,
        bankAccountNumber,
        JSON.stringify(matchPatterns),
      ],
    );

    const pairingId = insertResult.rows[0].id;

    await client.query(
      `
        INSERT INTO account_pairing_log (pairing_id, action, details, created_at)
        VALUES ($1, 'created', $2, CURRENT_TIMESTAMP)
      `,
      [pairingId, JSON.stringify({ matchPatterns, patternCount: matchPatterns.length })],
    );

    return {
      pairingId,
    };
  } finally {
    client.release();
  }
}

async function updatePairing(payload = {}) {
  const { id, matchPatterns, isActive } = payload;

  if (!id) {
    const error = new Error('Pairing ID is required');
    error.status = 400;
    throw error;
  }

  const updates = [];
  const params = [id];
  let index = 2;

  if (matchPatterns !== undefined) {
    updates.push(`match_patterns = $${index}`);
    params.push(JSON.stringify(matchPatterns || []));
    index += 1;
  }

  if (isActive !== undefined) {
    updates.push(`is_active = $${index}`);
    params.push(isActive ? 1 : 0);
    index += 1;
  }

  if (updates.length === 0) {
    const error = new Error('No fields to update');
    error.status = 400;
    throw error;
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);

  const client = await database.getClient();

  try {
    const result = await client.query(
      `
        UPDATE account_pairings
        SET ${updates.join(', ')}
        WHERE id = $1
      `,
      params,
    );

    if (result.rowCount === 0) {
      const error = new Error('Pairing not found');
      error.status = 404;
      throw error;
    }

    await client.query(
      `
        INSERT INTO account_pairing_log (pairing_id, action, details, created_at)
        VALUES ($1, 'updated', $2, CURRENT_TIMESTAMP)
      `,
      [id, JSON.stringify({ matchPatterns, isActive })],
    );

    return { updated: true };
  } finally {
    client.release();
  }
}

async function deletePairing({ id }) {
  if (!id) {
    const error = new Error('Pairing ID is required');
    error.status = 400;
    throw error;
  }

  const client = await database.getClient();

  try {
    // First, verify the pairing exists
    const existsResult = await client.query(
      'SELECT id FROM account_pairings WHERE id = $1',
      [id],
    );

    if (existsResult.rows.length === 0) {
      const error = new Error('Pairing not found');
      error.status = 404;
      throw error;
    }

    // Insert log entry before deletion (since pairing_id still exists)
    await client.query(
      `
        INSERT INTO account_pairing_log (pairing_id, action, created_at)
        VALUES ($1, 'deleted', CURRENT_TIMESTAMP)
      `,
      [id],
    );

    // Now delete the pairing (CASCADE will handle the log entries)
    const result = await client.query(
      'DELETE FROM account_pairings WHERE id = $1',
      [id],
    );

    return { deleted: true };
  } finally {
    client.release();
  }
}

async function getActivePairings(clientInstance) {
  const client = clientInstance || (await database.getClient());
  const shouldRelease = !clientInstance;

  try {
    const result = await client.query(
      `
        SELECT
          id,
          credit_card_vendor,
          credit_card_account_number,
          bank_vendor,
          bank_account_number,
          match_patterns
        FROM account_pairings
        WHERE is_active = 1
      `,
    );

    return result.rows.map((row) => ({
      id: row.id,
      creditCardVendor: row.credit_card_vendor,
      creditCardAccountNumber: row.credit_card_account_number,
      bankVendor: row.bank_vendor,
      bankAccountNumber: row.bank_account_number,
      matchPatterns: row.match_patterns ? JSON.parse(row.match_patterns) : [],
    }));
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

module.exports = {
  listPairings,
  createPairing,
  updatePairing,
  deletePairing,
  getActivePairings,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};

module.exports.default = module.exports;
