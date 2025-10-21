// API to manage pending transaction-account suggestions
import { getDB } from '../db';

async function handler(req, res) {
  const db = await getDB();
  
  if (req.method === 'GET') {
    return getPendingSuggestions(req, res, db);
  } else if (req.method === 'POST') {
    return handleSuggestion(req, res, db);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Get all pending suggestions
async function getPendingSuggestions(req, res, db) {
  const { status = 'pending' } = req.query;

  try {
    const query = `
      SELECT 
        pts.*,
        ia.account_name,
        ia.account_type
      FROM pending_transaction_suggestions pts
      LEFT JOIN investment_accounts ia ON pts.suggested_account_id = ia.id
      WHERE pts.status = $1
      ORDER BY pts.confidence DESC, pts.created_at DESC
    `;

    const result = await db.query(query, [status]);

    return res.status(200).json({
      success: true,
      pending_suggestions: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching pending suggestions:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Approve, reject, or ignore a suggestion
async function handleSuggestion(req, res, db) {
  const { id, action } = req.body; // action: 'approve', 'reject', 'ignore'

  if (!id || !action) {
    return res.status(400).json({ error: 'Missing required fields: id, action' });
  }

  if (!['approve', 'reject', 'ignore'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Use: approve, reject, or ignore' });
  }

  try {
    // Get the suggestion
    const suggestionQuery = `
      SELECT * FROM pending_transaction_suggestions WHERE id = $1
    `;
    const suggestionResult = await db.query(suggestionQuery, [id]);

    if (suggestionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    const suggestion = suggestionResult.rows[0];

    // Update suggestion status
    const updateQuery = `
      UPDATE pending_transaction_suggestions 
      SET status = $1, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    await db.query(updateQuery, [action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'ignored', id]);

    // If approved, create the actual link
    if (action === 'approve') {
      const linkQuery = `
        INSERT INTO transaction_account_links (
          transaction_identifier,
          transaction_vendor,
          transaction_date,
          account_id,
          link_method,
          confidence
        ) VALUES ($1, $2, $3, $4, 'user_confirmed', $5)
        ON CONFLICT (transaction_identifier, transaction_vendor) 
        DO UPDATE SET 
          account_id = EXCLUDED.account_id,
          link_method = 'user_confirmed',
          confidence = EXCLUDED.confidence
        RETURNING *
      `;

      const linkResult = await db.query(linkQuery, [
        suggestion.transaction_identifier,
        suggestion.transaction_vendor,
        suggestion.transaction_date,
        suggestion.suggested_account_id,
        suggestion.confidence
      ]);

      // Update the pattern match count (learning)
      const updatePatternQuery = `
        UPDATE account_transaction_patterns 
        SET match_count = match_count + 1, last_matched = CURRENT_TIMESTAMP
        WHERE account_id = $1 
          AND LOWER($2) LIKE LOWER(pattern)
      `;
      await db.query(updatePatternQuery, [suggestion.suggested_account_id, suggestion.transaction_name]);

      return res.status(200).json({
        success: true,
        action: 'approved',
        link_created: linkResult.rows[0],
        message: 'Transaction linked successfully'
      });
    } else {
      return res.status(200).json({
        success: true,
        action,
        message: `Suggestion ${action}d`
      });
    }

  } catch (error) {
    console.error('Error handling suggestion:', error);
    return res.status(500).json({ error: error.message });
  }
}

export default handler;
