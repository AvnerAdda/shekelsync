const database = require('../database.js');

const DEFAULT_LOOKBACK_MONTHS = 3;
const DEFAULT_OVERLAP_DAYS = 7;
const ACCOUNT_DATE_STRATEGIES = {
  LEAST_ADVANCED: 'least_advanced',
  MOST_RECENT: 'most_recent',
};
const ANCHOR_SOURCES = {
  CREDENTIAL_ACCOUNT_NUMBERS: 'credential_account_numbers',
  NICKNAME_FALLBACK: 'nickname_fallback',
  VENDOR_FALLBACK: 'vendor_fallback',
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

function normalizeCredentialId(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
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

function splitAccountIdentifiers(value) {
  if (!hasNonEmptyString(value)) {
    return [];
  }

  return String(value)
    .split(';')
    .map((part) => normalizeAccountNumber(part))
    .filter(Boolean);
}

function dedupeIdentifiers(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function lookupCredentialContext(vendor, credentialId) {
  if (!credentialId) {
    return null;
  }

  const result = await database.query(
    `
      SELECT bank_account_number, card6_digits, nickname
      FROM vendor_credentials
      WHERE id = $1 AND vendor = $2
      LIMIT 1
    `,
    [credentialId, vendor],
  );

  return result.rows?.[0] || null;
}

async function countVendorCredentials(vendor) {
  const result = await database.query(
    `
      SELECT COUNT(*) AS credential_count
      FROM vendor_credentials
      WHERE vendor = $1
    `,
    [vendor],
  );

  return Number.parseInt(String(result.rows?.[0]?.credential_count || 0), 10) || 0;
}

async function queryLeastAdvancedByAccountNumbers(vendor, accountNumbers = []) {
  if (!Array.isArray(accountNumbers) || accountNumbers.length === 0) {
    return { lastTransactionDate: null, accountCount: 0 };
  }

  const placeholders = accountNumbers.map((_, index) => `$${index + 2}`).join(', ');
  const result = await database.query(
    `
      SELECT
        account_number,
        MAX(COALESCE(transaction_datetime, date)) AS account_last_transaction_date
      FROM transactions
      WHERE vendor = $1
        AND account_number IN (${placeholders})
      GROUP BY account_number
    `,
    [vendor, ...accountNumbers],
  );

  return resolveLeastAdvancedAccountDate(result.rows || []);
}

async function queryMostRecentByAccountNumbers(vendor, accountNumbers = []) {
  if (!Array.isArray(accountNumbers) || accountNumbers.length === 0) {
    return { lastTransactionDate: null };
  }

  const placeholders = accountNumbers.map((_, index) => `$${index + 2}`).join(', ');
  const result = await database.query(
    `
      SELECT MAX(COALESCE(transaction_datetime, date)) AS last_transaction_date
      FROM transactions
      WHERE vendor = $1
        AND account_number IN (${placeholders})
    `,
    [vendor, ...accountNumbers],
  );

  return {
    lastTransactionDate: result.rows?.[0]?.last_transaction_date || null,
  };
}

async function queryLeastAdvancedByNickname(vendor, credentialNickname) {
  const result = await database.query(
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

  return resolveLeastAdvancedAccountDate(result.rows || []);
}

async function queryMostRecentByNickname(vendor, credentialNickname) {
  const result = await database.query(
    `
      SELECT MAX(COALESCE(transaction_datetime, date)) AS last_transaction_date
      FROM transactions
      WHERE vendor = $1 AND vendor_nickname = $2
    `,
    [vendor, credentialNickname],
  );

  return {
    lastTransactionDate: result.rows?.[0]?.last_transaction_date || null,
  };
}

async function queryLeastAdvancedByVendor(vendor) {
  const result = await database.query(
    `
      SELECT
        account_number,
        MAX(COALESCE(transaction_datetime, date)) AS account_last_transaction_date
      FROM transactions
      WHERE vendor = $1
      GROUP BY account_number
    `,
    [vendor],
  );

  return resolveLeastAdvancedAccountDate(result.rows || []);
}

async function queryMostRecentByVendor(vendor) {
  const result = await database.query(
    `
      SELECT MAX(COALESCE(transaction_datetime, date)) AS last_transaction_date
      FROM transactions
      WHERE vendor = $1
    `,
    [vendor],
  );

  return {
    lastTransactionDate: result.rows?.[0]?.last_transaction_date || null,
  };
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
  const requestedNickname = params.credentialNickname || params.nickname;
  const credentialId = normalizeCredentialId(params.credentialId);

  if (!vendor) {
    throw serviceError(400, 'Vendor parameter is required');
  }

  const accountDateStrategy = resolveAccountDateStrategy(params);
  let lastTransactionDate = null;
  let accountCount = null;
  let anchorSource = null;
  let credentialNickname = requestedNickname;

  const credentialContext = await lookupCredentialContext(vendor, credentialId);
  const accountIdentifiers = dedupeIdentifiers([
    ...splitAccountIdentifiers(credentialContext?.bank_account_number),
    ...splitAccountIdentifiers(credentialContext?.card6_digits),
  ]);
  if (!credentialNickname && hasNonEmptyString(credentialContext?.nickname)) {
    credentialNickname = credentialContext.nickname;
  }

  if (accountIdentifiers.length > 0) {
    if (accountDateStrategy === ACCOUNT_DATE_STRATEGIES.LEAST_ADVANCED) {
      const resolved = await queryLeastAdvancedByAccountNumbers(vendor, accountIdentifiers);
      lastTransactionDate = resolved.lastTransactionDate;
      accountCount = resolved.accountCount;
    } else {
      const resolved = await queryMostRecentByAccountNumbers(vendor, accountIdentifiers);
      lastTransactionDate = resolved.lastTransactionDate;
      accountCount = accountIdentifiers.length;
    }
    if (lastTransactionDate) {
      anchorSource = ANCHOR_SOURCES.CREDENTIAL_ACCOUNT_NUMBERS;
    }
  }

  if (!lastTransactionDate && credentialNickname) {
    if (accountDateStrategy === ACCOUNT_DATE_STRATEGIES.LEAST_ADVANCED) {
      const resolved = await queryLeastAdvancedByNickname(vendor, credentialNickname);
      lastTransactionDate = resolved.lastTransactionDate;
      accountCount = resolved.accountCount;
    } else {
      const resolved = await queryMostRecentByNickname(vendor, credentialNickname);
      lastTransactionDate = resolved.lastTransactionDate;
      accountCount = 1;
    }
    if (lastTransactionDate) {
      anchorSource = ANCHOR_SOURCES.NICKNAME_FALLBACK;
    }
  }

  if (!lastTransactionDate && (await countVendorCredentials(vendor)) === 1) {
    if (accountDateStrategy === ACCOUNT_DATE_STRATEGIES.LEAST_ADVANCED) {
      const resolved = await queryLeastAdvancedByVendor(vendor);
      lastTransactionDate = resolved.lastTransactionDate;
      accountCount = resolved.accountCount;
    } else {
      const resolved = await queryMostRecentByVendor(vendor);
      lastTransactionDate = resolved.lastTransactionDate;
      accountCount = 1;
    }
    if (lastTransactionDate) {
      anchorSource = ANCHOR_SOURCES.VENDOR_FALLBACK;
    }
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
      anchorSource: anchorSource || ANCHOR_SOURCES.VENDOR_FALLBACK,
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
    anchorSource: anchorSource || (credentialNickname ? ANCHOR_SOURCES.NICKNAME_FALLBACK : ANCHOR_SOURCES.VENDOR_FALLBACK),
    message: `Starting from day after last transaction${credentialInfo}${strategyInfo}${overlapInfo}: ${baseDate.toLocaleDateString()}`,
  };
}

module.exports = {
  getLastTransactionDate,
};

module.exports.default = module.exports;
