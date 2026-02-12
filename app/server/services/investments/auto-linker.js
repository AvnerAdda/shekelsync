/**
 * Auto-Linker Service
 * Automatically links transactions to investment accounts when accounts are created from suggestions
 */

const pool = require('../../../utils/db');
const database = require('../database.js');
const { getInstitutionByVendorCode } = require('../institutions.js');

async function fetchAccountInstitution(accountId) {
  const accountQuery = `
    SELECT
      ia.account_type,
      fi.id as institution_id,
      fi.vendor_code,
      fi.display_name_he,
      fi.display_name_en,
      fi.institution_type,
      fi.logo_url
    FROM investment_accounts ia
    LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
    WHERE ia.id = ?
  `;

  const result = await pool.query(accountQuery, [accountId]);
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const row = rows[0];
  if (!row) {
    return null;
  }

  if (row.institution_id) {
    return {
      id: row.institution_id,
      vendor_code: row.vendor_code,
      display_name_he: row.display_name_he,
      display_name_en: row.display_name_en,
      institution_type: row.institution_type,
      logo_url: row.logo_url,
    };
  }

  try {
    return await getInstitutionByVendorCode(database, row.account_type);
  } catch (error) {
    console.warn('[auto-linker] Failed to resolve institution metadata', error);
    return null;
  }
}

/**
 * Link a single transaction to an investment account
 * @param {object} params
 * @param {string} params.transactionIdentifier
 * @param {string} params.transactionVendor
 * @param {string} params.transactionDate
 * @param {number} params.accountId
 * @param {string} params.linkMethod - 'auto', 'manual', or 'pattern'
 * @param {number} params.confidence - Confidence score (0-1)
 * @param {string} params.createdBy - 'system' or 'user'
 * @returns {Promise<object>} Created link
 */
async function linkTransactionToAccount(params) {
  const {
    transactionIdentifier,
    transactionVendor,
    transactionDate,
    accountId,
    linkMethod = 'auto',
    confidence = 1.0,
    createdBy = 'system'
  } = params;

  const query = `
    INSERT INTO transaction_account_links (
      transaction_identifier,
      transaction_vendor,
      transaction_date,
      account_id,
      link_method,
      confidence,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(transaction_identifier, transaction_vendor) DO UPDATE SET
      account_id = excluded.account_id,
      link_method = excluded.link_method,
      confidence = excluded.confidence,
      created_at = datetime('now')
    RETURNING *
  `;

  const result = await pool.query(query, [
    transactionIdentifier,
    transactionVendor,
    transactionDate,
    accountId,
    linkMethod,
    confidence,
    createdBy
  ]);

  return result.rows[0];
}

/**
 * Link multiple transactions to an account in a single operation
 * @param {number} accountId - Investment account ID
 * @param {Array<object>} transactions - Array of transaction objects
 * @param {string} linkMethod - Link method (default 'auto')
 * @param {number} confidence - Confidence score (default 1.0)
 * @returns {Promise<object>} Summary of linking operation
 */
async function linkMultipleTransactions(accountId, transactions, linkMethod = 'auto', confidence = 1.0) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return {
      totalAttempted: 0,
      successCount: 0,
      failureCount: 0,
      successfulLinks: [],
      failedLinks: []
    };
  }

  const successfulLinks = [];
  const failedLinks = [];
  let accountInstitution = null;

  for (const transaction of transactions) {
    try {
      const link = await linkTransactionToAccount({
        transactionIdentifier: transaction.transactionIdentifier || transaction.identifier,
        transactionVendor: transaction.transactionVendor || transaction.vendor,
        transactionDate: transaction.transactionDate || transaction.date,
        accountId,
        linkMethod,
        confidence: transaction.confidence || confidence,
        createdBy: 'system'
      });

      successfulLinks.push(link);
    } catch (error) {
      failedLinks.push({
        transaction,
        error: error.message
      });
    }
  }

  if (successfulLinks.length > 0) {
    try {
      accountInstitution = await fetchAccountInstitution(accountId);
    } catch (error) {
      console.warn('[auto-linker] Failed to fetch account institution metadata', error);
      accountInstitution = null;
    }
  }

  return {
    totalAttempted: transactions.length,
    successCount: successfulLinks.length,
    failureCount: failedLinks.length,
    successfulLinks: successfulLinks.map((link) => ({
      ...link,
      institution: accountInstitution || null,
    })),
    failedLinks
  };
}

/**
 * Link all transactions from approved suggestions to an account
 * @param {number} accountId - Investment account ID
 * @param {Array<string>} suggestionIds - Array of pending_transaction_suggestions IDs
 * @returns {Promise<object>} Linking result summary
 */
