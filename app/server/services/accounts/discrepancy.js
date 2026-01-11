const database = require('../database.js');
const { v4: uuidv4 } = require('uuid');

// Category ID for Bank & Card Fees
const CC_FEES_CATEGORY_ID = null; // Will be looked up dynamically

/**
 * Find the CC fees category ID
 */
async function getCCFeesCategoryId(client) {
  const result = await client.query(`
    SELECT id FROM category_definitions
    WHERE name_en = 'Bank & Card Fees'
    OR name = 'עמלות בנק וכרטיס'
    LIMIT 1
  `);
  return result.rows[0]?.id || null;
}

/**
 * Resolve a discrepancy for a pairing
 *
 * @param {object} params
 * @param {number} params.pairingId - The pairing ID
 * @param {string} params.action - 'ignore' or 'add_cc_fee'
 * @param {string} params.cycleDate - Optional billing/repayment cycle date (YYYY-MM-DD)
 * @param {object} params.feeDetails - Required if action is 'add_cc_fee'
 * @param {number} params.feeDetails.amount - The fee amount (positive value)
 * @param {string} params.feeDetails.date - Transaction date
 * @param {string} params.feeDetails.name - Transaction name/description
 * @param {string} params.feeDetails.processedDate - Optional processed_date to align with billing cycle
 */
async function resolveDiscrepancy(params) {
  const { pairingId, action, feeDetails, cycleDate } = params;

  if (!pairingId) {
    const error = new Error('pairingId is required');
    error.status = 400;
    throw error;
  }

  if (!action || !['ignore', 'add_cc_fee'].includes(action)) {
    const error = new Error('action must be "ignore" or "add_cc_fee"');
    error.status = 400;
    throw error;
  }

  if (action === 'add_cc_fee') {
    if (!feeDetails || !feeDetails.amount || !feeDetails.date || !feeDetails.name) {
      const error = new Error('feeDetails (amount, date, name) required for add_cc_fee action');
      error.status = 400;
      throw error;
    }
  }

  const client = await database.getClient();

  try {
    // Get the pairing
    const pairingResult = await client.query(
      'SELECT * FROM account_pairings WHERE id = $1',
      [pairingId]
    );

    if (pairingResult.rows.length === 0) {
      const error = new Error('Pairing not found');
      error.status = 404;
      throw error;
    }

    const pairing = pairingResult.rows[0];

    if (action === 'ignore') {
      // Set discrepancy_acknowledged flag
      await client.query(
        `UPDATE account_pairings
         SET discrepancy_acknowledged = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [pairingId]
      );

      // Log the action
      await client.query(
        `INSERT INTO account_pairing_log (pairing_id, action, details, created_at)
         VALUES ($1, 'discrepancy_ignored', $2, CURRENT_TIMESTAMP)`,
        [pairingId, JSON.stringify({ action: 'ignore', cycleDate: cycleDate || null, timestamp: new Date().toISOString() })]
      );

      return {
        success: true,
        resolution: 'ignored',
      };
    }

    if (action === 'add_cc_fee') {
      // Get the CC fees category ID
      const categoryId = await getCCFeesCategoryId(client);

      const feeDate = feeDetails.date || cycleDate;
      const processedDate = feeDetails.processedDate || cycleDate || null;

      if (!feeDate) {
        const error = new Error('feeDetails.date or cycleDate is required for add_cc_fee action');
        error.status = 400;
        throw error;
      }

      // Generate unique transaction identifier
      const transactionId = `fee-${pairingId}-${uuidv4().slice(0, 8)}`;

      // Create the fee transaction
      // Fee goes to the CC vendor as a negative amount (expense)
      const feeAmount = -Math.abs(feeDetails.amount); // Ensure negative (expense)

      await client.query(
        `INSERT INTO transactions (
          identifier,
          vendor,
          vendor_nickname,
          date,
          processed_date,
          name,
          price,
          type,
          account_number,
          status,
          category_definition_id,
          auto_categorized,
          confidence_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          transactionId,
          pairing.credit_card_vendor,
          null, // vendor_nickname
          feeDate,
          processedDate,
          feeDetails.name,
          feeAmount,
          'fee', // type
          pairing.credit_card_account_number,
          'completed',
          categoryId,
          1, // auto_categorized
          1.0, // confidence_score
        ]
      );

      // Set discrepancy_acknowledged flag
      await client.query(
        `UPDATE account_pairings
         SET discrepancy_acknowledged = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [pairingId]
      );

      // Log the action
      await client.query(
        `INSERT INTO account_pairing_log (pairing_id, action, details, created_at)
         VALUES ($1, 'fee_created', $2, CURRENT_TIMESTAMP)`,
        [
          pairingId,
          JSON.stringify({
            transactionId,
            amount: feeAmount,
            date: feeDate,
            processedDate,
            cycleDate: cycleDate || null,
            name: feeDetails.name,
            categoryId,
          }),
        ]
      );

      return {
        success: true,
        resolution: 'fee_created',
        transactionId,
        transaction: {
          identifier: transactionId,
          vendor: pairing.credit_card_vendor,
          date: feeDate,
          name: feeDetails.name,
          price: feeAmount,
        },
      };
    }
  } finally {
    client.release();
  }
}

/**
 * Reset discrepancy acknowledgment for a pairing
 * Called when new transactions are imported that might affect the discrepancy
 */
async function resetDiscrepancyAcknowledgment(pairingId) {
  const result = await database.query(
    `UPDATE account_pairings
     SET discrepancy_acknowledged = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [pairingId]
  );

  return { updated: result.rowCount > 0 };
}

/**
 * Get discrepancy status for a pairing
 */
async function getDiscrepancyStatus(pairingId) {
  const result = await database.query(
    `SELECT discrepancy_acknowledged FROM account_pairings WHERE id = $1`,
    [pairingId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    acknowledged: Boolean(result.rows[0].discrepancy_acknowledged),
  };
}

module.exports = {
  resolveDiscrepancy,
  resetDiscrepancyAcknowledgment,
  getDiscrepancyStatus,
};

module.exports.default = module.exports;
