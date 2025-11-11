const database = require('./database.js');
const { encrypt, decrypt } = require('../../lib/server/encryption.js');
const { buildInstitutionFromRow } = require('./institutions.js');

function mapCredentialRow(row) {
  const credential = {
    id: row.id,
    vendor: row.vendor,
    institution_id: row.institution_id,
    username: row.username ? decrypt(row.username) : null,
    password: row.password ? decrypt(row.password) : null,
    id_number: row.id_number ? decrypt(row.id_number) : null,
    card6_digits: row.card6_digits,
    identification_code: row.identification_code ? decrypt(row.identification_code) : null,
    nickname: row.nickname,
    bank_account_number: row.bank_account_number,
    created_at: row.created_at,
    current_balance: row.current_balance,
    balance_updated_at: row.balance_updated_at,
    lastUpdate: row.lastscrapesuccess || row.lastupdate || row.last_scrape_success,
    lastScrapeStatus: row.lastscrapestatus || row.last_scrape_status,
    last_scrape_attempt: row.last_scrape_attempt,
  };

  // Add institution object if available
  const institution = buildInstitutionFromRow(row);
  if (institution) {
    credential.institution = institution;
  }

  return credential;
}

async function listCredentials(params = {}) {
  const { vendor } = params;
  const { INSTITUTION_JOIN_VENDOR_CRED, INSTITUTION_SELECT_FIELDS } = require('./institutions.js');

  let sql;
  let sqlParams = [];

  if (vendor) {
    sql = `
      SELECT vc.*, ${INSTITUTION_SELECT_FIELDS}
      FROM vendor_credentials vc
      ${INSTITUTION_JOIN_VENDOR_CRED}
      WHERE vc.vendor = $1
      ORDER BY vc.created_at DESC
    `;
    sqlParams = [vendor];
  } else {
    sql = `
      SELECT vc.*,
             ${INSTITUTION_SELECT_FIELDS},
             CASE
               WHEN vc.last_scrape_status = 'success' THEN 'success'
               WHEN vc.last_scrape_status = 'failed' THEN 'failed'
               ELSE 'never'
             END as lastScrapeStatus,
             vc.last_scrape_success as lastUpdate
      FROM vendor_credentials vc
      ${INSTITUTION_JOIN_VENDOR_CRED}
      ORDER BY vc.vendor
    `;
  }

  const result = await database.query(sql, sqlParams);
  return result.rows.map(mapCredentialRow);
}

function buildEncryptedPayload(payload = {}) {
  const {
    vendor,
    username,
    userCode,
    email,
    password,
    id_number,
    card6_digits,
    nickname,
    bank_account_number,
    identification_code,
    num,
    nationalID,
  } = payload;

  const usernameValue = userCode || email || username;
  const identificationValue = num || nationalID || identification_code;

  return {
    vendor,
    username: usernameValue ? encrypt(usernameValue) : null,
    password: password ? encrypt(password) : null,
    id_number: id_number ? encrypt(id_number) : null,
    card6_digits: card6_digits || null,
    nickname: nickname || null,
    bank_account_number: bank_account_number || null,
    identification_code: identificationValue ? encrypt(identificationValue) : null,
  };
}

async function createCredential(payload = {}) {
  if (!payload.vendor && !payload.institution_id) {
    const error = new Error('Vendor or institution_id is required');
    error.statusCode = 400;
    throw error;
  }

  const encryptedData = buildEncryptedPayload(payload);

  // If institution_id provided but no vendor, lookup vendor_code
  let vendor = encryptedData.vendor;
  let institutionId = payload.institution_id;

  if (institutionId && !vendor) {
    const { getInstitutionById } = require('./institutions.js');
    const institution = await getInstitutionById(database, institutionId);
    if (institution) {
      vendor = institution.vendor_code;
    }
  } else if (vendor && !institutionId) {
    // If vendor provided but no institution_id, lookup institution
    const { mapVendorCodeToInstitutionId } = require('./institutions.js');
    institutionId = await mapVendorCodeToInstitutionId(database, vendor);
  }

  const { INSTITUTION_JOIN_VENDOR_CRED, INSTITUTION_SELECT_FIELDS } = require('./institutions.js');

  const result = await database.query(
    `
      INSERT INTO vendor_credentials (vendor, username, password, id_number, card6_digits, nickname, bank_account_number, identification_code, institution_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      vendor,
      encryptedData.username,
      encryptedData.password,
      encryptedData.id_number,
      encryptedData.card6_digits,
      encryptedData.nickname,
      encryptedData.bank_account_number,
      encryptedData.identification_code,
      institutionId,
    ],
  );

  // Fetch with institution data
  const credWithInstitution = await database.query(
    `
      SELECT vc.*, ${INSTITUTION_SELECT_FIELDS}
      FROM vendor_credentials vc
      ${INSTITUTION_JOIN_VENDOR_CRED}
      WHERE vc.id = $1
    `,
    [result.rows[0].id]
  );

  return mapCredentialRow(credWithInstitution.rows[0]);
}

async function deleteCredential(params = {}) {
  const { id } = params;
  if (!id) {
    const error = new Error('Credential ID is required');
    error.statusCode = 400;
    throw error;
  }

  await database.query(
    `
      DELETE FROM vendor_credentials
      WHERE id = $1
    `,
    [id],
  );

  return { success: true };
}

module.exports = {
  listCredentials,
  createCredential,
  deleteCredential,
};
module.exports.default = module.exports;
