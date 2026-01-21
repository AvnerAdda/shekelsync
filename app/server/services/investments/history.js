const database = require('../database.js');
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  getInstitutionByVendorCode,
} = require('../institutions.js');

// Helper to normalize date to UTC YYYY-MM-DD string
const toDateStr = (date) => {
  if (!date) return null;
  if (typeof date === 'string') return date.split('T')[0];
  return date.toISOString().split('T')[0];
};

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
  
  // Determine date range in UTC
  // We use strings YYYY-MM-DD as the canonical source
  const firstDateStr = toDateStr(startDate) || sorted[0].date;
  const lastDateStr = toDateStr(endDate) || toDateStr(new Date());

  const filled = [];
  
  // Find initial state (latest point <= firstDateStr)
  let lastKnownPoint = null;
  // Check if we have data before or on start date
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].date <= firstDateStr) {
      lastKnownPoint = { ...sorted[i] };
      break;
    }
  }

  const currentDate = new Date(firstDateStr + 'T00:00:00Z');
  const lastDate = new Date(lastDateStr + 'T00:00:00Z');
  
  const dateMap = new Map();
  sorted.forEach((point) => {
    dateMap.set(point.date, point);
  });
  
  while (currentDate <= lastDate) {
    const dateKey = currentDate.toISOString().split('T')[0];
    
    if (dateMap.has(dateKey)) {
      lastKnownPoint = dateMap.get(dateKey);
      filled.push(lastKnownPoint);
    } else if (lastKnownPoint) {
      filled.push({
        ...lastKnownPoint,
        date: dateKey,
      });
    }
    
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
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
  
  const firstDateStr = toDateStr(startDate) || sorted[0].date;
  const lastDateStr = toDateStr(endDate) || toDateStr(new Date());

  const filled = [];
  
  let lastKnownPoint = null;
  // Initialize from sorted history if available
  for (let i = sorted.length - 1; i >= 0; i--) {
     if (sorted[i].date <= firstDateStr) {
       lastKnownPoint = { ...sorted[i] };
       break;
     }
  }
  
  const currentDate = new Date(firstDateStr + 'T00:00:00Z');
  const lastDate = new Date(lastDateStr + 'T00:00:00Z');

  const dateMap = new Map();
  sorted.forEach((point) => {
    dateMap.set(point.date, point);
  });
  
  while (currentDate <= lastDate) {
    const dateKey = currentDate.toISOString().split('T')[0];
    
    if (dateMap.has(dateKey)) {
      lastKnownPoint = dateMap.get(dateKey);
      filled.push(lastKnownPoint);
    } else if (lastKnownPoint) {
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
    
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }
  
  return filled;
}

function calculateStartDate(timeRange) {
  const date = new Date();

  const subMonths = (d, n) => {
    d.setMonth(d.getMonth() - n);
  };

  switch (timeRange) {
    case '1d':
      date.setDate(date.getDate() - 1);
      break;
    case '1w':
      date.setDate(date.getDate() - 7);
      break;
    case '1m':
      subMonths(date, 1);
      break;
    case '2m':
      subMonths(date, 2);
      break;
    case '3m':
      subMonths(date, 3);
      break;
    case '6m':
      subMonths(date, 6);
      break;
    case '1y':
      date.setFullYear(date.getFullYear() - 1);
      break;
    case 'ytd':
      date.setMonth(0);
      date.setDate(1);
      break;
    case 'all':
      return null;
    default:
      subMonths(date, 3);
      break;
  }
  return date;
}

function normalizeAccountIds(accountId, accountIds) {
  if (accountId) return [accountId];
  if (!accountIds) return [];
  return Array.isArray(accountIds) ? accountIds : [accountIds];
}

function buildAccountConditions(accountId, idsFilter, paramsList, accountConditions) {
  if (accountId) {
    paramsList.push(accountId);
    accountConditions.push(`ih.account_id = $${paramsList.length}`);
  } else if (idsFilter.length > 0) {
    const startIndex = paramsList.length;
    paramsList.push(...idsFilter);
    const placeholders = idsFilter.map((_, idx) => `$${startIndex + idx + 1}`).join(',');
    accountConditions.push(`ih.account_id IN (${placeholders})`);
  }
}

async function buildHistoryPoint(row) {
  const currentValue = row.current_value == null ? 0 : Number.parseFloat(row.current_value);
  const costBasis = row.cost_basis == null ? 0 : Number.parseFloat(row.cost_basis);
  const gainLoss = currentValue - costBasis;
  const accountIdNumber = Number(row.account_id);

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
    accountId: accountIdNumber,
    accountName: row.account_name,
    accountType: row.account_type,
    institution: institution || null,
  };
}

function aggregateAccountHistories(filledPerAccount) {
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

  return aggregatedMap;
}

function formatAggregatedHistory(aggregatedMap) {
  return Array.from(aggregatedMap.values())
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
}

async function getInvestmentHistory(params = {}) {
  const { accountId, timeRange = '3m', accountIds } = params;
  const startDate = calculateStartDate(timeRange);
  const startDateStr = startDate ? startDate.toISOString().split('T')[0] : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const paramsList = [];
  const accountConditions = [];
  const idsFilter = normalizeAccountIds(accountId, accountIds);

  buildAccountConditions(accountId, idsFilter, paramsList, accountConditions);

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
    const point = await buildHistoryPoint(row);
    if (!accountHistories.has(point.accountId)) {
      accountHistories.set(point.accountId, []);
    }
    accountHistories.get(point.accountId).push(point);
  }

  // Forward-fill each account individually
  const filledPerAccount = new Map();
  for (const [id, points] of accountHistories.entries()) {
    filledPerAccount.set(id, forwardFillHistory(points, startDate, today));
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

  // Aggregate and format
  const aggregatedMap = aggregateAccountHistories(filledPerAccount);
  const aggregatedHistory = formatAggregatedHistory(aggregatedMap);
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
