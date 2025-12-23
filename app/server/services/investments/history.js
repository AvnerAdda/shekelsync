const database = require('../database.js');
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  getInstitutionByVendorCode,
} = require('../institutions.js');

/**
 * Forward-fill missing dates in history data
 * Takes sparse history data and fills in gaps using last known values
 * @param {Array} history - Array of history points with date, currentValue, costBasis
 * @param {Date|null} startDate - Start date for the range (null = use first data point)
 * @param {Date|null} endDate - End date for the range (null = today)
 * @returns {Array} History with all dates filled in
 */
function forwardFillHistory(history, startDate = null, endDate = null) {
  if (!history || history.length === 0) {
    return [];
  }

  // Sort by date ascending
  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // Determine date range
  const firstDate = startDate || new Date(sorted[0].date);
  const lastDate = endDate || new Date();
  
  // Build a map of existing dates
  const dateMap = new Map();
  sorted.forEach((point) => {
    const dateKey = new Date(point.date).toISOString().split('T')[0];
    dateMap.set(dateKey, point);
  });
  
  const filled = [];
  let lastKnownPoint = null;
  
  // Iterate through each day in the range
  const currentDate = new Date(firstDate);
  currentDate.setHours(0, 0, 0, 0);
  
  while (currentDate <= lastDate) {
    const dateKey = currentDate.toISOString().split('T')[0];
    
    if (dateMap.has(dateKey)) {
      // We have actual data for this date
      lastKnownPoint = dateMap.get(dateKey);
      filled.push(lastKnownPoint);
    } else if (lastKnownPoint) {
      // No data for this date, forward-fill from last known point
      filled.push({
        ...lastKnownPoint,
        date: dateKey,
        // Keep all other properties from last known point
      });
    }
    // If no lastKnownPoint yet, skip this date (before first data point)
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return filled;
}

/**
 * Forward-fill history for aggregated (overall) portfolio data
 * Handles the case where we have multiple accounts with different dates
 * @param {Array} history - Aggregated history points
 * @param {Date|null} startDate - Start date for the range
 * @param {Date|null} endDate - End date for the range
 * @returns {Array} History with all dates filled in
 */
function forwardFillAggregatedHistory(history, startDate = null, endDate = null) {
  if (!history || history.length === 0) {
    return [];
  }

  // Sort by date ascending
  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // Determine date range
  const firstDate = startDate || new Date(sorted[0].date);
  const lastDate = endDate || new Date();
  
  // Build a map of existing dates
  const dateMap = new Map();
  sorted.forEach((point) => {
    const dateKey = new Date(point.date).toISOString().split('T')[0];
    dateMap.set(dateKey, point);
  });
  
  const filled = [];
  let lastKnownPoint = null;
  
  // Iterate through each day in the range
  const currentDate = new Date(firstDate);
  currentDate.setHours(0, 0, 0, 0);
  
  while (currentDate <= lastDate) {
    const dateKey = currentDate.toISOString().split('T')[0];
    
    if (dateMap.has(dateKey)) {
      // We have actual data for this date
      lastKnownPoint = dateMap.get(dateKey);
      filled.push(lastKnownPoint);
    } else if (lastKnownPoint) {
      // No data for this date, forward-fill from last known point
      const gainLoss = lastKnownPoint.currentValue - lastKnownPoint.costBasis;
      filled.push({
        date: dateKey,
        currentValue: lastKnownPoint.currentValue,
        costBasis: lastKnownPoint.costBasis,
        gainLoss,
        roi: lastKnownPoint.costBasis > 0 ? (gainLoss / lastKnownPoint.costBasis) * 100 : 0,
        accountId: lastKnownPoint.accountId,
        accountName: lastKnownPoint.accountName,
        accountType: lastKnownPoint.accountType,
        accountCount: lastKnownPoint.accountCount,
        accounts: lastKnownPoint.accounts,
        institution: lastKnownPoint.institution,
      });
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return filled;
}

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
        ih.as_of_date as snapshot_date,
        SUM(ih.current_value) as current_value,
        SUM(ih.cost_basis) as cost_basis,
        ih.account_id,
        ia.account_name,
        ia.account_type,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_holdings ih
      JOIN investment_accounts ia ON ih.account_id = ia.id
      LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
      WHERE ih.account_id = $1
      ${startDate ? 'AND ih.as_of_date >= $2' : ''}
      GROUP BY ih.as_of_date, ih.account_id, ia.account_name, ia.account_type,
               fi.id, fi.vendor_code, fi.display_name_he, fi.display_name_en,
               fi.institution_type, fi.category, fi.subcategory, fi.logo_url,
               fi.is_scrapable, fi.scraper_company_id
      ORDER BY ih.as_of_date ASC
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
        ih.as_of_date as snapshot_date,
        SUM(ih.current_value) as current_value,
        SUM(ih.cost_basis) as cost_basis,
        ih.account_id,
        ia.account_name,
        ia.account_type,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_holdings ih
      JOIN investment_accounts ia ON ih.account_id = ia.id
      LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
      WHERE ih.account_id IN (${placeholders})
      ${startDate ? `AND ih.as_of_date >= $${ids.length + 1}` : ''}
      GROUP BY ih.as_of_date, ih.account_id, ia.account_name, ia.account_type,
               fi.id, fi.vendor_code, fi.display_name_he, fi.display_name_en,
               fi.institution_type, fi.category, fi.subcategory, fi.logo_url,
               fi.is_scrapable, fi.scraper_company_id
      ORDER BY ih.as_of_date ASC, ih.account_id
    `;
    queryParams = startDate
      ? [...baseParams, startDate.toISOString().split('T')[0]]
      : baseParams;
  } else {
    query = `
      SELECT 
        ih.as_of_date as snapshot_date,
        SUM(ih.current_value) as current_value,
        SUM(ih.cost_basis) as cost_basis,
        ih.account_id,
        ia.account_name,
        ia.account_type,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_holdings ih
      JOIN investment_accounts ia ON ih.account_id = ia.id
      LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
      ${startDate ? 'WHERE ih.as_of_date >= $1' : ''}
      GROUP BY ih.as_of_date, ih.account_id, ia.account_name, ia.account_type,
               fi.id, fi.vendor_code, fi.display_name_he, fi.display_name_en,
               fi.institution_type, fi.category, fi.subcategory, fi.logo_url,
               fi.is_scrapable, fi.scraper_company_id
      ORDER BY ih.as_of_date ASC, ih.account_id
    `;
    queryParams = startDate ? [startDate.toISOString().split('T')[0]] : [];
  }

  const result = await database.query(query, queryParams);

  let history;

  if (accountId || accountIds) {
    history = await Promise.all(result.rows.map(async (row) => {
      const currentValue = parseFloat(row.current_value || 0);
      const costBasis = parseFloat(row.cost_basis || 0);
      const gainLoss = currentValue - costBasis;
      let institution = buildInstitutionFromRow(row);
      if (!institution && row.account_type) {
        institution = await getInstitutionByVendorCode(database, row.account_type);
      }
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
        institution: institution || null,
      };
    }));
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
        account_type: row.account_type,
        current_value: currentValue,
        cost_basis: costBasis,
        institution: buildInstitutionFromRow(row),
      });
    });

    history = await Promise.all(Array.from(grouped.entries())
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(async ([date, entry]) => {
        const gainLoss = entry.currentValue - entry.costBasis;
        const accountsWithInstitutions = await Promise.all(entry.accounts.map(async (acct) => {
          if (acct.institution) return acct;
          const institution = acct.account_type
            ? await getInstitutionByVendorCode(database, acct.account_type)
            : null;
          return { ...acct, institution: institution || null };
        }));
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
          accounts: accountsWithInstitutions,
        };
      }));
  }

  // Apply forward-fill to ensure continuous history data
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const filledHistory = accountId || accountIds
    ? forwardFillHistory(history, startDate, today)
    : forwardFillAggregatedHistory(history, startDate, today);

  return {
    success: true,
    timeRange,
    startDate: startDate ? startDate.toISOString().split('T')[0] : null,
    dataPoints: filledHistory.length,
    history: filledHistory,
  };
}

module.exports = {
  getInvestmentHistory,
};
module.exports.default = module.exports;
