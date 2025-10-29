import { createApiHandler } from "../utils/apiHandler";
import { encrypt, decrypt } from "../utils/encryption";

const handler = createApiHandler({
  validate: (req) => {
    if (req.method === 'GET') {
      return null;
    }
    if (req.method === 'POST') {
      const { vendor } = req.body;
      if (!vendor) {
        return "Vendor is required";
      }
    }
    return null;
  },
  query: async (req) => {
    try {
      if (req.method === 'GET') {
        const { vendor } = req.query;
        if (vendor) {
          return {
            sql: 'SELECT * FROM vendor_credentials WHERE vendor = $1 ORDER BY created_at DESC',
            params: [vendor]
          };
        }
        return {
          sql: `SELECT *,
                       CASE
                         WHEN last_scrape_status = 'success' THEN 'success'
                         WHEN last_scrape_status = 'failed' THEN 'failed'
                         ELSE 'never'
                       END as lastScrapeStatus,
                       last_scrape_success as lastUpdate
                FROM vendor_credentials ORDER BY vendor`
        };
      }
      if (req.method === 'POST') {
        const { 
          vendor, username, userCode, email, password, id_number, card6_digits, 
          nickname, bank_account_number, identification_code, num, nationalID 
        } = req.body;

        // Map fields to database columns
        // username column can store: username, userCode, or email
        const usernameValue = userCode || email || username;
        // identification_code column can store: identification_code, num, or nationalID
        const identificationValue = num || nationalID || identification_code;

        // Encrypt sensitive data
        const encryptedData = {
          vendor,
          username: usernameValue ? encrypt(usernameValue) : null,
          password: password ? encrypt(password) : null,
          id_number: id_number ? encrypt(id_number) : null,
          card6_digits: card6_digits ? encrypt(card6_digits) : null,
          identification_code: identificationValue ? encrypt(identificationValue) : null,
          nickname,
          bank_account_number
        };

        return {
          sql: `
            INSERT INTO vendor_credentials (vendor, username, password, id_number, card6_digits, nickname, bank_account_number, identification_code)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
          `,
          params: [
            encryptedData.vendor,
            encryptedData.username,
            encryptedData.password,
            encryptedData.id_number,
            encryptedData.card6_digits,
            encryptedData.nickname,
            encryptedData.bank_account_number,
            encryptedData.identification_code
          ]
        };
      }
    } finally {
      
    }
  },
  transform: (result) => {
    if (result.rows) {
      return result.rows.map(row => ({
        id: row.id,
        vendor: row.vendor,
        username: row.username ? decrypt(row.username) : null,
        password: row.password ? decrypt(row.password) : null,
        id_number: row.id_number ? decrypt(row.id_number) : null,
        card6_digits: row.card6_digits, // Plain text account numbers (semicolon-separated)
        identification_code: row.identification_code ? decrypt(row.identification_code) : null,
        nickname: row.nickname,
        bank_account_number: row.bank_account_number, // Plain text account numbers (semicolon-separated)
        created_at: row.created_at,
        current_balance: row.current_balance,
        balance_updated_at: row.balance_updated_at,
        lastUpdate: row.lastupdate,
        lastScrapeStatus: row.lastscrapestatus,
        last_scrape_attempt: row.last_scrape_attempt
      }));
    }
    return result;
  }
});

export default handler; 