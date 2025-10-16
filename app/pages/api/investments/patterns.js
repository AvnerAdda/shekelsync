// API for managing account transaction patterns
import { getDB } from '../db';

async function handler(req, res) {
  const db = await getDB();

  if (req.method === 'GET') {
    return getPatterns(req, res, db);
  } else if (req.method === 'POST') {
    return addPattern(req, res, db);
  } else if (req.method === 'DELETE') {
    return deletePattern(req, res, db);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Get patterns for an account
async function getPatterns(req, res, db) {
  const { account_id } = req.query;

  try {
    let query = `
      SELECT 
        atp.id,
        atp.account_id,
        atp.pattern,
        atp.pattern_type,
        atp.is_active,
        atp.match_count,
        atp.created_at,
        atp.last_matched,
        ia.account_name
      FROM account_transaction_patterns atp
      JOIN investment_accounts ia ON atp.account_id = ia.id
    `;

    const params = [];
    if (account_id) {
      query += ' WHERE atp.account_id = $1';
      params.push(account_id);
    }

    query += ' ORDER BY ia.account_name, atp.pattern';

    const result = await db.query(query, params);

    return res.status(200).json({
      success: true,
      patterns: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching patterns:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Add a new pattern
async function addPattern(req, res, db) {
  const { account_id, pattern, pattern_type = 'substring' } = req.body;

  if (!account_id || !pattern) {
    return res.status(400).json({ 
      error: 'Missing required fields: account_id, pattern' 
    });
  }

  if (!['substring', 'exact', 'regex'].includes(pattern_type)) {
    return res.status(400).json({ 
      error: 'Invalid pattern_type. Use: substring, exact, or regex' 
    });
  }

  try {
    // Check if pattern already exists for this account
    const existingQuery = `
      SELECT id FROM account_transaction_patterns
      WHERE account_id = $1 AND pattern = $2
    `;
    const existing = await db.query(existingQuery, [account_id, pattern]);

    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Pattern already exists for this account' 
      });
    }

    // Insert new pattern
    const insertQuery = `
      INSERT INTO account_transaction_patterns (
        account_id,
        pattern,
        pattern_type,
        is_active
      ) VALUES ($1, $2, $3, true)
      RETURNING *
    `;

    const result = await db.query(insertQuery, [account_id, pattern, pattern_type]);

    return res.status(201).json({
      success: true,
      pattern: result.rows[0],
      message: 'Pattern added successfully'
    });
  } catch (error) {
    console.error('Error adding pattern:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Delete a pattern
async function deletePattern(req, res, db) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing pattern ID' });
  }

  try {
    const result = await db.query(
      'DELETE FROM account_transaction_patterns WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Pattern deleted successfully',
      deleted: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting pattern:', error);
    return res.status(500).json({ error: error.message });
  }
}

export default handler;
