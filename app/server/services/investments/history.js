const actualDatabase = require('../database.js');
let database = actualDatabase;
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  loadInstitutionsCache,
} = require('../institutions.js');
const {
  DEFAULT_INVESTMENT_TIME_ZONE,
  appendContributionHistory,
  fetchLinkedInvestmentTransactions,
  toIsoDateInTimeZone,
} = require('./linked-transaction-rollforward.js');
const {
  toNumber,
} = require('./account-holdings-rollup.js');

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

function buildAccountConditions(accountId, idsFilter, paramsList, accountConditions, tableAlias = 'ih') {
  if (accountId) {
    paramsList.push(accountId);
    accountConditions.push(`${tableAlias}.account_id = $${paramsList.length}`);
  } else if (idsFilter.length > 0) {
    const startIndex = paramsList.length;
    paramsList.push(...idsFilter);
    const placeholders = idsFilter.map((_, idx) => `$${startIndex + idx + 1}`).join(',');
    accountConditions.push(`${tableAlias}.account_id IN (${placeholders})`);
  }
}

function appendDateFilter(paramsList, conditions, field, operator, value) {
  paramsList.push(value);
  conditions.push(`${field} ${operator} $${paramsList.length}`);
}

async function fetchHistoryRows({
  accountId,
  idsFilter,
  startDateStr,
  todayDateStr,
}) {
  const sharedSelect = `
    SELECT
      ih.id,
      ih.as_of_date AS snapshot_date,
      ih.current_value,
      ih.cost_basis,
      ih.account_id,
      ih.holding_type,
      ih.status,
      ia.account_name,
      ia.account_type,
      rt.date AS return_date,
      ${INSTITUTION_SELECT_FIELDS}
    FROM investment_holdings ih
    JOIN investment_accounts ia ON ih.account_id = ia.id
    LEFT JOIN transactions rt
      ON ih.return_transaction_id = rt.identifier
     AND ih.return_transaction_vendor = rt.vendor
    LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
  `;

  const standardParams = [];
  const standardConditions = [
    "COALESCE(ih.holding_type, 'standard') <> 'pikadon'",
  ];
  buildAccountConditions(accountId, idsFilter, standardParams, standardConditions);
  appendDateFilter(standardParams, standardConditions, 'ih.as_of_date', '<=', todayDateStr);
  if (startDateStr) {
    appendDateFilter(standardParams, standardConditions, 'ih.as_of_date', '>=', startDateStr);
  }

  const standardInRangeResult = await database.query(
    `
      ${sharedSelect}
      WHERE ${standardConditions.join(' AND ')}
      ORDER BY ih.account_id ASC, ih.as_of_date ASC, ih.id ASC
    `,
    standardParams,
  );

  let standardBaselineRows = [];
  if (startDateStr) {
    const baselineParams = [];
    const baselineConditions = [
      "COALESCE(ih.holding_type, 'standard') <> 'pikadon'",
    ];
    buildAccountConditions(accountId, idsFilter, baselineParams, baselineConditions);
    appendDateFilter(baselineParams, baselineConditions, 'ih.as_of_date', '<', startDateStr);

    const baselineResult = await database.query(
      `
        WITH ranked_baseline AS (
          SELECT
            ih.id,
            ih.as_of_date AS snapshot_date,
            ih.current_value,
            ih.cost_basis,
            ih.account_id,
            ih.holding_type,
            ih.status,
            ia.account_name,
            ia.account_type,
            rt.date AS return_date,
            ${INSTITUTION_SELECT_FIELDS},
            ROW_NUMBER() OVER (
              PARTITION BY ih.account_id
              ORDER BY ih.as_of_date DESC, ih.id DESC
            ) AS rn
          FROM investment_holdings ih
          JOIN investment_accounts ia ON ih.account_id = ia.id
          LEFT JOIN transactions rt
            ON ih.return_transaction_id = rt.identifier
           AND ih.return_transaction_vendor = rt.vendor
          LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
          WHERE ${baselineConditions.join(' AND ')}
        )
        SELECT
          id,
          snapshot_date,
          current_value,
          cost_basis,
          account_id,
          holding_type,
          status,
          account_name,
          account_type,
          return_date,
          institution_id,
          institution_vendor_code,
          institution_display_name_he,
          institution_display_name_en,
          institution_type,
          institution_category,
          institution_subcategory,
          institution_logo_url,
          institution_is_scrapable,
          institution_scraper_company_id,
          institution_parent_id,
          institution_hierarchy_path,
          institution_depth_level
        FROM ranked_baseline
        WHERE rn = 1
        ORDER BY account_id ASC
      `,
      baselineParams,
    );

    standardBaselineRows = Array.isArray(baselineResult?.rows) ? baselineResult.rows : [];
  }

  const pikadonParams = [];
  const pikadonConditions = [
    "ih.holding_type = 'pikadon'",
  ];
  buildAccountConditions(accountId, idsFilter, pikadonParams, pikadonConditions);
  appendDateFilter(pikadonParams, pikadonConditions, 'ih.as_of_date', '<=', todayDateStr);
  if (startDateStr) {
    pikadonParams.push(startDateStr, todayDateStr);
    const startParam = `$${pikadonParams.length - 1}`;
    const todayParam = `$${pikadonParams.length}`;
    pikadonConditions.push(`
      (
        ih.as_of_date >= ${startParam}
        OR COALESCE(
          rt.date,
          CASE WHEN COALESCE(ih.status, 'active') = 'active' THEN ${todayParam} ELSE NULL END
        ) >= ${startParam}
      )
    `);
  }

  const pikadonResult = await database.query(
    `
      ${sharedSelect}
      WHERE ${pikadonConditions.join(' AND ')}
      ORDER BY ih.account_id ASC, ih.as_of_date ASC, ih.id ASC
    `,
    pikadonParams,
  );

  return [
    ...(standardBaselineRows || []),
    ...((standardInRangeResult?.rows) || []),
    ...((pikadonResult?.rows) || []),
  ];
}

