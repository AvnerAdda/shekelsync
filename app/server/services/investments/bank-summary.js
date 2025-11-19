/**
 * Bank Balance Summary Service
 *
 * Provides detailed bank balance analytics including current balances,
 * historical snapshots, month-start comparisons, and per-account breakdowns.
 */

const actualDatabase = require('../database.js');
const { resolveDateRange } = require('../../../lib/server/query-utils.js');
const { dialect } = require('../../../lib/sql-dialect.js');

let database = actualDatabase;

/**
 * Get comprehensive bank balance summary
 * @param {object} query - Query parameters
 * @param {string} query.startDate - Start date (ISO format)
 * @param {string} query.endDate - End date (ISO format)
 * @param {number} query.months - Number of months (default: 3)
 * @param {string} query.aggregation - Aggregation period: daily/weekly/monthly (default: daily)
 * @returns {Promise<object>} Bank balance summary with history and breakdowns
 */
async function getBankBalanceSummary(query = {}) {
  const { startDate, endDate, months = 3, aggregation = 'daily' } = query;
  const { start, end } = resolveDateRange({ startDate, endDate, months });

  // Determine date grouping based on aggregation
  let dateGroupBy;
  let dateSelect;
  switch (aggregation) {
    case 'weekly':
      dateGroupBy = dialect.dateTrunc('week', 'ihh.snapshot_date');
      dateSelect = `${dialect.dateTrunc('week', 'ihh.snapshot_date')} as date`;
      break;
    case 'monthly':
      dateGroupBy = dialect.dateTrunc('month', 'ihh.snapshot_date');
      dateSelect = `${dialect.dateTrunc('month', 'ihh.snapshot_date')} as date`;
      break;
    case 'daily':
    default:
      dateGroupBy = dialect.dateTrunc('day', 'ihh.snapshot_date');
      dateSelect = `${dialect.dateTrunc('day', 'ihh.snapshot_date')} as date`;
  }

  // Query 1: Current bank balances per account
  const currentBalancesResult = await database.query(
    `SELECT
      ia.id as account_id,
      ia.account_name,
      ia.account_number,
      ia.institution_id,
      ia.notes,
      fi.display_name_he as institution_name_he,
      fi.display_name_en as institution_name_en,
      fi.vendor_code,
      fi.logo_url as institution_logo,
      ih.current_value as current_balance,
      ih.cost_basis,
      ih.as_of_date,
      ih.notes as holding_notes
    FROM investment_accounts ia
    JOIN investment_holdings ih ON ia.id = ih.account_id
    LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ih.as_of_date = (
        SELECT MAX(as_of_date)
        FROM investment_holdings
        WHERE account_id = ia.id
      )
    ORDER BY ia.account_name`,
    []
  );

  // Query 2: Month-start balances per account
  const startDateStr = start.toISOString().split('T')[0]; // Convert Date to YYYY-MM-DD
  const monthStartDate = startDateStr.substring(0, 7) + '-01'; // YYYY-MM-01
  const monthStartBalancesResult = await database.query(
    `SELECT
      ia.id as account_id,
      ia.account_name,
      ihh.total_value as month_start_balance,
      ihh.snapshot_date
    FROM investment_holdings_history ihh
    JOIN investment_accounts ia ON ihh.account_id = ia.id
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ihh.snapshot_date = $1
    ORDER BY ia.account_name`,
    [monthStartDate]
  );

  // Query 3: Balance history aggregated by period
  const balanceHistoryResult = await database.query(
    `SELECT
      ${dateSelect},
      ia.id as account_id,
      ia.account_name,
      SUM(ihh.total_value) as total_balance,
      AVG(ihh.total_value) as avg_balance,
      MIN(ihh.total_value) as min_balance,
      MAX(ihh.total_value) as max_balance,
      COUNT(*) as snapshot_count
    FROM investment_holdings_history ihh
    JOIN investment_accounts ia ON ihh.account_id = ia.id
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ihh.snapshot_date >= $1
      AND ihh.snapshot_date <= $2
    GROUP BY ${dateGroupBy}, ia.id, ia.account_name
    ORDER BY date ASC, ia.account_name`,
    [start, end]
  );

  // Query 4: Aggregated total balance history (all accounts combined)
  const totalBalanceHistoryResult = await database.query(
    `SELECT
      ${dateSelect},
      SUM(ihh.total_value) as total_balance
    FROM investment_holdings_history ihh
    JOIN investment_accounts ia ON ihh.account_id = ia.id
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ihh.snapshot_date >= $1
      AND ihh.snapshot_date <= $2
    GROUP BY ${dateGroupBy}
    ORDER BY date ASC`,
    [start, end]
  );

  // Query 5: All month-start snapshots in the date range
  const allMonthStartsResult = await database.query(
    `SELECT
      ihh.snapshot_date,
      SUM(ihh.total_value) as total_balance
    FROM investment_holdings_history ihh
    JOIN investment_accounts ia ON ihh.account_id = ia.id
    WHERE ia.account_type = 'bank_balance'
      AND ia.is_active = 1
      AND ihh.snapshot_date >= $1
      AND ihh.snapshot_date <= $2
      AND strftime('%d', ihh.snapshot_date) = '01'
    GROUP BY ihh.snapshot_date
    ORDER BY ihh.snapshot_date ASC`,
    [start, end]
  );

  // Process results
  const accountsMap = new Map();
  currentBalancesResult.rows.forEach((row) => {
    accountsMap.set(row.account_id, {
      accountId: row.account_id,
      accountName: row.account_name,
      accountNumber: row.account_number,
      currentBalance: Number.parseFloat(row.current_balance || 0),
      asOfDate: row.as_of_date,
      monthStartBalance: 0,
      balanceChange: 0,
      institution: row.institution_id ? {
        id: row.institution_id,
        display_name_he: row.institution_name_he,
        display_name_en: row.institution_name_en,
        vendor_code: row.vendor_code,
        logo_url: row.institution_logo,
      } : null,
    });
  });

  // Add month-start balances
  monthStartBalancesResult.rows.forEach((row) => {
    const account = accountsMap.get(row.account_id);
    if (account) {
      account.monthStartBalance = Number.parseFloat(row.month_start_balance || 0);
      account.balanceChange = account.currentBalance - account.monthStartBalance;
      account.balanceChangePercent = account.monthStartBalance !== 0
        ? ((account.balanceChange / account.monthStartBalance) * 100)
        : 0;
    }
  });

  // Calculate totals
  const currentTotalBalance = Array.from(accountsMap.values()).reduce(
    (sum, account) => sum + account.currentBalance,
    0
  );

  const monthStartTotalBalance = Array.from(accountsMap.values()).reduce(
    (sum, account) => sum + account.monthStartBalance,
    0
  );

  const totalBalanceChange = currentTotalBalance - monthStartTotalBalance;
  const totalBalanceChangePercent = monthStartTotalBalance !== 0
    ? ((totalBalanceChange / monthStartTotalBalance) * 100)
    : 0;

  // Build per-account history
  const accountHistoryMap = new Map();
  balanceHistoryResult.rows.forEach((row) => {
    const accountId = row.account_id;
    if (!accountHistoryMap.has(accountId)) {
      accountHistoryMap.set(accountId, {
        accountId,
        accountName: row.account_name,
        history: [],
      });
    }
    accountHistoryMap.get(accountId).history.push({
      date: row.date,
      totalBalance: Number.parseFloat(row.total_balance || 0),
      avgBalance: Number.parseFloat(row.avg_balance || 0),
      minBalance: Number.parseFloat(row.min_balance || 0),
      maxBalance: Number.parseFloat(row.max_balance || 0),
      snapshotCount: Number.parseInt(row.snapshot_count || 0, 10),
    });
  });

  return {
    dateRange: { start, end, monthStartDate },
    summary: {
      currentTotalBalance,
      monthStartTotalBalance,
      totalBalanceChange,
      totalBalanceChangePercent,
      accountCount: accountsMap.size,
    },
    accounts: Array.from(accountsMap.values()),
    history: {
      total: totalBalanceHistoryResult.rows.map((row) => ({
        date: row.date,
        totalBalance: Number.parseFloat(row.total_balance || 0),
      })),
      perAccount: Array.from(accountHistoryMap.values()),
    },
    monthStarts: allMonthStartsResult.rows.map((row) => ({
      date: row.snapshot_date,
      totalBalance: Number.parseFloat(row.total_balance || 0),
    })),
  };
}

module.exports = {
  getBankBalanceSummary,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};
module.exports.default = module.exports;
