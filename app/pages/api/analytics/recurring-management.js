import { getDB } from '../db.js';

/**
 * Recurring Transaction Management API
 * Update user status for recurring transactions
 * 
 * POST /api/analytics/recurring-management
 * Body: { merchant_pattern, frequency, user_status, optimization_note }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { 
      merchant_pattern, 
      frequency, 
      user_status, 
      optimization_note 
    } = req.body;

    if (!merchant_pattern || !frequency) {
      return res.status(400).json({ 
        error: 'merchant_pattern and frequency are required' 
      });
    }

    // Validate user_status
    const validStatuses = ['active', 'marked_cancel', 'essential', 'reviewed'];
    if (user_status && !validStatuses.includes(user_status)) {
      return res.status(400).json({ 
        error: `Invalid user_status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }

    // Update or insert status
    const result = await client.query(`
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
    `, [merchant_pattern, frequency, user_status || 'active', optimization_note || null]);

    return res.status(200).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating recurring transaction status:', error);
    return res.status(500).json({
      error: 'Failed to update recurring transaction status',
      details: error.message
    });
  } finally {
    client.release();
  }
}
