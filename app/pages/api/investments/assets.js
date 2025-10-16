import { getDB } from '../db.js';

/**
 * Investment Assets API
 * GET /api/investments/assets - Get individual asset holdings
 * POST /api/investments/assets - Create/update individual asset
 * PUT /api/investments/assets - Update individual asset
 * DELETE /api/investments/assets - Delete individual asset
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      // Get individual assets
      const { accountId, includeInactive = 'false' } = req.query;

      const query = accountId
        ? `
          SELECT 
            iasset.*,
            ia.account_name,
            ia.account_type,
            ia.institution
          FROM investment_assets iasset
          JOIN investment_accounts ia ON iasset.account_id = ia.id
          WHERE iasset.account_id = $1
          ${includeInactive === 'false' ? 'AND iasset.is_active = true' : ''}
          ORDER BY iasset.asset_name
        `
        : `
          SELECT 
            iasset.*,
            ia.account_name,
            ia.account_type,
            ia.institution
          FROM investment_assets iasset
          JOIN investment_accounts ia ON iasset.account_id = ia.id
          ${includeInactive === 'false' ? 'WHERE iasset.is_active = true' : ''}
          ORDER BY ia.account_name, iasset.asset_name
        `;

      const result = accountId
        ? await client.query(query, [accountId])
        : await client.query(query);

      return res.status(200).json({
        assets: result.rows.map(row => ({
          ...row,
          units: parseFloat(row.units),
          average_cost: row.average_cost ? parseFloat(row.average_cost) : null,
        }))
      });
    }

    if (req.method === 'POST') {
      // Create new asset
      const {
        account_id,
        asset_symbol,
        asset_name,
        asset_type,
        units,
        average_cost,
        currency = 'USD',
        notes,
      } = req.body;

      if (!account_id || !asset_name || units === undefined) {
        return res.status(400).json({
          error: 'account_id, asset_name, and units are required'
        });
      }

      // Verify account exists
      const accountCheck = await client.query(
        'SELECT id FROM investment_accounts WHERE id = $1',
        [account_id]
      );

      if (accountCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Account not found' });
      }

      const insertQuery = `
        INSERT INTO investment_assets (
          account_id, asset_symbol, asset_name, asset_type,
          units, average_cost, currency, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const result = await client.query(insertQuery, [
        account_id,
        asset_symbol || null,
        asset_name,
        asset_type || null,
        units,
        average_cost || null,
        currency,
        notes || null,
      ]);

      return res.status(201).json({
        asset: {
          ...result.rows[0],
          units: parseFloat(result.rows[0].units),
          average_cost: result.rows[0].average_cost
            ? parseFloat(result.rows[0].average_cost)
            : null,
        }
      });
    }

    if (req.method === 'PUT') {
      // Update asset
      const {
        id,
        asset_symbol,
        asset_name,
        asset_type,
        units,
        average_cost,
        currency,
        notes,
        is_active,
      } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Asset id is required' });
      }

      const updates = [];
      const values = [];
      let paramCount = 1;

      if (asset_symbol !== undefined) {
        updates.push(`asset_symbol = $${paramCount++}`);
        values.push(asset_symbol);
      }
      if (asset_name !== undefined) {
        updates.push(`asset_name = $${paramCount++}`);
        values.push(asset_name);
      }
      if (asset_type !== undefined) {
        updates.push(`asset_type = $${paramCount++}`);
        values.push(asset_type);
      }
      if (units !== undefined) {
        updates.push(`units = $${paramCount++}`);
        values.push(units);
      }
      if (average_cost !== undefined) {
        updates.push(`average_cost = $${paramCount++}`);
        values.push(average_cost);
      }
      if (currency !== undefined) {
        updates.push(`currency = $${paramCount++}`);
        values.push(currency);
      }
      if (notes !== undefined) {
        updates.push(`notes = $${paramCount++}`);
        values.push(notes);
      }
      if (is_active !== undefined) {
        updates.push(`is_active = $${paramCount++}`);
        values.push(is_active);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(id);
      const updateQuery = `
        UPDATE investment_assets
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await client.query(updateQuery, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Asset not found' });
      }

      return res.status(200).json({
        asset: {
          ...result.rows[0],
          units: parseFloat(result.rows[0].units),
          average_cost: result.rows[0].average_cost
            ? parseFloat(result.rows[0].average_cost)
            : null,
        }
      });
    }

    if (req.method === 'DELETE') {
      // Delete asset (soft delete)
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Asset id is required' });
      }

      const result = await client.query(
        'UPDATE investment_assets SET is_active = false WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Asset not found' });
      }

      return res.status(200).json({
        message: 'Asset deactivated',
        asset: result.rows[0]
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error in investment assets API:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      details: error.message
    });
  } finally {
    client.release();
  }
}
