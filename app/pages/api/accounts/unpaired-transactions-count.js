import { getDB } from '../db.js';

/**
 * Get count of bank transactions that TRULY need pairing
 * These are transactions with category 25 (Credit Card Repayment) or 75 (Refunds)
 * that DON'T match any active pairing
 *
 * GET /api/accounts/unpaired-transactions-count
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    // Get all active pairings
    const pairingsResult = await client.query(`
      SELECT
        id,
        credit_card_vendor,
        credit_card_account_number,
        bank_vendor,
        bank_account_number,
        match_patterns
      FROM account_pairings
      WHERE is_active = 1
    `);

    const activePairings = pairingsResult.rows;

    // Get all transactions with category 25/75 from bank vendors
    const transactionsResult = await client.query(`
      SELECT
        identifier,
        vendor,
        name,
        account_number
      FROM transactions
      WHERE category_definition_id IN (25, 75)
        AND vendor IN (
          SELECT DISTINCT vendor
          FROM vendor_credentials
          WHERE vendor IN ('hapoalim', 'leumi', 'discount', 'mizrahi', 'beinleumi',
                          'union', 'yahav', 'otsarHahayal', 'mercantile', 'massad')
        )
    `);

    const allTransactions = transactionsResult.rows;

    // Filter out transactions that match any active pairing
    const unpairedTransactions = allTransactions.filter(txn => {
      // Check if this transaction matches ANY active pairing
      const matchesPairing = activePairings.some(pairing => {
        // Must match bank vendor
        if (txn.vendor !== pairing.bank_vendor) {
          return false;
        }

        // If pairing has specific bank account number, it must match
        if (pairing.bank_account_number &&
            txn.account_number !== pairing.bank_account_number) {
          return false;
        }

        // Check custom match patterns (ONLY match_patterns, no keywords)
        const matchPatterns = pairing.match_patterns ?
          JSON.parse(pairing.match_patterns) : [];

        if (matchPatterns.length === 0) {
          return false;
        }

        const txnNameLower = (txn.name || '').toLowerCase();
        const hasPatternMatch = matchPatterns.some(pattern =>
          txnNameLower.includes(pattern.toLowerCase())
        );

        return hasPatternMatch;
      });

      // Keep transactions that DON'T match any pairing
      return !matchesPairing;
    });

    res.status(200).json({
      count: unpairedTransactions.length
    });

  } catch (error) {
    console.error('Error counting unpaired transactions:', error);
    res.status(500).json({
      error: 'Failed to count unpaired transactions',
      details: error.message
    });
  } finally {
    client.release();
  }
}
