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
        ia.is_liquid,
        ia.investment_category,
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
      ORDER BY ia.investment_category, ia.account_type, ia.account_name
    `;

    const accountsResult = await client.query(accountsQuery);

    // Get bank account balances from vendor_credentials
    const bankAccountsQuery = `
      SELECT
        vendor,
        nickname,
        current_balance,
        balance_updated_at
      FROM vendor_credentials
      WHERE current_balance > 0
      ORDER BY vendor, nickname
    `;

    const bankAccountsResult = await client.query(bankAccountsQuery);

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

    // Separate totals by investment category
    let liquidTotal = { value: 0, cost: 0, accounts: 0 };
    let restrictedTotal = { value: 0, cost: 0, accounts: 0 };

    const accountsByType = {};
    const accountsByCategory = { liquid: [], restricted: [] };

    // Process investment accounts
    accountsResult.rows.forEach(account => {
      const value = account.current_value ? parseFloat(account.current_value) : 0;
      const cost = account.cost_basis ? parseFloat(account.cost_basis) : 0;
      const category = account.investment_category;

      if (value > 0) {
        totalPortfolioValue += value;
        accountsWithValues++;

        // Add to category totals
        if (category === 'liquid') {
          liquidTotal.value += value;
          liquidTotal.accounts++;
        } else if (category === 'restricted') {
          restrictedTotal.value += value;
          restrictedTotal.accounts++;
        }
      }

      if (cost > 0) {
        totalCostBasis += cost;

        // Add to category costs
        if (category === 'liquid') {
          liquidTotal.cost += cost;
        } else if (category === 'restricted') {
          restrictedTotal.cost += cost;
        }
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

      const processedAccount = {
        ...account,
        current_value: value,
        cost_basis: cost,
        units: account.units ? parseFloat(account.units) : null,
      };

      accountsByType[account.account_type].accounts.push(processedAccount);
      accountsByType[account.account_type].totalValue += value;
      accountsByType[account.account_type].totalCost += cost;
      accountsByType[account.account_type].count++;

      // Group by investment category
      if (category === 'liquid' || category === 'restricted') {
        accountsByCategory[category].push(processedAccount);
      }
    });

    // Process bank accounts and add them to liquid savings
    bankAccountsResult.rows.forEach(bankAccount => {
      const balance = parseFloat(bankAccount.current_balance);

      if (balance > 0) {
        // Add to total portfolio value and liquid totals
        totalPortfolioValue += balance;
        liquidTotal.value += balance;
        liquidTotal.accounts++;
        accountsWithValues++;

        // Bank accounts are treated as cost basis = current value (no gain/loss)
        totalCostBasis += balance;
        liquidTotal.cost += balance;

        // Create a savings account type group if it doesn't exist
        if (!accountsByType['savings']) {
          accountsByType['savings'] = {
            type: 'savings',
            accounts: [],
            totalValue: 0,
            totalCost: 0,
            count: 0,
          };
        }

        // Create bank account object in investment account format
        const bankAccountFormatted = {
          id: `bank_${bankAccount.vendor}_${bankAccount.nickname || 'default'}`,
          account_name: bankAccount.nickname || `${bankAccount.vendor} Account`,
          account_type: 'savings',
          institution: bankAccount.vendor,
          account_number: null,
          currency: 'ILS',
          notes: 'Bank Account Balance',
          is_liquid: true,
          investment_category: 'liquid',
          current_value: balance,
          cost_basis: balance,
          as_of_date: bankAccount.balance_updated_at,
          units: null,
          asset_name: 'Cash',
          asset_type: 'cash'
        };

        // Add to savings type group
        accountsByType['savings'].accounts.push(bankAccountFormatted);
        accountsByType['savings'].totalValue += balance;
        accountsByType['savings'].totalCost += balance;
        accountsByType['savings'].count++;

        // Add to liquid category
        accountsByCategory.liquid.push(bankAccountFormatted);

        // Update date tracking
        if (bankAccount.balance_updated_at) {
          if (!oldestDate || bankAccount.balance_updated_at < oldestDate) {
            oldestDate = bankAccount.balance_updated_at;
          }
          if (!newestDate || bankAccount.balance_updated_at > newestDate) {
            newestDate = bankAccount.balance_updated_at;
          }
        }
      }
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

    // Enhanced account types with Israeli financial terminology
    const accountTypeLabels = {
      // Restricted long-term savings (קופות גמל ופנסיה)
      pension: { name: 'Pension Fund', name_he: 'קרן פנסיה', category: 'restricted' },
      provident: { name: 'Provident Fund', name_he: 'קרן השתלמות', category: 'restricted' },
      study_fund: { name: 'Study Fund', name_he: 'קופת גמל לחינוך', category: 'restricted' },

      // Liquid investments (השקעות נזילות)
      brokerage: { name: 'Brokerage Account', name_he: 'חשבון ברוקר', category: 'liquid' },
      crypto: { name: 'Cryptocurrency', name_he: 'מטבעות דיגיטליים', category: 'liquid' },
      savings: { name: 'Bank Savings & Cash', name_he: 'חשבונות בנק ומזומן', category: 'liquid' },
      mutual_fund: { name: 'Mutual Funds', name_he: 'קרנות נאמנות', category: 'liquid' },
      bonds: { name: 'Bonds & Fixed Income', name_he: 'אג"ח והלוואות', category: 'liquid' },
      real_estate: { name: 'Real Estate', name_he: 'נדל"ן והשקעות רע"ן', category: 'liquid' },
      other: { name: 'Other Investments', name_he: 'השקעות אחרות', category: 'liquid' },
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
        // Category-based totals
        liquid: {
          totalValue: liquidTotal.value,
          totalCost: liquidTotal.cost,
          unrealizedGainLoss: liquidTotal.value - liquidTotal.cost,
          roi: liquidTotal.cost > 0 ? ((liquidTotal.value - liquidTotal.cost) / liquidTotal.cost) * 100 : 0,
          accountsCount: liquidTotal.accounts,
        },
        restricted: {
          totalValue: restrictedTotal.value,
          totalCost: restrictedTotal.cost,
          unrealizedGainLoss: restrictedTotal.value - restrictedTotal.cost,
          roi: restrictedTotal.cost > 0 ? ((restrictedTotal.value - restrictedTotal.cost) / restrictedTotal.cost) * 100 : 0,
          accountsCount: restrictedTotal.accounts,
        },
      },
      breakdown,
      timeline,
      // Category-based breakdowns
      liquidAccounts: accountsByCategory.liquid,
      restrictedAccounts: accountsByCategory.restricted,
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