async function linkFromSuggestions(accountId, suggestionIds) {
  // Get all transactions from the suggestions
  const placeholders = suggestionIds.map(() => '?').join(',');
  const query = `
    SELECT
      transaction_identifier,
      transaction_vendor,
      transaction_date,
      confidence
    FROM pending_transaction_suggestions
    WHERE id IN (${placeholders})
      AND status = 'pending'
  `;

  const result = await pool.query(query, suggestionIds);
  const transactions = result.rows;

  if (transactions.length === 0) {
    return {
      totalAttempted: 0,
      successCount: 0,
      failureCount: 0,
      successfulLinks: [],
      failedLinks: []
    };
  }

  // Link all transactions
  const linkResult = await linkMultipleTransactions(accountId, transactions, 'auto');

  // Update suggestions status to 'approved'
  if (linkResult.successCount > 0) {
    const updateQuery = `
      UPDATE pending_transaction_suggestions
      SET status = 'approved',
          suggested_account_id = ?,
          reviewed_at = datetime('now')
      WHERE id IN (${placeholders})
    `;

    await pool.query(updateQuery, [accountId, ...suggestionIds]);
  }

  return linkResult;
}

/**
 * Link transactions from a grouped suggestion (all transactions in the group)
 * @param {number} accountId - Investment account ID
 * @param {object} groupedSuggestion - Grouped suggestion object from analyzer
 * @returns {Promise<object>} Linking result summary
 */
async function linkFromGroupedSuggestion(accountId, groupedSuggestion) {
  const transactions = groupedSuggestion.transactions || [];

  if (transactions.length === 0) {
    return {
      totalAttempted: 0,
      successCount: 0,
      failureCount: 0,
      successfulLinks: [],
      failedLinks: []
    };
  }

  // Link all transactions
  const linkResult = await linkMultipleTransactions(accountId, transactions, 'auto');

  // Mark as processed in pending_transaction_suggestions if they exist
  for (const transaction of transactions) {
    try {
      const updateQuery = `
        UPDATE pending_transaction_suggestions
        SET status = 'approved',
            suggested_account_id = ?,
            reviewed_at = datetime('now')
        WHERE transaction_identifier = ?
          AND transaction_vendor = ?
          AND status = 'pending'
      `;

      await pool.query(updateQuery, [
        accountId,
        transaction.transactionIdentifier,
        transaction.transactionVendor
      ]);
    } catch (error) {
      console.error(`Failed to update suggestion status for transaction ${transaction.transactionIdentifier}:`, error);
    }
  }

  return linkResult;
}

/**
 * Unlink a transaction from an investment account
 * @param {string} transactionIdentifier
 * @param {string} transactionVendor
 * @returns {Promise<boolean>} Success status
 */
async function unlinkTransaction(transactionIdentifier, transactionVendor) {
  const query = `
    DELETE FROM transaction_account_links
    WHERE transaction_identifier = ?
      AND transaction_vendor = ?
  `;

  const result = await pool.query(query, [transactionIdentifier, transactionVendor]);

  return result.rowsAffected > 0;
}

/**
 * Get all linked transactions for an account
 * @param {number} accountId - Investment account ID
 * @returns {Promise<Array>} Array of linked transactions
 */
async function getLinkedTransactions(accountId) {
  const query = `
    SELECT
      tal.*,
      t.description,
      t.date,
      t.price,
      t.vendor as transaction_vendor_name
    FROM transaction_account_links tal
    JOIN transactions t ON tal.transaction_identifier = t.identifier
      AND tal.transaction_vendor = t.vendor
    WHERE tal.account_id = ?
    ORDER BY t.date DESC
  `;

  const result = await pool.query(query, [accountId]);

  return result.rows;
}

/**
 * Calculate cost basis from linked transactions
 * @param {number} accountId - Investment account ID
 * @returns {Promise<number>} Total cost basis
 */
async function calculateCostBasis(accountId) {
  const query = `
    SELECT SUM(ABS(t.price)) as total_cost
    FROM transaction_account_links tal
    JOIN transactions t ON tal.transaction_identifier = t.identifier
      AND tal.transaction_vendor = t.vendor
    WHERE tal.account_id = ?
      AND t.price < 0
  `;

  const result = await pool.query(query, [accountId]);

  return result.rows[0]?.total_cost || 0;
}

/**
 * Get transaction count for an account
 * @param {number} accountId - Investment account ID
 * @returns {Promise<number>} Transaction count
 */
async function getTransactionCount(accountId) {
  const query = `
    SELECT COUNT(*) as count
    FROM transaction_account_links
    WHERE account_id = ?
  `;

  const result = await pool.query(query, [accountId]);

  return result.rows[0]?.count || 0;
}

module.exports = {
  linkTransactionToAccount,
  linkMultipleTransactions,
  linkFromSuggestions,
  linkFromGroupedSuggestion,
  unlinkTransaction,
  getLinkedTransactions,
  calculateCostBasis,
  getTransactionCount
};