function buildHistoryPoint(point, accountMeta) {
  const currentValue = point.currentValue == null ? 0 : Number(point.currentValue);
  const costBasis = point.costBasis == null ? 0 : Number(point.costBasis);
  const gainLoss = currentValue - costBasis;

  return {
    date: point.date,
    currentValue,
    costBasis,
    gainLoss,
    roi: costBasis > 0 ? (gainLoss / costBasis) * 100 : 0,
    accountId: accountMeta.accountId,
    accountName: accountMeta.accountName,
    accountType: accountMeta.accountType,
    institution: accountMeta.institution,
  };
}

function buildAccountHistoryPoints(rows, institutionByVendorCode) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const firstRow = rows[0];
  let institution = buildInstitutionFromRow(firstRow);
  if (!institution && firstRow.account_type) {
    institution = institutionByVendorCode?.get(firstRow.account_type) || null;
  }

  const accountMeta = {
    accountId: Number(firstRow.account_id),
    accountName: firstRow.account_name,
    accountType: firstRow.account_type,
    institution: institution || null,
  };

  const eventsByDate = new Map();
  rows
    .slice()
    .sort((left, right) => {
      if (left.snapshot_date === right.snapshot_date) {
        return Number(left.id || 0) - Number(right.id || 0);
      }
      return String(left.snapshot_date || '').localeCompare(String(right.snapshot_date || ''));
    })
    .forEach((row) => {
      const snapshotDate = row.snapshot_date;
      if (!snapshotDate) {
        return;
      }

      if (!eventsByDate.has(snapshotDate)) {
        eventsByDate.set(snapshotDate, []);
      }

      const currentValue = toNumber(row.current_value) ?? toNumber(row.cost_basis) ?? 0;
      const costBasis = toNumber(row.cost_basis) ?? toNumber(row.current_value) ?? 0;
      const holdingType = String(row.holding_type || 'standard');
      const holdingStatus = String(row.status || 'active');

      if (holdingType === 'pikadon') {
        eventsByDate.get(snapshotDate).push({
          kind: 'delta',
          currentValue,
          costBasis,
        });

        if (holdingStatus !== 'active' && row.return_date) {
          if (!eventsByDate.has(row.return_date)) {
            eventsByDate.set(row.return_date, []);
          }
          eventsByDate.get(row.return_date).push({
            kind: 'delta',
            currentValue: -currentValue,
            costBasis: -costBasis,
          });
        }

        return;
      }

      eventsByDate.get(snapshotDate).push({
        kind: 'absolute',
        currentValue,
        costBasis,
      });
    });

  const points = [];
  let runningValue = 0;
  let runningCost = 0;

  Array.from(eventsByDate.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .forEach(([date, dateEvents]) => {
      const absoluteEvents = dateEvents.filter((event) => event.kind === 'absolute');
      const deltaEvents = dateEvents.filter((event) => event.kind === 'delta');
      if (absoluteEvents.length > 0) {
        const latestAbsolute = absoluteEvents[absoluteEvents.length - 1];
        runningValue = latestAbsolute.currentValue;
        runningCost = latestAbsolute.costBasis;
      }

      deltaEvents.forEach((event) => {
        runningValue += event.currentValue;
        runningCost += event.costBasis;
      });

      points.push(buildHistoryPoint({
        date,
        currentValue: runningValue,
        costBasis: runningCost,
      }, accountMeta));
    });

  return points;
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
  const { accountId, timeRange = '3m', accountIds, includeAccounts } = params;
  const includeAccountsFlag =
    includeAccounts === true ||
    includeAccounts === 'true' ||
    includeAccounts === '1';
  const startDate = calculateStartDate(timeRange);
  const startDateStr = startDate ? startDate.toISOString().split('T')[0] : null;

  const todayDateStr = toIsoDateInTimeZone(new Date(), DEFAULT_INVESTMENT_TIME_ZONE)
    || new Date().toISOString().split('T')[0];
  const today = new Date(`${todayDateStr}T00:00:00.000Z`);

  const idsFilter = normalizeAccountIds(accountId, accountIds);
  const historyRows = await fetchHistoryRows({
    accountId,
    idsFilter,
    startDateStr,
    todayDateStr,
  });

  if (historyRows.length === 0) {
    return {
      success: true,
      timeRange,
      startDate: startDateStr,
      dataPoints: 0,
      history: [],
    };
  }

  // Build per-account histories
  const institutions = await loadInstitutionsCache(database);
  const institutionByVendorCode = new Map(
    (institutions || []).map((institution) => [institution.vendor_code, institution]),
  );

  const accountHistories = new Map();
  const rowsByAccount = new Map();
  historyRows.forEach((row) => {
    const accountKey = Number(row.account_id);
    if (!Number.isFinite(accountKey)) {
      return;
    }

    if (!rowsByAccount.has(accountKey)) {
      rowsByAccount.set(accountKey, []);
    }
    rowsByAccount.get(accountKey).push(row);
  });

  rowsByAccount.forEach((rows, accountKey) => {
    accountHistories.set(accountKey, buildAccountHistoryPoints(rows, institutionByVendorCode));
  });

  const linkedTransactions = await fetchLinkedInvestmentTransactions(
    database,
    Array.from(accountHistories.keys()),
    {
      endDate: todayDateStr,
    },
  );
  const linkedTransactionsByAccount = new Map();
  linkedTransactions.forEach((transaction) => {
    const accountKey = Number(transaction.account_id);
    if (!Number.isFinite(accountKey)) {
      return;
    }

    if (!linkedTransactionsByAccount.has(accountKey)) {
      linkedTransactionsByAccount.set(accountKey, []);
    }
    linkedTransactionsByAccount.get(accountKey).push(transaction);
  });

  // Forward-fill each account individually
  const filledPerAccount = new Map();
  for (const [id, points] of accountHistories.entries()) {
    const augmentedPoints = appendContributionHistory(
      points,
      linkedTransactionsByAccount.get(id) || [],
      {
        excludePikadonTransactions: true,
      },
    );
    filledPerAccount.set(id, forwardFillHistory(augmentedPoints, startDate, today));
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

  const response = {
    success: true,
    timeRange,
    startDate: startDateStr,
    dataPoints: filledHistory.length,
    history: filledHistory,
  };
  if (includeAccountsFlag) {
    response.accounts = Array.from(filledPerAccount.entries())
      .map(([id, history]) => ({
        accountId: Number(id),
        history,
      }))
      .sort((a, b) => a.accountId - b.accountId);
  }
  return response;
}

module.exports = {
  getInvestmentHistory,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};
module.exports.default = module.exports;
