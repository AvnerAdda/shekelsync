const database = require('../database.js');

const DEFAULT_LOOKBACK_MONTHS = 3;
const DEFAULT_OVERLAP_DAYS = 0;
const ACCOUNT_DATE_STRATEGIES = {
  LEAST_ADVANCED: 'least_advanced',
  MOST_RECENT: 'most_recent',
};

let dateFnsPromise;

function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseOptionalNonNegativeInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function resolveOverlapDays(params) {
  const override = parseOptionalNonNegativeInteger(params.overlapDays);
  if (override !== null) {
    return override;
  }
  return DEFAULT_OVERLAP_DAYS;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeAccountNumber(value) {
  if (!hasNonEmptyString(value)) {
    return null;
  }
  return String(value).trim();
}

function parseValidDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function resolveAccountDateStrategy(params = {}) {
  const raw = String(params.accountDateStrategy || '').trim().toLowerCase();
  if (raw === ACCOUNT_DATE_STRATEGIES.MOST_RECENT) {
    return ACCOUNT_DATE_STRATEGIES.MOST_RECENT;
  }
  return ACCOUNT_DATE_STRATEGIES.LEAST_ADVANCED;
}

function resolveLeastAdvancedAccountDate(rows = []) {
  const normalized = rows
    .map((row) => ({
      accountNumber: normalizeAccountNumber(row.account_number),
      lastTxnDate: parseValidDate(row.account_last_transaction_date),
    }))
    .filter((row) => row.lastTxnDate);

  if (normalized.length === 0) {
    return { lastTransactionDate: null, accountCount: 0 };
  }

  const hasNamedAccounts = normalized.some((row) => row.accountNumber);
  const candidates = hasNamedAccounts
    ? normalized.filter((row) => row.accountNumber)
    : normalized;

  if (candidates.length === 0) {
    return { lastTransactionDate: null, accountCount: 0 };
  }

  const leastAdvanced = candidates.reduce((earliest, current) =>
    current.lastTxnDate.getTime() < earliest.lastTxnDate.getTime() ? current : earliest
  , candidates[0]);

  return {
    lastTransactionDate: leastAdvanced.lastTxnDate.toISOString(),
    accountCount: candidates.length,
  };
}

async function getLastTransactionDate(params = {}) {
  const { startOfMonth, subMonths } = await loadDateFns();
  const vendor = params.vendor || params.vendorId;
  const credentialNickname = params.credentialNickname || params.nickname;

  if (!vendor) {
    throw serviceError(400, 'Vendor parameter is required');
  }

  const accountDateStrategy = resolveAccountDateStrategy(params);
  let lastTransactionDate = null;
  let accountCount = null;

  if (credentialNickname && accountDateStrategy === ACCOUNT_DATE_STRATEGIES.LEAST_ADVANCED) {
    const perAccountResult = await database.query(
      `
        SELECT
          account_number,
          MAX(COALESCE(transaction_datetime, date)) AS account_last_transaction_date
        FROM transactions
        WHERE vendor = $1 AND vendor_nickname = $2
        GROUP BY account_number
      `,
      [vendor, credentialNickname],
    );
    const resolved = resolveLeastAdvancedAccountDate(perAccountResult.rows || []);
    lastTransactionDate = resolved.lastTransactionDate;
    accountCount = resolved.accountCount;
  } else {
    // Fallback/backward compatibility path (single latest transaction).
    const query = credentialNickname
      ? `
          SELECT MAX(COALESCE(transaction_datetime, date)) AS last_transaction_date
          FROM transactions
          WHERE vendor = $1 AND vendor_nickname = $2
        `
      : `
          SELECT MAX(COALESCE(transaction_datetime, date)) AS last_transaction_date
          FROM transactions
          WHERE vendor = $1
        `;
    const queryParams = credentialNickname ? [vendor, credentialNickname] : [vendor];
    const result = await database.query(query, queryParams);
    lastTransactionDate = result.rows[0]?.last_transaction_date || null;
  }

  const overlapDays = resolveOverlapDays(params);

  if (!lastTransactionDate) {
    // No transactions found: start from a fixed historical window.
    const fallbackStart = startOfMonth(subMonths(new Date(), DEFAULT_LOOKBACK_MONTHS));
    const credentialInfo = credentialNickname ? ` for ${credentialNickname}` : '';
    return {
      lastTransactionDate: fallbackStart.toISOString(),
      hasTransactions: false,
      overlapDaysApplied: 0,
      accountDateStrategy,
      accountCount: accountCount || 0,
      message: `No previous transactions found${credentialInfo}, starting from ${DEFAULT_LOOKBACK_MONTHS} months ago (${fallbackStart.toLocaleDateString()})`,
    };
  }

  // Use a backward overlap window to recover rows missed in partial scrapes.
  const baseDate = new Date(lastTransactionDate);
  const anchorDate = new Date(baseDate);
  anchorDate.setDate(anchorDate.getDate() + 1);
  anchorDate.setHours(0, 0, 0, 0);

  const effectiveStartDate = new Date(anchorDate);
  if (overlapDays > 0) {
    effectiveStartDate.setDate(effectiveStartDate.getDate() - overlapDays);
  }

  const credentialInfo = credentialNickname ? ` for ${credentialNickname}` : '';
  const strategyInfo =
    credentialNickname &&
    accountDateStrategy === ACCOUNT_DATE_STRATEGIES.LEAST_ADVANCED &&
    Number.isFinite(accountCount) &&
    accountCount > 1
      ? ` (least-advanced of ${accountCount} accounts)`
      : '';
  const overlapInfo = overlapDays > 0 ? ` with ${overlapDays}-day overlap` : '';
  return {
    lastTransactionDate: effectiveStartDate.toISOString(),
    hasTransactions: true,
    anchorDate: anchorDate.toISOString(),
    overlapDaysApplied: overlapDays,
    accountDateStrategy,
    accountCount: accountCount || (credentialNickname ? 1 : 0),
    message: `Starting from day after last transaction${credentialInfo}${strategyInfo}${overlapInfo}: ${baseDate.toLocaleDateString()}`,
  };
}

module.exports = {
  getLastTransactionDate,
};

module.exports.default = module.exports;
