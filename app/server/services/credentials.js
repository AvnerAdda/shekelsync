const database = require('./database.js');
const { encrypt, decrypt } = require('../../lib/server/encryption.js');

function mapCredentialRow(row) {
  return {
    id: row.id,
    vendor: row.vendor,
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
}

async function listCredentials(params = {}) {
  const { vendor } = params;

  let sql;
  let sqlParams = [];

  if (vendor) {
    sql = 'SELECT * FROM vendor_credentials WHERE vendor = $1 ORDER BY created_at DESC';
    sqlParams = [vendor];
  } else {
    sql = `
      SELECT *,
             CASE
               WHEN last_scrape_status = 'success' THEN 'success'
               WHEN last_scrape_status = 'failed' THEN 'failed'
               ELSE 'never'
             END as lastScrapeStatus,
             last_scrape_success as lastUpdate
      FROM vendor_credentials
      ORDER BY vendor
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
  if (!payload.vendor) {
    const error = new Error('Vendor is required');
    error.statusCode = 400;
    throw error;
  }

  const encryptedData = buildEncryptedPayload(payload);

  const result = await database.query(
    `
      INSERT INTO vendor_credentials (vendor, username, password, id_number, card6_digits, nickname, bank_account_number, identification_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      encryptedData.vendor,
      encryptedData.username,
      encryptedData.password,
      encryptedData.id_number,
      encryptedData.card6_digits,
      encryptedData.nickname,
      encryptedData.bank_account_number,
      encryptedData.identification_code,
    ],
  );

  return mapCredentialRow(result.rows[0]);
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
