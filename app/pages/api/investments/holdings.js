import { getDB } from '../db.js';

/**
 * Investment Holdings API
 * GET /api/investments/holdings - Get current holdings for all accounts or specific account
 * POST /api/investments/holdings - Create/update holdings snapshot
 * DELETE /api/investments/holdings - Delete a holding record
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      // Get holdings
      const { accountId, includeHistory = 'false' } = req.query;

      if (includeHistory === 'true') {
        // Get historical holdings
        const query = accountId
          ? `
            SELECT 
              ihh.*,
              ia.account_name,
              ia.account_type,
              ia.institution
            FROM investment_holdings_history ihh
            JOIN investment_accounts ia ON ihh.account_id = ia.id
            WHERE ihh.account_id = $1
            ORDER BY ihh.snapshot_date DESC
          `
          : `
            SELECT 
              ihh.*,
              ia.account_name,
              ia.account_type,
              ia.institution
            FROM investment_holdings_history ihh
            JOIN investment_accounts ia ON ihh.account_id = ia.id
            ORDER BY ihh.snapshot_date DESC, ia.account_name
          `;

        const result = accountId
          ? await client.query(query, [accountId])
          : await client.query(query);

        return res.status(200).json({
          history: result.rows.map(row => ({
            ...row,
            total_value: parseFloat(row.total_value),
            cost_basis: row.cost_basis ? parseFloat(row.cost_basis) : null,
          }))
        });
      }

      // Get current holdings (latest snapshot per account)
      const query = accountId
        ? `
          SELECT 
            ih.*,
            ia.account_name,
            ia.account_type,
            ia.institution,
            ia.currency
          FROM investment_holdings ih
          JOIN investment_accounts ia ON ih.account_id = ia.id
          WHERE ih.account_id = $1
          ORDER BY ih.as_of_date DESC
          LIMIT 1
        `
        : `
          SELECT DISTINCT ON (ih.account_id)
            ih.*,
            ia.account_name,
            ia.account_type,
            ia.institution,
            ia.currency
          FROM investment_holdings ih
          JOIN investment_accounts ia ON ih.account_id = ia.id
          WHERE ia.is_active = true
          ORDER BY ih.account_id, ih.as_of_date DESC
        `;

      const result = accountId
        ? await client.query(query, [accountId])
        : await client.query(query);

      return res.status(200).json({
        holdings: result.rows.map(row => ({
          ...row,
          current_value: parseFloat(row.current_value),
          cost_basis: row.cost_basis ? parseFloat(row.cost_basis) : null,
          units: row.units ? parseFloat(row.units) : null,
        }))
      });
    }

    if (req.method === 'POST') {
      // Create or update holdings snapshot
      const {
        account_id,
        current_value,
        cost_basis,
        as_of_date,
        asset_name,
        asset_type,
        units,
        notes,
        save_history = true,
      } = req.body;

      if (!account_id || current_value === undefined || !as_of_date) {
        return res.status(400).json({
          error: 'account_id, current_value, and as_of_date are required'
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

      await client.query('BEGIN');

      try {
        // Insert or update current holdings
        const holdingsQuery = `
          INSERT INTO investment_holdings (
            account_id, current_value, cost_basis, as_of_date, 
            asset_name, asset_type, units, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (account_id, as_of_date) 
          DO UPDATE SET
            current_value = EXCLUDED.current_value,
            cost_basis = EXCLUDED.cost_basis,
            asset_name = EXCLUDED.asset_name,
            asset_type = EXCLUDED.asset_type,
            units = EXCLUDED.units,
            notes = EXCLUDED.notes,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `;

        const holdingsResult = await client.query(holdingsQuery, [
          account_id,
          current_value,
          cost_basis || null,
          as_of_date,
          asset_name || null,
          asset_type || null,
          units || null,
          notes || null,
        ]);

        // Save to history if requested
        if (save_history) {
          const historyQuery = `
            INSERT INTO investment_holdings_history (
              account_id, total_value, cost_basis, snapshot_date, notes
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account_id, snapshot_date)
            DO UPDATE SET
              total_value = EXCLUDED.total_value,
              cost_basis = EXCLUDED.cost_basis,
              notes = EXCLUDED.notes
            RETURNING *
          `;

          await client.query(historyQuery, [
            account_id,
            current_value,
            cost_basis || null,
            as_of_date,
            notes || null,
          ]);
        }

        await client.query('COMMIT');

        return res.status(201).json({
          holding: {
            ...holdingsResult.rows[0],
            current_value: parseFloat(holdingsResult.rows[0].current_value),
            cost_basis: holdingsResult.rows[0].cost_basis
              ? parseFloat(holdingsResult.rows[0].cost_basis)
              : null,
          }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    if (req.method === 'DELETE') {
      // Delete a holding record
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Holding id is required' });
      }

      const result = await client.query(
        'DELETE FROM investment_holdings WHERE id = $1 RETURNING *',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Holding not found' });
      }

      return res.status(200).json({
        message: 'Holding deleted',
        holding: result.rows[0]
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Error in investment holdings API:', error);
    return res.status(500).json({
      error: 'Failed to process request',
      details: error.message
    });
  } finally {
    client.release();
  }
}
