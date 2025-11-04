const database = require('../database.js');

const VALID_STATUSES = new Set(['active', 'marked_cancel', 'essential', 'reviewed']);

async function updateRecurringStatus(payload = {}) {
  const {
    merchant_pattern: merchantPattern,
    frequency,
    user_status: userStatus,
    optimization_note: optimizationNote,
  } = payload;

  if (!merchantPattern || !frequency) {
    const error = new Error('merchant_pattern and frequency are required');
    error.status = 400;
    throw error;
  }

  if (userStatus && !VALID_STATUSES.has(userStatus)) {
    const error = new Error(
      `Invalid user_status. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
    );
    error.status = 400;
    throw error;
  }

  const result = await database.query(
    `
      INSERT INTO recurring_transaction_analysis (
        merchant_pattern,
        frequency,
        user_status,
        optimization_note,
        updated_at
      )
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (merchant_pattern, frequency)
      DO UPDATE SET
        user_status = $3,
        optimization_note = $4,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    [merchantPattern, frequency, userStatus || 'active', optimizationNote || null],
  );

  return {
    success: true,
    data: result.rows[0],
  };
}

module.exports = {
  updateRecurringStatus,
};

module.exports.default = module.exports;
