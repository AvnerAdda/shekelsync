import { getDB } from '../db.js';

/**
 * Remove manual exclusion from a transaction (restore to normal)
 * DELETE /api/duplicates/manual-include
 */
export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { transactionIdentifier, transactionVendor } = req.body;

    if (!transactionIdentifier || !transactionVendor) {
      return res.status(400).json({
        error: 'Missing required fields: transactionIdentifier, transactionVendor'
      });
    }

    // Check if manual_exclusions table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'manual_exclusions'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      return res.status(500).json({
        error: 'Manual exclusions feature not available. Run database migration first.'
      });
    }

    // Check if exclusion exists
    const existingCheck = await client.query(
      `SELECT id, exclusion_reason FROM manual_exclusions
       WHERE transaction_identifier = $1 AND transaction_vendor = $2`,
      [transactionIdentifier, transactionVendor]
    );

    if (existingCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'No manual exclusion found for this transaction'
      });
    }

    const exclusion = existingCheck.rows[0];

    // Delete the manual exclusion
    await client.query(
      `DELETE FROM manual_exclusions
       WHERE transaction_identifier = $1 AND transaction_vendor = $2`,
      [transactionIdentifier, transactionVendor]
    );

    res.status(200).json({
      message: 'Manual exclusion removed successfully. Transaction is now included in totals.',
      removedExclusion: {
        id: exclusion.id,
        reason: exclusion.exclusion_reason
      }
    });

  } catch (error) {
    console.error('Error including transaction:', error);
    res.status(500).json({
      error: 'Failed to include transaction',
      details: error.message
    });
  } finally {
    client.release();
  }
}
