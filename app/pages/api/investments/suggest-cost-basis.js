import { getDB } from '../db.js';
import { buildSQLPatterns } from '../../../utils/account-matcher.js';

/**
 * API endpoint to suggest cost basis updates based on new transactions
 * since the last portfolio update
 * 
 * GET /api/investments/suggest-cost-basis?account_id=123
 * Returns suggested cost basis and list of transactions included
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = await getDB();

  try {
    const { account_id, account_name } = req.query;

    if (!account_id && !account_name) {
      return res.status(400).json({ error: 'Either account_id or account_name is required' });
    }

    // Get account details including last update date and current cost basis
    let accountQuery;
    let accountParams;

    if (account_id) {
      accountQuery = `
        SELECT 
          ia.id as account_id,
          ia.account_name,
          ia.account_type,
          ih.cost_basis,
          ih.as_of_date
        FROM investment_accounts ia
        LEFT JOIN investment_holdings ih ON ia.id = ih.account_id
        WHERE ia.id = $1
      `;
      accountParams = [account_id];
    } else {
      accountQuery = `
        SELECT 
          ia.id as account_id,
          ia.account_name,
          ia.account_type,
          ih.cost_basis,
          ih.as_of_date
        FROM investment_accounts ia
        LEFT JOIN investment_holdings ih ON ia.id = ih.account_id
        WHERE LOWER(ia.account_name) = LOWER($1)
        ORDER BY ia.created_at DESC
        LIMIT 1
      `;
      accountParams = [account_name];
    }

    const accountResult = await db.query(accountQuery, accountParams);

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accountResult.rows[0];
    const lastUpdateDate = account.as_of_date || '1900-01-01';
    const currentCostBasis = parseFloat(account.cost_basis) || 0;

    // Get SQL patterns for this account type from centralized config
    const patterns = buildSQLPatterns(account.account_type);
    
    // If no patterns found for account type, try to match by account name
    if (patterns.length === 0) {
      patterns.push(`%${account.account_name.toLowerCase()}%`);
    }

    // Build OR conditions for all patterns
    const patternConditions = patterns.map((_, index) => `LOWER(name) LIKE $${index + 2}`).join(' OR ');

    // Find transactions since last update that match this account
    const transactionsQuery = `
      SELECT 
        identifier,
        vendor,
        name,
        price,
        date,
        category_type
      FROM transactions
      WHERE date > $1
        AND category_type = 'investment'
        AND (${patternConditions})
      ORDER BY date DESC
    `;

    const transactionsResult = await db.query(transactionsQuery, [lastUpdateDate, ...patterns]);

    const transactions = transactionsResult.rows;

    // Calculate net flow (deposits - withdrawals)
    // Negative price = money OUT (deposit to investment) = increases cost basis
    // Positive price = money IN (withdrawal from investment) = decreases cost basis
    const netFlow = transactions.reduce((sum, txn) => {
      return sum + (parseFloat(txn.price) || 0);
    }, 0);

    // New cost basis = current + deposits - withdrawals
    // Since negative = deposit, we subtract the net flow
    const suggestedCostBasis = currentCostBasis - netFlow;

    // Break down by transaction type
    const deposits = transactions
      .filter(txn => parseFloat(txn.price) < 0)
      .map(txn => ({
        ...txn,
        price: parseFloat(txn.price),
        absoluteAmount: Math.abs(parseFloat(txn.price))
      }));

    const withdrawals = transactions
      .filter(txn => parseFloat(txn.price) > 0)
      .map(txn => ({
        ...txn,
        price: parseFloat(txn.price)
      }));

    const totalDeposits = deposits.reduce((sum, txn) => sum + txn.absoluteAmount, 0);
    const totalWithdrawals = withdrawals.reduce((sum, txn) => sum + txn.price, 0);

    return res.status(200).json({
      account: {
        account_id: account.account_id,
        account_name: account.account_name,
        account_type: account.account_type,
        last_update: account.as_of_date,
        current_cost_basis: currentCostBasis
      },
      suggestion: {
        has_new_transactions: transactions.length > 0,
        transaction_count: transactions.length,
        deposits_count: deposits.length,
        withdrawals_count: withdrawals.length,
        total_deposits: totalDeposits,
        total_withdrawals: totalWithdrawals,
        net_flow: -netFlow, // Flip sign for display (positive = net deposits)
        suggested_cost_basis: suggestedCostBasis,
        increase: suggestedCostBasis - currentCostBasis
      },
      transactions: {
        deposits,
        withdrawals,
        all: transactions
      }
    });

  } catch (error) {
    console.error('Error suggesting cost basis:', error);
    return res.status(500).json({ error: 'Failed to suggest cost basis', details: error.message });
  }
}
