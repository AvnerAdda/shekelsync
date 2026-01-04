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
  const firstDate = startDate ? new Date(startDate) : new Date(sorted[0].date);
  const lastDate = endDate ? new Date(endDate) : new Date();
  firstDate.setHours(0, 0, 0, 0);
  lastDate.setHours(0, 0, 0, 0);
  
  // Build a map of existing dates
  const dateMap = new Map();
  sorted.forEach((point) => {
    const dateKey = new Date(point.date).toISOString().split('T')[0];
    dateMap.set(dateKey, point);
  });
  
  const filled = [];
  let lastKnownPoint = null;

  // Seed the initial value with the latest snapshot on or before the start date
  if (startDate) {
    const firstDateTime = firstDate.getTime();
    for (let i = sorted.length - 1; i >= 0; i--) {
      const pointDate = new Date(sorted[i].date);
      pointDate.setHours(0, 0, 0, 0);
      if (pointDate.getTime() <= firstDateTime) {
        lastKnownPoint = { ...sorted[i], date: pointDate.toISOString().split('T')[0] };
        break;
      }
    }
  }
  
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
  const firstDate = startDate ? new Date(startDate) : new Date(sorted[0].date);
  const lastDate = endDate ? new Date(endDate) : new Date();
  firstDate.setHours(0, 0, 0, 0);
  lastDate.setHours(0, 0, 0, 0);
  
  // Build a map of existing dates
  const dateMap = new Map();
  sorted.forEach((point) => {
    const dateKey = new Date(point.date).toISOString().split('T')[0];
    dateMap.set(dateKey, point);
  });
  
  const filled = [];
  let lastKnownPoint = null;

  // Seed the initial value with the latest snapshot on or before the start date
  if (startDate) {
    const firstDateTime = firstDate.getTime();
    for (let i = sorted.length - 1; i >= 0; i--) {
      const pointDate = new Date(sorted[i].date);
      pointDate.setHours(0, 0, 0, 0);
      if (pointDate.getTime() <= firstDateTime) {
        lastKnownPoint = { ...sorted[i], date: pointDate.toISOString().split('T')[0] };
        break;
      }
    }
  }
  
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
  const startDateStr = startDate ? startDate.toISOString().split('T')[0] : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const paramsList = [];
  const accountConditions = [];
  const idsFilter = accountId
    ? [accountId]
    : accountIds
      ? Array.isArray(accountIds)
        ? accountIds
        : [accountIds]
      : [];

  if (accountId) {
    paramsList.push(accountId);
    accountConditions.push(`ih.account_id = $${paramsList.length}`);
  } else if (idsFilter.length > 0) {
    const startIndex = paramsList.length;
    paramsList.push(...idsFilter);
    const placeholders = idsFilter.map((_, idx) => `$${startIndex + idx + 1}`).join(',');
    accountConditions.push(`ih.account_id IN (${placeholders})`);
  }

  const holdingsSelect = `
    SELECT 
      ih.as_of_date as snapshot_date,
      ih.current_value,
      ih.cost_basis,
      ih.account_id,
      ia.account_name,
      ia.account_type,
      ${INSTITUTION_SELECT_FIELDS}
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
  `;

  const withStartDate = Boolean(startDateStr);
  const dateParamIndex = paramsList.length + 1;

  const buildWhereClause = (comparison) => {
    const clauses = [...accountConditions];
    if (withStartDate && comparison) {
      clauses.push(`ih.as_of_date ${comparison === 'before' ? '<' : '>='} $${dateParamIndex}`);
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  };

  const queryParams = withStartDate ? [...paramsList, startDateStr] : [...paramsList];

  const historyQuery = `
    ${holdingsSelect}
    ${buildWhereClause('after')}
    ORDER BY ih.as_of_date ASC, ih.account_id
  `;

  const historyResult = await database.query(historyQuery, queryParams);

  let baselineRows = [];
  if (withStartDate) {
    const baselineQuery = `
      WITH ordered AS (
        ${holdingsSelect}
        ${buildWhereClause('before')}
      )
      SELECT *
      FROM (
        SELECT 
          *,
          ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY snapshot_date DESC) AS rn
        FROM ordered
      ) ranked
      WHERE rn = 1
    `;
    const baselineResult = await database.query(baselineQuery, queryParams);
    baselineRows = baselineResult.rows;
  }

  // Combine baseline rows (latest before start) with in-range snapshots
  const uniqueRows = new Map();
  [...baselineRows, ...historyResult.rows].forEach((row) => {
    const key = `${row.account_id}-${row.snapshot_date}`;
    if (!uniqueRows.has(key)) {
      uniqueRows.set(key, row);
    }
  });

  if (uniqueRows.size === 0) {
    return {
      success: true,
      timeRange,
      startDate: startDateStr,
      dataPoints: 0,
      history: [],
    };
  }

  // Build per-account histories
  const accountHistories = new Map();
  for (const row of uniqueRows.values()) {
    const currentValue = row.current_value !== null && row.current_value !== undefined
      ? parseFloat(row.current_value)
      : 0;
    const costBasis = row.cost_basis !== null && row.cost_basis !== undefined
      ? parseFloat(row.cost_basis)
      : 0;
    const gainLoss = currentValue - costBasis;

    const accountIdNumber = Number(row.account_id);
    let institution = buildInstitutionFromRow(row);
    if (!institution && row.account_type) {
      institution = await getInstitutionByVendorCode(database, row.account_type);
    }

    if (!accountHistories.has(accountIdNumber)) {
      accountHistories.set(accountIdNumber, []);
    }

    accountHistories.get(accountIdNumber).push({
      date: row.snapshot_date,
      currentValue,
      costBasis,
      gainLoss,
      roi: costBasis > 0 ? (gainLoss / costBasis) * 100 : 0,
      accountId: accountIdNumber,
      accountName: row.account_name,
      accountType: row.account_type,
      institution: institution || null,
    });
  }

  // Forward-fill each account individually
  const filledPerAccount = new Map();
  for (const [id, points] of accountHistories.entries()) {
    const filled = forwardFillHistory(points, startDate, today);
    filledPerAccount.set(id, filled);
  }

  // If a single account is requested, return its filled history
  if (accountId) {
    const accountHistory = filledPerAccount.get(Number(accountId)) || [];
    return {
      success: true,
      timeRange,
      startDate: startDateStr,
      dataPoints: accountHistory.length,
      history: accountHistory,
    };
  }

  // Aggregate across the requested accounts (or all accounts)
  const aggregatedMap = new Map();
  filledPerAccount.forEach((points) => {
    points.forEach((point) => {
      const dateKey = point.date;
      if (!aggregatedMap.has(dateKey)) {
        aggregatedMap.set(dateKey, {
          date: dateKey,
          currentValue: 0,
          costBasis: 0,
          accounts: [],
        });
      }

      const entry = aggregatedMap.get(dateKey);
      entry.currentValue += point.currentValue;
      entry.costBasis += point.costBasis;
      entry.accounts.push({
        account_id: point.accountId,
        account_name: point.accountName,
        account_type: point.accountType,
        current_value: point.currentValue,
        cost_basis: point.costBasis,
        institution: point.institution,
      });
    });
  });

  const aggregatedHistory = Array.from(aggregatedMap.values())
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((entry) => {
      const gainLoss = entry.currentValue - entry.costBasis;
      return {
        date: entry.date,
        currentValue: entry.currentValue,
        costBasis: entry.costBasis,
        gainLoss,
        roi: entry.costBasis > 0 ? (gainLoss / entry.costBasis) * 100 : 0,
        accountId: null,
        accountName: null,
        accountType: null,
        accountCount: entry.accounts.length,
        accounts: entry.accounts,
        institution: null,
      };
    });

  const filledHistory = forwardFillAggregatedHistory(aggregatedHistory, startDate, today);

  return {
    success: true,
    timeRange,
    startDate: startDateStr,
    dataPoints: filledHistory.length,
    history: filledHistory,
  };
}

module.exports = {
  getInvestmentHistory,
};
module.exports.default = module.exports;
