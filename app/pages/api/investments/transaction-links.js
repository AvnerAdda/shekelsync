// API for managing transaction-to-account links
import { getDB } from '../db';

async function handler(req, res) {
  const db = await getDB();
  
  if (req.method === 'GET') {
    return getTransactionLinks(req, res, db);
  } else if (req.method === 'POST') {
    return createTransactionLink(req, res, db);
  } else if (req.method === 'DELETE') {
    return deleteTransactionLink(req, res, db);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Get all transaction links for an account
async function getTransactionLinks(req, res, db) {
  const { account_id } = req.query;

  try {
    const query = `
      SELECT 
        tal.id,
        tal.transaction_identifier,
        tal.transaction_vendor,
        tal.transaction_date,
        tal.account_id,
        tal.link_method,
        tal.confidence,
        tal.created_at,
        t.name as transaction_name,
        t.price as transaction_amount,
        t.category as transaction_category,
        ia.account_name
      FROM transaction_account_links tal
      JOIN transactions t ON tal.transaction_identifier = t.identifier 
        AND tal.transaction_vendor = t.vendor
      JOIN investment_accounts ia ON tal.account_id = ia.id
      ${account_id ? 'WHERE tal.account_id = $1' : ''}
      ORDER BY tal.transaction_date DESC, tal.created_at DESC
    `;

    const params = account_id ? [account_id] : [];
    const result = await db.query(query, params);

    return res.status(200).json({
      success: true,
      links: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching transaction links:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Create a new transaction link (manual coupling)
async function createTransactionLink(req, res, db) {
  const { transaction_identifier, transaction_vendor, account_id, link_method = 'manual' } = req.body;

  if (!transaction_identifier || !transaction_vendor || !account_id) {
    return res.status(400).json({ 
      error: 'Missing required fields: transaction_identifier, transaction_vendor, account_id' 
    });
  }

  try {
    // Get transaction details
    const txnQuery = `
      SELECT identifier, vendor, date 
      FROM transactions 
      WHERE identifier = $1 AND vendor = $2
    `;
    const txnResult = await db.query(txnQuery, [transaction_identifier, transaction_vendor]);
    
    if (txnResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const txn = txnResult.rows[0];

    // Insert the link
    const insertQuery = `
      INSERT INTO transaction_account_links (
        transaction_identifier,
        transaction_vendor,
        transaction_date,
        account_id,
        link_method,
        confidence
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (transaction_identifier, transaction_vendor) 
      DO UPDATE SET 
        account_id = EXCLUDED.account_id,
        link_method = EXCLUDED.link_method,
        confidence = EXCLUDED.confidence
      RETURNING *
    `;

    const result = await db.query(insertQuery, [
      transaction_identifier,
      transaction_vendor,
      txn.date,
      account_id,
      link_method,
      link_method === 'manual' ? 1.0 : 0.95
    ]);

    return res.status(201).json({
      success: true,
      link: result.rows[0],
      message: 'Transaction linked successfully'
    });
  } catch (error) {
    console.error('Error creating transaction link:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Delete a transaction link
async function deleteTransactionLink(req, res, db) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing link ID' });
  }

  try {
    const result = await db.query(
      'DELETE FROM transaction_account_links WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Link deleted successfully',
      deleted: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting transaction link:', error);
    return res.status(500).json({ error: error.message });
  }
}

export default handler;
