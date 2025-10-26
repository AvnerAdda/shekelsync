import { getDB } from '../db.js';

/**
 * Manually exclude a transaction from totals
 * POST /api/duplicates/manual-exclude
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const {
      transactionIdentifier,
      transactionVendor,
      reason = 'duplicate',
      overrideCategoryDefinitionId = null,
      notes = null
    } = req.body;

    // Validate override category if provided
    let overrideCategory = null;
    let overrideCategoryId = null;
    if (overrideCategoryDefinitionId !== null) {
      const categoryResult = await client.query(
        `SELECT id, name
         FROM category_definitions
         WHERE id = $1`,
        [overrideCategoryDefinitionId]
      );

      if (categoryResult.rows.length === 0) {
        return res.status(404).json({ error: 'Override category not found' });
      }

      overrideCategoryId = overrideCategoryDefinitionId;
      overrideCategory = categoryResult.rows[0].name;
    }

    if (!transactionIdentifier || !transactionVendor) {
      return res.status(400).json({
        error: 'Missing required fields: transactionIdentifier, transactionVendor'
      });
    }

    // Verify transaction exists
    const txnCheck = await client.query(
      `SELECT identifier, vendor, name, price, category_definition_id
       FROM transactions
       WHERE identifier = $1 AND vendor = $2`,
      [transactionIdentifier, transactionVendor]
    );

    if (txnCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Transaction not found'
      });
    }

    const transaction = txnCheck.rows[0];

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

    // Check if already excluded manually
    const existingCheck = await client.query(
      `SELECT id FROM manual_exclusions
       WHERE transaction_identifier = $1 AND transaction_vendor = $2`,
      [transactionIdentifier, transactionVendor]
    );

    if (existingCheck.rows.length > 0) {
      // Update existing exclusion
      const updateResult = await client.query(
        `UPDATE manual_exclusions
         SET exclusion_reason = $1,
             override_category = $2,
             override_category_definition_id = $3,
             notes = $4,
             updated_at = NOW()
         WHERE transaction_identifier = $5 AND transaction_vendor = $6
         RETURNING id`,
        [reason, overrideCategory, overrideCategoryId, notes, transactionIdentifier, transactionVendor]
      );

      return res.status(200).json({
        message: 'Manual exclusion updated successfully',
        exclusionId: updateResult.rows[0].id,
        transaction: {
          ...transaction,
          isExcluded: true,
          exclusionReason: reason,
          overrideCategory,
          overrideCategoryDefinitionId: overrideCategoryId
        }
      });
    }

    // Check if already in a duplicate pair
    const duplicateCheck = await client.query(
      `SELECT id FROM transaction_duplicates
       WHERE (
         (transaction1_identifier = $1 AND transaction1_vendor = $2) OR
         (transaction2_identifier = $1 AND transaction2_vendor = $2)
       )
       AND exclude_from_totals = true`,
      [transactionIdentifier, transactionVendor]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'Transaction already excluded as part of a duplicate pair. Use the Confirmed tab to manage it.',
        duplicateId: duplicateCheck.rows[0].id
      });
    }

    // Insert new manual exclusion
    const insertResult = await client.query(
      `INSERT INTO manual_exclusions (
        transaction_identifier,
        transaction_vendor,
        exclusion_reason,
        override_category,
        override_category_definition_id,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [transactionIdentifier, transactionVendor, reason, overrideCategory, overrideCategoryId, notes]
    );

    const exclusionId = insertResult.rows[0].id;

    res.status(201).json({
      message: 'Transaction excluded successfully',
      exclusionId,
      transaction: {
        ...transaction,
        isExcluded: true,
        exclusionReason: reason,
        overrideCategory,
        overrideCategoryDefinitionId: overrideCategoryId
      }
    });

  } catch (error) {
    console.error('Error excluding transaction:', error);
    res.status(500).json({
      error: 'Failed to exclude transaction',
      details: error.message
    });
  } finally {
    client.release();
  }
}
