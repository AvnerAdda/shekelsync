const database = require('../database.js');

function calculateStartDate(timeRange) {
  const date = new Date();
  switch (timeRange) {
    case '1m':
      date.setMonth(date.getMonth() - 1);
      break;
    case '3m':
    default:
      date.setMonth(date.getMonth() - 3);
      break;
    case '6m':
      date.setMonth(date.getMonth() - 6);
      break;
    case '1y':
      date.setFullYear(date.getFullYear() - 1);
      break;
    case 'all':
      return null;
  }
  return date;
}

async function getInvestmentHistory(params = {}) {
  const { accountId, timeRange = '3m', accountIds } = params;
  const startDate = calculateStartDate(timeRange);

  let query;
  let queryParams = [];

  if (accountId) {
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
    queryParams = startDate
      ? [accountId, startDate.toISOString().split('T')[0]]
      : [accountId];
  } else if (accountIds) {
    const ids = Array.isArray(accountIds) ? accountIds : [accountIds];
    const baseParams = [...ids];
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
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
    queryParams = startDate
      ? [...baseParams, startDate.toISOString().split('T')[0]]
      : baseParams;
  } else {
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
      ${startDate ? 'WHERE ihh.snapshot_date >= $1' : ''}
      ORDER BY ihh.snapshot_date ASC, ihh.account_id
    `;
    queryParams = startDate ? [startDate.toISOString().split('T')[0]] : [];
  }

  const result = await database.query(query, queryParams);

  let history;

  if (accountId || accountIds) {
    history = result.rows.map((row) => {
      const currentValue = parseFloat(row.current_value || 0);
      const costBasis = parseFloat(row.cost_basis || 0);
      const gainLoss = currentValue - costBasis;
      return {
        date: row.snapshot_date,
        currentValue,
        costBasis,
        gainLoss,
        roi: costBasis > 0 ? (gainLoss / costBasis) * 100 : 0,
        accountId: row.account_id,
        accountName: row.account_name,
        accountType: row.account_type,
        accountCount: row.account_count ? parseInt(row.account_count, 10) : undefined,
        accounts: row.accounts || [],
      };
    });
  } else {
    const grouped = new Map();

    result.rows.forEach((row) => {
      const dateKey = row.snapshot_date;
      const currentValue = parseFloat(row.current_value || 0);
      const costBasis = parseFloat(row.cost_basis || 0);

      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, {
          currentValue: 0,
          costBasis: 0,
          accounts: [],
        });
      }

      const entry = grouped.get(dateKey);
      entry.currentValue += currentValue;
      entry.costBasis += costBasis;
      entry.accounts.push({
        account_id: row.account_id,
        account_name: row.account_name,
        current_value: currentValue,
        cost_basis: costBasis,
      });
    });

    history = Array.from(grouped.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([date, entry]) => {
        const gainLoss = entry.currentValue - entry.costBasis;
        return {
          date,
          currentValue: entry.currentValue,
          costBasis: entry.costBasis,
          gainLoss,
          roi: entry.costBasis > 0 ? (gainLoss / entry.costBasis) * 100 : 0,
          accountId: null,
          accountName: null,
          accountType: null,
          accountCount: entry.accounts.length,
          accounts: entry.accounts,
        };
      });
  }

  return {
    success: true,
    timeRange,
    startDate: startDate ? startDate.toISOString().split('T')[0] : null,
    dataPoints: history.length,
    history,
  };
}

module.exports = {
  getInvestmentHistory,
};
module.exports.default = module.exports;
