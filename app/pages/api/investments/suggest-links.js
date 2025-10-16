// API to suggest which account a new transaction should link to
import { getDB } from '../db';
import { matchAccount, calculateSimilarity } from '../../../utils/account-matcher';

async function handler(req, res) {
  const db = await getDB();
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transaction_identifier, transaction_vendor } = req.body;

  if (!transaction_identifier || !transaction_vendor) {
    return res.status(400).json({ 
      error: 'Missing required fields: transaction_identifier, transaction_vendor' 
    });
  }

  try {
    // 1. Get the transaction details
    const txnQuery = `
      SELECT * 
      FROM transactions 
      WHERE identifier = $1 AND vendor = $2
    `;
    const txnResult = await db.query(txnQuery, [transaction_identifier, transaction_vendor]);
    
    if (txnResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = txnResult.rows[0];

    // 2. Check if already linked
    const existingLinkQuery = `
      SELECT tal.*, ia.account_name 
      FROM transaction_account_links tal
      JOIN investment_accounts ia ON tal.account_id = ia.id
      WHERE tal.transaction_identifier = $1 AND tal.transaction_vendor = $2
    `;
    const existingLink = await db.query(existingLinkQuery, [transaction_identifier, transaction_vendor]);
    
    if (existingLink.rows.length > 0) {
      return res.status(200).json({
        success: true,
        already_linked: true,
        linked_account: existingLink.rows[0],
        message: 'Transaction already linked'
      });
    }

    // 3. Get all active investment accounts
    const accountsQuery = `
      SELECT id, account_name, account_type 
      FROM investment_accounts 
      WHERE is_active = true
      ORDER BY account_name
    `;
    const accountsResult = await db.query(accountsQuery);

    // 4. Get all patterns for each account
    const patternsQuery = `
      SELECT account_id, pattern, pattern_type, match_count
      FROM account_transaction_patterns
      WHERE is_active = true
      ORDER BY match_count DESC, pattern
    `;
    const patternsResult = await db.query(patternsQuery);

    // Group patterns by account
    const patternsByAccount = {};
    patternsResult.rows.forEach(row => {
      if (!patternsByAccount[row.account_id]) {
        patternsByAccount[row.account_id] = [];
      }
      patternsByAccount[row.account_id].push(row);
    });

    // 5. Score each account based on pattern matching
    const suggestions = [];

    for (const account of accountsResult.rows) {
      const patterns = patternsByAccount[account.id] || [];
      let maxConfidence = 0;
      let matchedPattern = null;

      // Check each pattern
      for (const patternObj of patterns) {
        const pattern = patternObj.pattern;
        const patternType = patternObj.pattern_type;
        let matches = false;

        if (patternType === 'substring') {
          // Convert SQL LIKE pattern to simple check
          const cleanPattern = pattern.replace(/%/g, '');
          matches = transaction.name.toLowerCase().includes(cleanPattern.toLowerCase());
        } else if (patternType === 'exact') {
          matches = transaction.name.toLowerCase() === pattern.toLowerCase();
        } else if (patternType === 'regex') {
          const regex = new RegExp(pattern, 'i');
          matches = regex.test(transaction.name);
        }

        if (matches) {
          // Use fuzzy matching to calculate confidence
          const similarity = calculateSimilarity(transaction.name, pattern.replace(/%/g, ''));
          if (similarity > maxConfidence) {
            maxConfidence = similarity;
            matchedPattern = pattern;
          }
        }
      }

      // Also use account matcher utility
      const accountMatch = matchAccount(transaction.name, account.account_name, account.account_type);
      if (accountMatch.confidence > maxConfidence) {
        maxConfidence = accountMatch.confidence;
        matchedPattern = `Account name match: ${account.account_name}`;
      }

      if (maxConfidence > 0.5) {
        suggestions.push({
          account_id: account.id,
          account_name: account.account_name,
          account_type: account.account_type,
          confidence: maxConfidence,
          matched_pattern: matchedPattern,
          pattern_count: patterns.length
        });
      }
    }

    // 6. Sort by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence);

    // 7. If we have a high-confidence match, auto-create it as pending
    if (suggestions.length > 0 && suggestions[0].confidence >= 0.8) {
      const topSuggestion = suggestions[0];
      
      // Insert into pending suggestions
      const pendingQuery = `
        INSERT INTO pending_transaction_suggestions (
          transaction_identifier,
          transaction_vendor,
          transaction_name,
          transaction_date,
          transaction_amount,
          suggested_account_id,
          confidence,
          match_reason,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
        ON CONFLICT (transaction_identifier, transaction_vendor) 
        DO UPDATE SET 
          suggested_account_id = EXCLUDED.suggested_account_id,
          confidence = EXCLUDED.confidence,
          match_reason = EXCLUDED.match_reason,
          status = 'pending'
        RETURNING id
      `;

      await db.query(pendingQuery, [
        transaction_identifier,
        transaction_vendor,
        transaction.name,
        transaction.date,
        transaction.price,
        topSuggestion.account_id,
        topSuggestion.confidence,
        topSuggestion.matched_pattern
      ]);
    }

    return res.status(200).json({
      success: true,
      transaction: {
        identifier: transaction.identifier,
        vendor: transaction.vendor,
        name: transaction.name,
        date: transaction.date,
        amount: transaction.price
      },
      suggestions,
      top_suggestion: suggestions[0] || null,
      requires_confirmation: suggestions.length > 0 && suggestions[0].confidence < 0.95
    });

  } catch (error) {
    console.error('Error suggesting transaction links:', error);
    return res.status(500).json({ error: error.message });
  }
}

export default handler;
