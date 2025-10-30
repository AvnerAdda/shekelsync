import { getDB } from '../db.js';

/**
 * Get bank transactions with category 25/75 that DON'T match any active pairing
 * These are transactions that truly need user attention for pairing
 *
 * GET /api/accounts/truly-unpaired-transactions
 * Query params:
 *   - include_details: if 'true', returns transaction details, otherwise just count
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { include_details } = req.query;
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
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.category_definition_id,
        t.account_number,
        cd.name as category_name
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      WHERE t.category_definition_id IN (25, 75)
        AND t.vendor IN (
          SELECT DISTINCT vendor
          FROM vendor_credentials
          WHERE vendor IN ('hapoalim', 'leumi', 'discount', 'mizrahi', 'beinleumi',
                          'union', 'yahav', 'otsarHahayal', 'mercantile', 'massad')
        )
      ORDER BY t.date DESC
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

    // Return results
    if (include_details === 'true') {
      const detailedTransactions = unpairedTransactions.map(txn => ({
        identifier: txn.identifier,
        vendor: txn.vendor,
        date: txn.date,
        name: txn.name,
        price: txn.price,
        categoryId: txn.category_definition_id,
        categoryName: txn.category_name,
        accountNumber: txn.account_number
      }));

      res.status(200).json({
        count: unpairedTransactions.length,
        transactions: detailedTransactions
      });
    } else {
      res.status(200).json({
        count: unpairedTransactions.length
      });
    }

  } catch (error) {
    console.error('Error finding truly unpaired transactions:', error);
    res.status(500).json({
      error: 'Failed to find truly unpaired transactions',
      details: error.message
    });
  } finally {
    client.release();
  }
}
