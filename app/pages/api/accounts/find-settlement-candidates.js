import { getDB } from '../db.js';

/**
 * Find bank transactions that are likely credit card settlements
 * GET /api/accounts/find-settlement-candidates
 * Query params:
 *   - credit_card_account_number: The credit card's last 4 digits
 *   - bank_vendor: The bank vendor name
 *   - bank_account_number (optional): Specific bank account
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { credit_card_account_number, bank_vendor, bank_account_number } = req.query;

  if (!credit_card_account_number || !bank_vendor) {
    return res.status(400).json({
      error: 'credit_card_account_number and bank_vendor are required'
    });
  }

  const client = await getDB();

  try {
    // First, fetch all active pairings to exclude already-paired transactions
    const pairingsResult = await client.query(`
      SELECT
        id,
        bank_vendor,
        bank_account_number,
        match_patterns
      FROM account_pairings
      WHERE is_active = 1
    `);

    const activePairings = pairingsResult.rows;

    // Credit card related keywords in Hebrew and English
    const keywords = [
      'ויזה', 'visa',
      'כ.א.ל', 'cal',
      'מקס', 'max',
      'ישראכרט', 'isracard',
      'אמקס', 'אמריקן אקספרס', 'amex', 'american express',
      'לאומי כרט', 'leumi card',
      'דיינרס', 'diners',
      'hapoalim', 'leumi', 'mizrahi', 'discount',
      'otsarHahayal', 'beinleumi', 'massad', 'yahav', 'union'
    ];

    // Build the LIKE conditions for keywords
    const keywordConditions = keywords.map((_, i) => `LOWER(t.name) LIKE '%' || LOWER($${i + 3}) || '%'`).join(' OR ');

    // Build the query
    let query = `
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        t.price,
        t.category_definition_id,
        t.account_number,
        cd.name as category_name,
        cd.name_en as category_name_en,
        CASE
          WHEN LOWER(t.name) LIKE '%' || LOWER($1) || '%' THEN 'account_number_match'
          WHEN t.category_definition_id IN (25, 75) THEN 'category_match'
          WHEN ${keywordConditions} THEN 'keyword_match'
          ELSE 'unknown'
        END as match_reason
      FROM transactions t
      LEFT JOIN category_definitions cd ON cd.id = t.category_definition_id
      WHERE t.vendor = $2
        AND (
          LOWER(t.name) LIKE '%' || LOWER($1) || '%'
          OR t.category_definition_id IN (25, 75)
          OR ${keywordConditions}
        )
    `;

    const params = [credit_card_account_number, bank_vendor, ...keywords];

    // Add optional bank account number filter
    if (bank_account_number) {
      query += ` AND t.account_number = $${params.length + 1}`;
      params.push(bank_account_number);
    }

    query += ' ORDER BY t.date DESC LIMIT 500';

    const result = await client.query(query, params);

    // Filter out transactions that are already matched by active pairings
    const allCandidates = result.rows.map(row => ({
      identifier: row.identifier,
      vendor: row.vendor,
      date: row.date,
      name: row.name,
      price: row.price,
      categoryId: row.category_definition_id,
      categoryName: row.category_name || row.category_name_en,
      accountNumber: row.account_number,
      matchReason: row.match_reason
    }));

    // Exclude transactions already matched by other active pairings
    const candidates = allCandidates.filter(txn => {
      // Check if this transaction matches ANY active pairing
      const matchesPairing = activePairings.some(pairing => {
        // Must match bank vendor
        if (txn.vendor !== pairing.bank_vendor) {
          return false;
        }

        // If pairing has specific bank account number, it must match
        if (pairing.bank_account_number &&
            txn.accountNumber !== pairing.bank_account_number) {
          return false;
        }

        // Check custom match patterns (ONLY match_patterns)
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

      // Keep transactions that DON'T match any existing pairing
      return !matchesPairing;
    });

    // Statistics
    const stats = {
      total: candidates.length,
      byMatchReason: candidates.reduce((acc, c) => {
        acc[c.matchReason] = (acc[c.matchReason] || 0) + 1;
        return acc;
      }, {}),
      totalNegative: candidates.filter(c => c.price < 0).length,
      totalPositive: candidates.filter(c => c.price > 0).length
    };

    res.status(200).json({
      candidates,
      stats,
      filters: {
        creditCardAccountNumber: credit_card_account_number,
        bankVendor: bank_vendor,
        bankAccountNumber: bank_account_number || null
      }
    });

  } catch (error) {
    console.error('Error finding settlement candidates:', error);
    res.status(500).json({
      error: 'Failed to find settlement candidates',
      details: error.message
    });
  } finally {
    client.release();
  }
}
