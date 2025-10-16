import { getDB } from '../db.js';

/**
 * Investment Accounts API
 * GET /api/investments/accounts - List all accounts
 * POST /api/investments/accounts - Create new account
 * PUT /api/investments/accounts - Update account
 * DELETE /api/investments/accounts - Delete account
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      // Get all investment accounts
      const { includeInactive = 'false' } = req.query;
      
      const query = `
        SELECT 
          ia.*,
          COUNT(DISTINCT ih.id) as holdings_count,
          MAX(ih.as_of_date) as last_update_date,
          (SELECT current_value FROM investment_holdings 
           WHERE account_id = ia.id 
           ORDER BY as_of_date DESC 
           LIMIT 1) as current_value
        FROM investment_accounts ia
        LEFT JOIN investment_holdings ih ON ia.id = ih.account_id
        ${includeInactive === 'false' ? 'WHERE ia.is_active = true' : ''}
        GROUP BY ia.id
        ORDER BY ia.account_type, ia.account_name
      `;

      const result = await client.query(query);
      
      return res.status(200).json({
        accounts: result.rows.map(row => ({
          ...row,
          current_value: row.current_value ? parseFloat(row.current_value) : null,
          holdings_count: parseInt(row.holdings_count),
        }))
      });
    }

    if (req.method === 'POST') {
      // Create new investment account
      const {
        account_name,
        account_type,
        institution,
        account_number,
        currency = 'ILS',
        notes,
      } = req.body;

      if (!account_name || !account_type) {
        return res.status(400).json({ error: 'account_name and account_type are required' });
      }

      const validTypes = [
        'pension', 'provident', 'study_fund', 'savings', 'brokerage',
        'crypto', 'mutual_fund', 'bonds', 'real_estate', 'other'
      ];

      if (!validTypes.includes(account_type)) {
        return res.status(400).json({ error: `Invalid account_type. Must be one of: ${validTypes.join(', ')}` });
      }

      const insertQuery = `
        INSERT INTO investment_accounts (
          account_name, account_type, institution, account_number, currency, notes
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      const result = await client.query(insertQuery, [
        account_name,
        account_type,
        institution || null,
        account_number || null,
        currency,
        notes || null,
      ]);

      return res.status(201).json({ account: result.rows[0] });
    }

    if (req.method === 'PUT') {
      // Update investment account
      const {
        id,
        account_name,
        account_type,
        institution,
        account_number,
        currency,
        is_active,
        notes,
      } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Account id is required' });
      }

      const updates = [];
      const values = [];
      let paramCount = 1;

      if (account_name !== undefined) {
        updates.push(`account_name = $${paramCount++}`);
        values.push(account_name);
      }
      if (account_type !== undefined) {
        updates.push(`account_type = $${paramCount++}`);
        values.push(account_type);
      }
      if (institution !== undefined) {
        updates.push(`institution = $${paramCount++}`);
        values.push(institution);
      }
      if (account_number !== undefined) {
        updates.push(`account_number = $${paramCount++}`);
        values.push(account_number);
      }
      if (currency !== undefined) {
        updates.push(`currency = $${paramCount++}`);
        values.push(currency);
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${paramCount++}`);
        values.push(is_active);
      }
      if (notes !== undefined) {
        updates.push(`notes = $${paramCount++}`);
        values.push(notes);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(id);
      const updateQuery = `
        UPDATE investment_accounts
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await client.query(updateQuery, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      return res.status(200).json({ account: result.rows[0] });
    }

    if (req.method === 'DELETE') {
      // Delete investment account
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Account id is required' });
      }

      // Soft delete by setting is_active = false
      const result = await client.query(
        'UPDATE investment_accounts SET is_active = false WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      return res.status(200).json({ message: 'Account deactivated', account: result.rows[0] });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error in investment accounts API:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      details: error.message
    });
  } finally {
    client.release();
  }
}
