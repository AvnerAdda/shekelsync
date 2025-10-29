import { getDB } from '../db.js';

/**
 * Manage account pairings between credit cards and bank accounts
 * GET: List all pairings
 * POST: Create new pairing
 * PUT: Update existing pairing
 * DELETE: Remove pairing
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(client, req, res);
      case 'POST':
        return await handlePost(client, req, res);
      case 'PUT':
        return await handlePut(client, req, res);
      case 'DELETE':
        return await handleDelete(client, req, res);
      default:
        return res.status(405).json({ message: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in pairing API:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    client.release();
  }
}

/**
 * GET - List all pairings
 */
async function handleGet(client, req, res) {
  const { include_inactive } = req.query;

  let query = `
    SELECT
      id,
      credit_card_vendor,
      credit_card_account_number,
      bank_vendor,
      bank_account_number,
      match_patterns,
      is_active,
      created_at,
      updated_at
    FROM account_pairings
  `;

  if (!include_inactive || include_inactive === 'false') {
    query += ' WHERE is_active = 1';
  }

  query += ' ORDER BY created_at DESC';

  const result = await client.query(query);

  const pairings = result.rows.map(row => ({
    id: row.id,
    creditCardVendor: row.credit_card_vendor,
    creditCardAccountNumber: row.credit_card_account_number,
    bankVendor: row.bank_vendor,
    bankAccountNumber: row.bank_account_number,
    matchPatterns: row.match_patterns ? JSON.parse(row.match_patterns) : [],
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  res.status(200).json({ pairings });
}

/**
 * POST - Create new pairing
 * Body: {
 *   creditCardVendor, creditCardAccountNumber,
 *   bankVendor, bankAccountNumber,
 *   matchPatterns (optional array of custom patterns),
 *   selectedTransactionIds (optional array of transaction IDs to immediately categorize)
 * }
 */
async function handlePost(client, req, res) {
  const {
    creditCardVendor,
    creditCardAccountNumber,
    bankVendor,
    bankAccountNumber,
    matchPatterns = [],
    selectedTransactionIds = []
  } = req.body;

  if (!creditCardVendor || !bankVendor) {
    return res.status(400).json({
      error: 'creditCardVendor and bankVendor are required'
    });
  }

  // Check if pairing already exists
  const existing = await client.query(
    `SELECT id FROM account_pairings
     WHERE credit_card_vendor = $1
       AND credit_card_account_number IS $2
       AND bank_vendor = $3
       AND bank_account_number IS $4`,
    [creditCardVendor, creditCardAccountNumber || null, bankVendor, bankAccountNumber || null]
  );

  if (existing.rows.length > 0) {
    return res.status(409).json({
      error: 'Pairing already exists',
      existingId: existing.rows[0].id
    });
  }

  // Create the pairing
  const insertResult = await client.query(
    `INSERT INTO account_pairings (
      credit_card_vendor,
      credit_card_account_number,
      bank_vendor,
      bank_account_number,
      match_patterns,
      is_active
    ) VALUES ($1, $2, $3, $4, $5, 1)
    RETURNING id`,
    [
      creditCardVendor,
      creditCardAccountNumber || null,
      bankVendor,
      bankAccountNumber || null,
      JSON.stringify(matchPatterns)
    ]
  );

  const pairingId = insertResult.rows[0].id;

  // If specific transaction IDs were selected, categorize them immediately
  let categorizedCount = 0;
  if (selectedTransactionIds && selectedTransactionIds.length > 0) {
    const placeholders = selectedTransactionIds.map((_, i) => `$${i + 1}`).join(',');
    const updateResult = await client.query(
      `UPDATE transactions
       SET category_definition_id = CASE
         WHEN price < 0 THEN 25
         WHEN price > 0 THEN 75
         ELSE category_definition_id
       END
       WHERE identifier IN (${placeholders})
         AND vendor = $${selectedTransactionIds.length + 1}`,
      [...selectedTransactionIds, bankVendor]
    );
    categorizedCount = updateResult.rowCount;
  }

  // Log the action
  await client.query(
    `INSERT INTO account_pairing_log (pairing_id, action, transaction_count, details)
     VALUES ($1, 'created', $2, $3)`,
    [pairingId, categorizedCount, JSON.stringify({ selectedTransactionIds })]
  );

  res.status(201).json({
    message: 'Pairing created successfully',
    pairingId,
    categorizedCount
  });
}

/**
 * PUT - Update existing pairing
 * Body: { id, matchPatterns, isActive }
 */
async function handlePut(client, req, res) {
  const { id, matchPatterns, isActive } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Pairing ID is required' });
  }

  const updates = [];
  const params = [id];
  let paramIndex = 2;

  if (matchPatterns !== undefined) {
    updates.push(`match_patterns = $${paramIndex}`);
    params.push(JSON.stringify(matchPatterns));
    paramIndex++;
  }

  if (isActive !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    params.push(isActive ? 1 : 0);
    paramIndex++;
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push(`updated_at = datetime('now')`);

  const query = `
    UPDATE account_pairings
    SET ${updates.join(', ')}
    WHERE id = $1
  `;

  const result = await client.query(query, params);

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Pairing not found' });
  }

  // Log the action
  await client.query(
    `INSERT INTO account_pairing_log (pairing_id, action, details)
     VALUES ($1, 'updated', $2)`,
    [id, JSON.stringify({ matchPatterns, isActive })]
  );

  res.status(200).json({ message: 'Pairing updated successfully' });
}

/**
 * DELETE - Remove pairing
 * Query param: id
 */
async function handleDelete(client, req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Pairing ID is required' });
  }

  const result = await client.query(
    'DELETE FROM account_pairings WHERE id = $1',
    [id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Pairing not found' });
  }

  // Log the action
  await client.query(
    `INSERT INTO account_pairing_log (pairing_id, action)
     VALUES ($1, 'deleted')`,
    [id]
  );

  res.status(200).json({ message: 'Pairing deleted successfully' });
}
