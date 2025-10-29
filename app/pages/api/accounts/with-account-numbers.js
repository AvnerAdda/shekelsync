import { getDB } from '../db.js';

/**
 * Get accounts with their actual account numbers from transactions
 * This shows the real account numbers that appear in scraped transactions,
 * not the card6_digits from credentials (which may be empty)
 *
 * GET /api/accounts/with-account-numbers
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    // Get all credentials with their account numbers (stored in vendor_credentials)
    const query = `
      SELECT
        id,
        vendor,
        nickname,
        card6_digits,
        bank_account_number
      FROM vendor_credentials
      ORDER BY vendor, id
    `;

    const result = await client.query(query);

    const accounts = result.rows.map(row => {
      // Get account numbers from the appropriate field (credit card or bank)
      const accountNumbersField = row.card6_digits || row.bank_account_number || '';

      return {
        id: row.id,
        vendor: row.vendor,
        nickname: row.nickname,
        card6_digits: row.card6_digits,
        bank_account_number: row.bank_account_number,
        // Split by semicolon if multiple accounts exist
        account_numbers: accountNumbersField ? accountNumbersField.split(';').filter(Boolean) : []
      };
    });

    res.status(200).json({ accounts });

  } catch (error) {
    console.error('Error fetching accounts with account numbers:', error);
    res.status(500).json({
      error: 'Failed to fetch accounts',
      details: error.message
    });
  } finally {
    client.release();
  }
}
