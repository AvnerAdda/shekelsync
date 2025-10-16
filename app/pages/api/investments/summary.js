import { getDB } from '../db.js';

/**
 * Investment Portfolio Summary API
 * GET /api/investments/summary - Get complete portfolio overview
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    // Get all active accounts with their latest holdings
    const accountsQuery = `
      SELECT 
        ia.id,
        ia.account_name,
        ia.account_type,
        ia.institution,
        ia.account_number,
        ia.currency,
        ia.notes,
        ih.current_value,
        ih.cost_basis,
        ih.as_of_date,
        ih.units,
        ih.asset_name,
        ih.asset_type
      FROM investment_accounts ia
      LEFT JOIN LATERAL (
        SELECT *
        FROM investment_holdings
        WHERE account_id = ia.id
        ORDER BY as_of_date DESC
        LIMIT 1
      ) ih ON true
      WHERE ia.is_active = true
      ORDER BY ia.account_type, ia.account_name
    `;

    const accountsResult = await client.query(accountsQuery);

    // Get individual assets for brokerage accounts
    const assetsQuery = `
      SELECT 
        iasset.*,
        ia.account_name,
        ia.account_type
      FROM investment_assets iasset
      JOIN investment_accounts ia ON iasset.account_id = ia.id
      WHERE iasset.is_active = true AND ia.is_active = true
      ORDER BY ia.account_name, iasset.asset_name
    `;

    const assetsResult = await client.query(assetsQuery);

    // Calculate summary statistics
    let totalPortfolioValue = 0;
    let totalCostBasis = 0;
    let accountsWithValues = 0;
    let oldestDate = null;
    let newestDate = null;

    const accountsByType = {};

    accountsResult.rows.forEach(account => {
      const value = account.current_value ? parseFloat(account.current_value) : 0;
      const cost = account.cost_basis ? parseFloat(account.cost_basis) : 0;

      if (value > 0) {
        totalPortfolioValue += value;
        accountsWithValues++;
      }

      if (cost > 0) {
        totalCostBasis += cost;
      }

      if (account.as_of_date) {
        if (!oldestDate || account.as_of_date < oldestDate) {
          oldestDate = account.as_of_date;
        }
        if (!newestDate || account.as_of_date > newestDate) {
          newestDate = account.as_of_date;
        }
      }

      // Group by account type
      if (!accountsByType[account.account_type]) {
        accountsByType[account.account_type] = {
          type: account.account_type,
          accounts: [],
          totalValue: 0,
          totalCost: 0,
          count: 0,
        };
      }

      accountsByType[account.account_type].accounts.push({
        ...account,
        current_value: value,
        cost_basis: cost,
        units: account.units ? parseFloat(account.units) : null,
      });
      accountsByType[account.account_type].totalValue += value;
      accountsByType[account.account_type].totalCost += cost;
      accountsByType[account.account_type].count++;
    });

    // Group assets by account
    const assetsByAccount = {};
    assetsResult.rows.forEach(asset => {
      if (!assetsByAccount[asset.account_id]) {
        assetsByAccount[asset.account_id] = [];
      }
      assetsByAccount[asset.account_id].push({
        ...asset,
        units: parseFloat(asset.units),
        average_cost: asset.average_cost ? parseFloat(asset.average_cost) : null,
      });
    });

    // Calculate unrealized gains/losses
    const unrealizedGainLoss = totalCostBasis > 0
      ? totalPortfolioValue - totalCostBasis
      : 0;

    const roi = totalCostBasis > 0
      ? ((totalPortfolioValue - totalCostBasis) / totalCostBasis) * 100
      : 0;

    // Get historical data for charts (last 12 months)
    const historyQuery = `
      SELECT 
        ihh.snapshot_date,
        SUM(ihh.total_value) as total_value,
        SUM(ihh.cost_basis) as total_cost
      FROM investment_holdings_history ihh
      JOIN investment_accounts ia ON ihh.account_id = ia.id
      WHERE ia.is_active = true
        AND ihh.snapshot_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY ihh.snapshot_date
      ORDER BY ihh.snapshot_date ASC
    `;

    const historyResult = await client.query(historyQuery);

    const timeline = historyResult.rows.map(row => ({
      date: row.snapshot_date,
      totalValue: parseFloat(row.total_value),
      totalCost: row.total_cost ? parseFloat(row.total_cost) : 0,
      gainLoss: parseFloat(row.total_value) - (row.total_cost ? parseFloat(row.total_cost) : 0),
    }));

    // Format account types for display
    const accountTypeLabels = {
      pension: { name: 'Pension Fund', name_he: 'קרן פנסיה' },
      provident: { name: 'Provident Fund', name_he: 'קרן השתלמות' },
      study_fund: { name: 'Study Fund', name_he: 'קופת גמל' },
      savings: { name: 'Savings', name_he: 'פיקדון' },
      brokerage: { name: 'Brokerage', name_he: 'ברוקר' },
      crypto: { name: 'Crypto', name_he: 'קריפטו' },
      mutual_fund: { name: 'Mutual Funds', name_he: 'קרנות נאמנות' },
      bonds: { name: 'Bonds', name_he: 'אג"ח' },
      real_estate: { name: 'Real Estate', name_he: 'נדל"ן' },
      other: { name: 'Other', name_he: 'אחר' },
    };

    const breakdown = Object.values(accountsByType).map(group => ({
      ...group,
      ...accountTypeLabels[group.type],
      percentage: totalPortfolioValue > 0
        ? (group.totalValue / totalPortfolioValue) * 100
        : 0,
    }));

    return res.status(200).json({
      summary: {
        totalPortfolioValue,
        totalCostBasis,
        unrealizedGainLoss,
        roi,
        totalAccounts: accountsResult.rows.length,
        accountsWithValues,
        oldestUpdateDate: oldestDate,
        newestUpdateDate: newestDate,
      },
      breakdown,
      timeline,
      accounts: accountsResult.rows.map(acc => ({
        ...acc,
        current_value: acc.current_value ? parseFloat(acc.current_value) : null,
        cost_basis: acc.cost_basis ? parseFloat(acc.cost_basis) : null,
        units: acc.units ? parseFloat(acc.units) : null,
        assets: assetsByAccount[acc.id] || [],
      })),
    });

  } catch (error) {
    console.error('Error fetching investment summary:', error);
    return res.status(500).json({
      error: 'Failed to fetch investment summary',
      details: error.message
    });
  } finally {
    client.release();
  }
}
