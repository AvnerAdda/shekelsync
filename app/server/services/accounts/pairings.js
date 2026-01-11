const actualDatabase = require('../database.js');
const manualMatchingService = require('../investments/manual-matching.js');
let database = actualDatabase;

function normalizePairing(row) {
  const pairing = {
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

  // Add credit card institution if available
  if (row.cc_institution_id) {
    pairing.creditCardInstitution = {
      id: row.cc_institution_id,
      vendor_code: row.cc_institution_vendor_code,
      display_name_he: row.cc_institution_name_he,
      display_name_en: row.cc_institution_name_en,
      logo_url: row.cc_institution_logo,
      institution_type: row.cc_institution_type,
    };
  }

  // Add bank institution if available
  if (row.bank_institution_id) {
    pairing.bankInstitution = {
      id: row.bank_institution_id,
      vendor_code: row.bank_institution_vendor_code,
      display_name_he: row.bank_institution_name_he,
      display_name_en: row.bank_institution_name_en,
      logo_url: row.bank_institution_logo,
      institution_type: row.bank_institution_type,
    };
  }

  return pairing;
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
  const includeStats = params.include_stats !== undefined
    ? params.include_stats === true || params.include_stats === 'true'
    : false;

  let query = `
    SELECT
      ap.*,
      COALESCE(fi_cc_cred.id, fi_cc_vendor.id) as cc_institution_id,
      COALESCE(fi_cc_cred.vendor_code, fi_cc_vendor.vendor_code, ap.credit_card_vendor) as cc_institution_vendor_code,
      COALESCE(fi_cc_cred.display_name_he, fi_cc_vendor.display_name_he, ap.credit_card_vendor) as cc_institution_name_he,
      COALESCE(fi_cc_cred.display_name_en, fi_cc_vendor.display_name_en, ap.credit_card_vendor) as cc_institution_name_en,
      COALESCE(fi_cc_cred.logo_url, fi_cc_vendor.logo_url) as cc_institution_logo,
      COALESCE(fi_cc_cred.institution_type, fi_cc_vendor.institution_type) as cc_institution_type,
      COALESCE(fi_bank_cred.id, fi_bank_vendor.id) as bank_institution_id,
      COALESCE(fi_bank_cred.vendor_code, fi_bank_vendor.vendor_code, ap.bank_vendor) as bank_institution_vendor_code,
      COALESCE(fi_bank_cred.display_name_he, fi_bank_vendor.display_name_he, ap.bank_vendor) as bank_institution_name_he,
      COALESCE(fi_bank_cred.display_name_en, fi_bank_vendor.display_name_en, ap.bank_vendor) as bank_institution_name_en,
      COALESCE(fi_bank_cred.logo_url, fi_bank_vendor.logo_url) as bank_institution_logo,
      COALESCE(fi_bank_cred.institution_type, fi_bank_vendor.institution_type) as bank_institution_type
    FROM account_pairings ap
    LEFT JOIN vendor_credentials vc_cc
      ON ap.credit_card_vendor = vc_cc.vendor
      AND (ap.credit_card_account_number IS NULL OR ap.credit_card_account_number = vc_cc.bank_account_number)
    LEFT JOIN institution_nodes fi_cc_cred
      ON vc_cc.institution_id = fi_cc_cred.id
     AND fi_cc_cred.node_type = 'institution'
    LEFT JOIN institution_nodes fi_cc_vendor
      ON ap.credit_card_vendor = fi_cc_vendor.vendor_code
     AND fi_cc_vendor.node_type = 'institution'
    LEFT JOIN vendor_credentials vc_bank
      ON ap.bank_vendor = vc_bank.vendor
      AND (ap.bank_account_number IS NULL OR ap.bank_account_number = vc_bank.bank_account_number)
    LEFT JOIN institution_nodes fi_bank_cred
      ON vc_bank.institution_id = fi_bank_cred.id
     AND fi_bank_cred.node_type = 'institution'
    LEFT JOIN institution_nodes fi_bank_vendor
      ON ap.bank_vendor = fi_bank_vendor.vendor_code
     AND fi_bank_vendor.node_type = 'institution'
  `;

  const predicates = [];
  if (!includeInactive) {
    predicates.push('ap.is_active = 1');
  }

  if (predicates.length > 0) {
    query += ` WHERE ${predicates.join(' AND ')}`;
  }

  query += ' ORDER BY ap.created_at DESC';

  const result = await database.query(query);
  const pairings = result.rows.map(normalizePairing);

  // Fetch matching stats if requested
  if (includeStats) {
    for (const pairing of pairings) {
      try {
        const stats = await manualMatchingService.getMatchingStats({
          bankVendor: pairing.bankVendor,
          bankAccountNumber: pairing.bankAccountNumber,
          matchPatterns: pairing.matchPatterns
        });
        pairing.matchingStats = stats;
      } catch (error) {
        console.error(`Error fetching stats for pairing ${pairing.id}:`, error);
        // Set null stats on error instead of failing entire request
        pairing.matchingStats = null;
      }
    }
  }

  return pairings;
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
    const result = await client.query(
      'DELETE FROM account_pairings WHERE id = $1',
      [id],
    );

    if (result.rowCount === 0) {
      const error = new Error('Pairing not found');
      error.status = 404;
      throw error;
    }

    await client.query(
      `
        INSERT INTO account_pairing_log (pairing_id, action, created_at)
        VALUES ($1, 'deleted', CURRENT_TIMESTAMP)
      `,
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
          ap.*,
          COALESCE(fi_cc_cred.id, fi_cc_vendor.id) as cc_institution_id,
          COALESCE(fi_cc_cred.vendor_code, fi_cc_vendor.vendor_code, ap.credit_card_vendor) as cc_institution_vendor_code,
          COALESCE(fi_cc_cred.display_name_he, fi_cc_vendor.display_name_he, ap.credit_card_vendor) as cc_institution_name_he,
          COALESCE(fi_cc_cred.display_name_en, fi_cc_vendor.display_name_en, ap.credit_card_vendor) as cc_institution_name_en,
          COALESCE(fi_cc_cred.logo_url, fi_cc_vendor.logo_url) as cc_institution_logo,
          COALESCE(fi_cc_cred.institution_type, fi_cc_vendor.institution_type) as cc_institution_type,
          COALESCE(fi_bank_cred.id, fi_bank_vendor.id) as bank_institution_id,
          COALESCE(fi_bank_cred.vendor_code, fi_bank_vendor.vendor_code, ap.bank_vendor) as bank_institution_vendor_code,
          COALESCE(fi_bank_cred.display_name_he, fi_bank_vendor.display_name_he, ap.bank_vendor) as bank_institution_name_he,
          COALESCE(fi_bank_cred.display_name_en, fi_bank_vendor.display_name_en, ap.bank_vendor) as bank_institution_name_en,
          COALESCE(fi_bank_cred.logo_url, fi_bank_vendor.logo_url) as bank_institution_logo,
          COALESCE(fi_bank_cred.institution_type, fi_bank_vendor.institution_type) as bank_institution_type
        FROM account_pairings ap
        LEFT JOIN vendor_credentials vc_cc
          ON ap.credit_card_vendor = vc_cc.vendor
          AND (ap.credit_card_account_number IS NULL OR ap.credit_card_account_number = vc_cc.bank_account_number)
        LEFT JOIN institution_nodes fi_cc_cred
          ON vc_cc.institution_id = fi_cc_cred.id
         AND fi_cc_cred.node_type = 'institution'
        LEFT JOIN institution_nodes fi_cc_vendor
          ON ap.credit_card_vendor = fi_cc_vendor.vendor_code
         AND fi_cc_vendor.node_type = 'institution'
        LEFT JOIN vendor_credentials vc_bank
          ON ap.bank_vendor = vc_bank.vendor
          AND (ap.bank_account_number IS NULL OR ap.bank_account_number = vc_bank.bank_account_number)
        LEFT JOIN institution_nodes fi_bank_cred
          ON vc_bank.institution_id = fi_bank_cred.id
         AND fi_bank_cred.node_type = 'institution'
        LEFT JOIN institution_nodes fi_bank_vendor
          ON ap.bank_vendor = fi_bank_vendor.vendor_code
         AND fi_bank_vendor.node_type = 'institution'
        WHERE ap.is_active = 1
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
