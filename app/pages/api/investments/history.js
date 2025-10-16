import pool from '../db';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { accountId, timeRange = '3m', accountIds } = req.query;

  try {
    let startDate = new Date();
    
    // Calculate start date based on time range
    switch (timeRange) {
      case '1m':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case '3m':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case '6m':
        startDate.setMonth(startDate.getMonth() - 6);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case 'all':
        startDate = null;
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 3);
    }

    let query;
    let params;

    if (accountId) {
      // Single account history
      query = `
        SELECT 
          ihh.snapshot_date,
          ihh.total_value as current_value,
          ihh.cost_basis,
          ihh.account_id,
          ia.account_name,
          ia.account_type
        FROM investment_holdings_history ihh
        JOIN investment_accounts ia ON ihh.account_id = ia.id
        WHERE ihh.account_id = $1
        ${startDate ? 'AND ihh.snapshot_date >= $2' : ''}
        ORDER BY ihh.snapshot_date ASC
      `;
      params = startDate ? [accountId, startDate.toISOString().split('T')[0]] : [accountId];
    } else if (accountIds) {
      // Multiple specific accounts
      const ids = Array.isArray(accountIds) ? accountIds : [accountIds];
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      
      query = `
        SELECT 
          ihh.snapshot_date,
          ihh.total_value as current_value,
          ihh.cost_basis,
          ihh.account_id,
          ia.account_name,
          ia.account_type
        FROM investment_holdings_history ihh
        JOIN investment_accounts ia ON ihh.account_id = ia.id
        WHERE ihh.account_id IN (${placeholders})
        ${startDate ? `AND ihh.snapshot_date >= $${ids.length + 1}` : ''}
        ORDER BY ihh.snapshot_date ASC, ihh.account_id
      `;
      params = startDate ? [...ids, startDate.toISOString().split('T')[0]] : ids;
    } else {
      // All accounts aggregated by date
      query = `
        SELECT 
          ihh.snapshot_date,
          SUM(ihh.total_value) as current_value,
          SUM(ihh.cost_basis) as cost_basis,
          COUNT(DISTINCT ihh.account_id) as account_count,
          json_agg(
            json_build_object(
              'account_id', ihh.account_id,
              'account_name', ia.account_name,
              'current_value', ihh.total_value,
              'cost_basis', ihh.cost_basis
            )
          ) as accounts
        FROM investment_holdings_history ihh
        JOIN investment_accounts ia ON ihh.account_id = ia.id
        ${startDate ? 'WHERE ihh.snapshot_date >= $1' : ''}
        GROUP BY ihh.snapshot_date
        ORDER BY ihh.snapshot_date ASC
      `;
      params = startDate ? [startDate.toISOString().split('T')[0]] : [];
    }

    const result = await pool.query(query, params);

    // Format the response
    const history = result.rows.map(row => ({
      date: row.snapshot_date,
      currentValue: parseFloat(row.current_value || 0),
      costBasis: parseFloat(row.cost_basis || 0),
      gainLoss: parseFloat(row.current_value || 0) - parseFloat(row.cost_basis || 0),
      roi: row.cost_basis > 0 ? ((parseFloat(row.current_value || 0) - parseFloat(row.cost_basis || 0)) / parseFloat(row.cost_basis || 0) * 100) : 0,
      accountId: row.account_id,
      accountName: row.account_name,
      accountType: row.account_type,
      accountCount: row.account_count,
      accounts: row.accounts
    }));

    return res.status(200).json({
      success: true,
      timeRange,
      startDate: startDate ? startDate.toISOString().split('T')[0] : null,
      dataPoints: history.length,
      history
    });

  } catch (error) {
    console.error('Error fetching investment history:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch investment history',
      details: error.message 
    });
  }
}
