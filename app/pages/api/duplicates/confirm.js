import { getDB } from '../db.js';

/**
 * Confirm a duplicate transaction pair
 * POST /api/duplicates/confirm
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { transaction1, transaction2, matchType, confidence, notes } = req.body;

    if (!transaction1 || !transaction2 || !matchType) {
      return res.status(400).json({
        error: 'Missing required fields: transaction1, transaction2, matchType'
      });
    }

    // Verify both transactions exist
    const txn1Check = await client.query(
      'SELECT identifier, vendor FROM transactions WHERE identifier = $1 AND vendor = $2',
      [transaction1.identifier, transaction1.vendor]
    );

    const txn2Check = await client.query(
      'SELECT identifier, vendor FROM transactions WHERE identifier = $1 AND vendor = $2',
      [transaction2.identifier, transaction2.vendor]
    );

    if (txn1Check.rows.length === 0 || txn2Check.rows.length === 0) {
      return res.status(404).json({
        error: 'One or both transactions not found'
      });
    }

    // Check if this duplicate pair already exists
    const existingCheck = await client.query(
      `SELECT id FROM transaction_duplicates
       WHERE (
         (transaction1_identifier = $1 AND transaction1_vendor = $2 AND
          transaction2_identifier = $3 AND transaction2_vendor = $4)
         OR
         (transaction1_identifier = $3 AND transaction1_vendor = $4 AND
          transaction2_identifier = $1 AND transaction2_vendor = $2)
       )`,
      [
        transaction1.identifier,
        transaction1.vendor,
        transaction2.identifier,
        transaction2.vendor
      ]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'This duplicate pair already exists',
        duplicateId: existingCheck.rows[0].id
      });
    }

    // Insert the duplicate pair
    const insertResult = await client.query(
      `INSERT INTO transaction_duplicates (
        transaction1_identifier,
        transaction1_vendor,
        transaction2_identifier,
        transaction2_vendor,
        match_type,
        confidence,
        is_confirmed,
        exclude_from_totals,
        notes,
        confirmed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING id`,
      [
        transaction1.identifier,
        transaction1.vendor,
        transaction2.identifier,
        transaction2.vendor,
        matchType,
        confidence || 1.0,
        true,
        true,
        notes || null
      ]
    );

    const duplicateId = insertResult.rows[0].id;

    res.status(201).json({
      message: 'Duplicate confirmed successfully',
      duplicateId,
      excludedFromTotals: true
    });

  } catch (error) {
    console.error('Error confirming duplicate:', error);
    res.status(500).json({
      error: 'Failed to confirm duplicate',
      details: error.message
    });
  } finally {
    client.release();
  }
}
