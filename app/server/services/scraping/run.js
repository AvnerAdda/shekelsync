const { CompanyTypes, createScraper } = require('israeli-bank-scrapers-core');
const crypto = require('crypto');
const path = require('path');
const baseDatabase = require('../database.js');
const Mutex = require('../../../lib/mutex.js');
const {
  BANK_VENDORS,
  SPECIAL_BANK_VENDORS,
  OTHER_BANK_VENDORS,
  SCRAPE_RATE_LIMIT_MS,
  SCRAPE_RATE_LIMIT_MAX_ATTEMPTS,
} = require('../../../utils/constants.js');
const {
  resolveCategory,
  findCategoryByName,
  getCategoryInfo,
} = require('../../../lib/category-helpers.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { getInstitutionById, mapInstitutionToVendorCode } = require('../institutions.js');
const { syncBankBalanceToInvestments, forwardFillForCredential } = require('../investments/balance-sync.js');
const { getCreditCardRepaymentCategoryId } = require('../accounts/repayment-category.js');
const lastTransactionDateService = require('../accounts/last-transaction-date.js');
const { dialect } = require('../../../lib/sql-dialect.js');

const DEFAULT_TIMEOUT = 120000; // 2 minutes
const MAX_TIMEOUT = 180000; // 3 minutes for problematic scrapers
const DEFAULT_LOOKBACK_MONTHS = 3;
const SCRAPE_ANCHOR_REPAIR_LOOKBACK_DAYS = 90;
const DEMO_SYNC_MERCHANTS = {
  discount: ['רמי לוי', 'סופר פארם', 'WOLT', 'העברה לכרטיס אשראי'],
  max: ['WOLT', 'פז', 'סופר פארם', 'Amazon Marketplace'],
  visaCal: ['ארומה', 'BUG', 'תן ביס', 'רב קו'],
  default: ['עסקת דמו חדשה'],
};
let cachedBankCategory = null;
let databaseRef = baseDatabase;
let lastTransactionDateServiceRef = lastTransactionDateService;

const PENDING_COMPLETED_MATCH_WINDOW_HOURS = 36; // 1.5 days (handles timezone/date rounding)
const MERCHANT_ALIAS_RULES = [
  {
    canonical: 'mega_bair',
    patterns: [
      /carrefour\s*market/iu,
      /מגה\s+בעיר/u,
    ],
  },
];
const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';
const ISRAEL_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Mutex to serialize scrape operations and prevent SQLite transaction conflicts
// SQLite uses a single connection and doesn't support nested transactions
const scrapeMutex = new Mutex();
const defaultRepairStateProvider = {
  async getCompletedCredentialIds() {
    return [];
  },
  async markCredentialRepairComplete() {
    return false;
  },
};

function createHttpError(statusCode, message, extra = {}) {
  const error = new Error(message || 'Scraping failed');
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pickRandom(list, fallback = null) {
  if (!Array.isArray(list) || list.length === 0) return fallback;
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

function resolvePrimaryAccountNumber(credentials = {}) {
  const raw =
    credentials.bankAccountNumber ||
    credentials.accountNumber ||
    credentials.card6Digits ||
    null;

  if (!hasNonEmptyString(raw)) return null;

  return raw
    .split(';')
    .map((segment) => segment.trim())
    .find(Boolean) || null;
}

function normalizeCredentialId(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCompletedCredentialIds(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(
    values
      .map((value) => normalizeCredentialId(value))
      .filter((value) => value !== null),
  )).sort((left, right) => left - right);
}

function buildRepairBackfillDate() {
  const repairDate = new Date();
  repairDate.setDate(repairDate.getDate() - SCRAPE_ANCHOR_REPAIR_LOOKBACK_DAYS);
  repairDate.setHours(0, 0, 0, 0);
  return repairDate;
}

async function resolveRepairBackfillState(credentials, repairStateProvider, logger = console) {
  const credentialId = normalizeCredentialId(credentials?.dbId);
  if (!credentialId) {
    return {
      credentialId: null,
      eligible: false,
      completedCredentialIds: [],
    };
  }

  const provider = repairStateProvider || defaultRepairStateProvider;

  try {
    const completedCredentialIds = normalizeCompletedCredentialIds(
      await provider.getCompletedCredentialIds?.(),
    );
    return {
      credentialId,
      eligible: !completedCredentialIds.includes(credentialId),
      completedCredentialIds,
    };
  } catch (error) {
    logger?.warn?.(
      `[Scrape:${credentials?.vendor || 'unknown'}] Failed to load scrape repair state: ${error?.message || error}`,
    );
    return {
      credentialId,
      eligible: false,
      completedCredentialIds: [],
    };
  }
}

async function markRepairBackfillComplete(repairContext, repairStateProvider, logger = console) {
  if (!repairContext?.eligible || !repairContext?.credentialId) {
    return false;
  }

  const provider = repairStateProvider || defaultRepairStateProvider;

  try {
    await provider.markCredentialRepairComplete?.(repairContext.credentialId);
    logger?.info?.(
      `[Scrape:${repairContext.vendor}] Recorded scrape repair completion for credential ${repairContext.credentialId}`,
    );
    return true;
  } catch (error) {
    logger?.warn?.(
      `[Scrape:${repairContext.vendor}] Failed to persist scrape repair completion: ${error?.message || error}`,
    );
    return false;
  }
}

function isAnonymizedSqliteDatabase() {
  const dbPath = process.env.SQLITE_DB_PATH || '';
  if (!dbPath) return false;
  return path.basename(String(dbPath)).toLowerCase().includes('anonymized');
}

function shouldSimulateDemoSync(options, credentials) {
  if (!isAnonymizedSqliteDatabase()) return false;

  const override = process.env.DEMO_SIMULATE_SYNC;
  if (override === 'false') return false;
  if (override === 'true') return true;

  if (options?.forceRealScrape === true) return false;

  // In anonymized demo DBs, credentials are intentionally blank.
  // Simulate sync so demos can still show "new transactions arrived" behavior.
  return !hasNonEmptyString(credentials?.password);
}

function buildSimulatedDemoResult(options, credentials, isBank) {
  const now = new Date();
  const nowIso = now.toISOString();
  const vendor = options?.companyId;
  const merchants = DEMO_SYNC_MERCHANTS[vendor] || DEMO_SYNC_MERCHANTS.default;
  const merchantName = pickRandom(merchants, 'עסקת דמו חדשה');
  const amount = Number((Math.random() * 180 + 40).toFixed(2));
  const rawAmount = isBank ? -amount : amount;
  const accountNumber = resolvePrimaryAccountNumber(credentials);
  const balance = isBank
    ? Number((32000 + Math.random() * 28000).toFixed(2))
    : Number((1200 + Math.random() * 6000).toFixed(2));

  return {
    success: true,
    accounts: [
      {
        accountNumber,
        balance,
        txns: [
          {
            identifier: `demo-sync-${vendor || 'vendor'}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            date: nowIso,
            processedDate: nowIso,
            description: merchantName,
            chargedAmount: rawAmount,
            originalAmount: rawAmount,
            originalCurrency: 'ILS',
            chargedCurrency: 'ILS',
            type: isBank ? 'transfer' : 'card',
            status: 'completed',
            memo: 'Simulated sync transaction for anonymized demo data',
            category: 'General',
          },
        ],
      },
    ],
  };
}

function isBankVendor(companyId) {
  return (
    BANK_VENDORS.includes(companyId) ||
    SPECIAL_BANK_VENDORS.includes(companyId) ||
    OTHER_BANK_VENDORS.includes(companyId)
  );
}

function getCredentialAuditLabel(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    return 'credential:unknown';
  }
  if (credentials.dbId) {
    return `credential:${credentials.dbId}`;
  }
  const fallback = credentials.nickname || credentials.username || credentials.email || credentials.id;
  if (!fallback) {
    return 'credential:unknown';
  }
  const digest = crypto.createHash('sha256').update(String(fallback)).digest('hex').slice(0, 8);
  return `credential:anon-${digest}`;
}

function resolveTriggeredBy(credentials) {
  return getCredentialAuditLabel(credentials);
}

function containsInsensitive(column, placeholder) {
  if (dialect.useSqlite) {
    return `${column} LIKE '%' || ${placeholder} || '%'`;
  }
  return `LOWER(${column}) LIKE '%' || LOWER(${placeholder}) || '%'`;
}

function likeInsensitive(column, placeholder) {
  if (dialect.useSqlite) {
    return `${column} LIKE ${placeholder}`;
  }
  return `LOWER(${column}) LIKE LOWER(${placeholder})`;
}

async function getPuppeteerExecutable(logger = console) {
  const fs = require('fs');

  // Using israeli-bank-scrapers-core with puppeteer-core — no bundled Chromium.
  // Resolve a system-installed Chrome/Chromium browser.
  const systemPaths = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
        ];

  for (const chromePath of systemPaths) {
    try {
      if (chromePath && fs.existsSync(chromePath)) {
        logger?.info?.(`Using system Chrome: ${chromePath}`);
        return chromePath;
      }
    } catch {
      // skip inaccessible paths
    }
  }

  logger?.error?.('No Chrome/Chromium browser found. Please install Google Chrome to enable bank syncing.');
  return undefined;
}

async function resolveStartDate(input, credentials, options = {}) {
  // 1. If user provides explicit startDate, use it (highest priority)
  if (input?.startDate) {
    const date = new Date(input.startDate);
    if (!Number.isNaN(date.getTime())) {
      const now = new Date();
      if (date > now) {
        return {
          date: now,
          reason: 'User-provided date (clamped to today)',
          hasTransactions: false,
          anchorSource: 'manual_start_date',
          overlapDaysApplied: 0,
          repairBackfillApplied: false,
          usedExplicitStartDate: true,
        };
      }
      return {
        date,
        reason: 'User-provided date',
        hasTransactions: false,
        anchorSource: 'manual_start_date',
        overlapDaysApplied: 0,
        repairBackfillApplied: false,
        usedExplicitStartDate: true,
      };
    }
  }

  try {
    const lastTxnInfo = await lastTransactionDateServiceRef.getLastTransactionDate({
      vendor: input.companyId,
      credentialNickname: credentials?.nickname,
      credentialId: options.credentialId ?? credentials?.dbId ?? null,
    });

    let resolvedDate = new Date(lastTxnInfo.lastTransactionDate);
    let repairBackfillApplied = false;
    let reason = lastTxnInfo.message;

    if (options.applyRepairBackfill) {
      const repairBackfillDate = buildRepairBackfillDate();
      if (repairBackfillDate.getTime() < resolvedDate.getTime()) {
        resolvedDate = repairBackfillDate;
        repairBackfillApplied = true;
        reason = `${reason}; applying one-time ${SCRAPE_ANCHOR_REPAIR_LOOKBACK_DAYS}-day repair backfill`;
      }
    }

    return {
      date: resolvedDate,
      reason,
      hasTransactions: lastTxnInfo.hasTransactions,
      anchorSource: lastTxnInfo.anchorSource || 'vendor_fallback',
      overlapDaysApplied: lastTxnInfo.overlapDaysApplied,
      repairBackfillApplied,
      usedExplicitStartDate: false,
    };
  } catch (error) {
    // Fallback if service fails: use default 3-month lookback
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() - DEFAULT_LOOKBACK_MONTHS);
    return {
      date: fallback,
      reason: `Fallback to ${DEFAULT_LOOKBACK_MONTHS} months ago (service error)`,
      hasTransactions: false,
      anchorSource: 'vendor_fallback',
      overlapDaysApplied: 0,
      repairBackfillApplied: false,
      usedExplicitStartDate: false,
    };
  }
}

function buildScraperOptions(options, isBank, executablePath, startDate) {
  // Show browser for banks and problematic credit card scrapers (MAX)
  const shouldShowBrowser = isBank || options.companyId === 'max';
  const showBrowser =
    typeof options?.showBrowser === 'boolean' ? options.showBrowser : shouldShowBrowser;

  // Use longer timeout for problematic scrapers
  const slowScrapers = ['max', 'discount', 'visaCal'];
  const timeout = slowScrapers.includes(options.companyId) ? MAX_TIMEOUT : DEFAULT_TIMEOUT;
  const userPreparePage = typeof options?.preparePage === 'function' ? options.preparePage : null;

  const preparePage = async (page) => {
    if (typeof page?.setDefaultTimeout === 'function') {
      page.setDefaultTimeout(timeout);
    }
    if (typeof page?.setDefaultNavigationTimeout === 'function') {
      page.setDefaultNavigationTimeout(timeout);
    }
    if (userPreparePage) {
      await userPreparePage(page);
    }
  };

  return {
    ...options,
    companyId: CompanyTypes[options.companyId],
    startDate,
    showBrowser,
    verbose: true,
    timeout,
    defaultTimeout: timeout,
    preparePage,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  };
}

function normalizeBalance(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : null;
  }
  const cleaned = value.replace(/,/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function prepareScraperCredentials(companyId, options, credentials) {
  if (companyId === CompanyTypes.visaCal || companyId === CompanyTypes.max) {
    return {
      username: credentials.username,
      password: credentials.password,
    };
  }

  if (companyId === CompanyTypes.discount || companyId === CompanyTypes.mercantile) {
    return {
      id: credentials.id,
      password: credentials.password,
      num: credentials.num || credentials.identification_code,
    };
  }

  if (companyId === CompanyTypes.hapoalim) {
    return {
      userCode: credentials.userCode || credentials.username,
      password: credentials.password,
    };
  }

  if (companyId === CompanyTypes.yahav) {
    return {
      username: credentials.username,
      password: credentials.password,
      nationalID: credentials.nationalID || credentials.id,
    };
  }

  if (companyId === CompanyTypes.beyahadBishvilha || companyId === CompanyTypes.behatsdaa) {
    return {
      id: credentials.id,
      password: credentials.password,
    };
  }

  if (companyId === CompanyTypes.oneZero) {
    return {
      email: credentials.email,
      password: credentials.password,
      otpCodeRetriever: credentials.otpCode ? () => Promise.resolve(credentials.otpCode) : undefined,
      otpLongTermToken: credentials.otpToken || null,
    };
  }

  if (companyId === CompanyTypes.amex) {
    return {
      username: credentials.id,
      card6Digits: credentials.card6Digits,
      password: credentials.password,
    };
  }

  if (isBankVendor(options.companyId)) {
    return {
      username: credentials.username,
      password: credentials.password,
      bankAccountNumber: credentials.bankAccountNumber || undefined,
    };
  }

  return {
    id: credentials.id,
    card6Digits: credentials.card6Digits,
    password: credentials.password,
  };
}

async function insertScrapeEvent(client, { triggeredBy, vendor, startDate, credentialId }) {
  const executor = client && typeof client.query === 'function' ? client : databaseRef;
  const result = await executor.query(
    `INSERT INTO scrape_events (triggered_by, vendor, start_date, status, message, credential_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [triggeredBy, vendor, startDate, 'started', 'Scrape initiated', credentialId || null],
  );
  return result.rows[0]?.id || null;
}

async function updateScrapeEventStatus(client, auditId, status, message) {
  if (!auditId) return;
  const executor = client && typeof client.query === 'function' ? client : databaseRef;
  await executor.query(
    `UPDATE scrape_events SET status = $1, message = $2 WHERE id = $3`,
    [status, message, auditId],
  );
}

async function safeUpdateScrapeEventStatus(auditId, status, message, logger) {
  if (!auditId) return;
  try {
    await updateScrapeEventStatus(databaseRef, auditId, status, message);
  } catch (error) {
    logger?.warn?.(`[Scrape] Failed to update scrape_events: ${error?.message || 'Unknown error'}`);
  }
}

const MAX_SCRAPE_EVENT_MESSAGE_LENGTH = 2000;

function truncateMessage(message, maxLength = MAX_SCRAPE_EVENT_MESSAGE_LENGTH) {
  if (!message || typeof message !== 'string') return message;
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 3)}...`;
}

function buildScrapeFailureMessage({ vendor, errorType, errorMessage, statusCode, details }) {
  const base = `${errorType || 'ScrapeError'}: ${errorMessage || 'Unknown error'}`;
  const payload = {
    vendor,
    ...(statusCode ? { statusCode } : {}),
    ...(details && Object.keys(details).length ? { details } : {}),
  };
  const extra = Object.keys(payload).length ? ` | ${JSON.stringify(payload)}` : '';
  return truncateMessage(`${base}${extra}`);
}

async function markCredentialScrapeStatus(client, credentialId, status) {
  const queries = {
    success: `UPDATE vendor_credentials
                SET last_scrape_attempt = CURRENT_TIMESTAMP,
                    last_scrape_success = CURRENT_TIMESTAMP,
                    last_scrape_status = 'success'
              WHERE id = $1`,
    failed: `UPDATE vendor_credentials
                SET last_scrape_attempt = CURRENT_TIMESTAMP,
                    last_scrape_status = 'failed'
              WHERE id = $1`,
  };

  const sql = status === 'success' ? queries.success : queries.failed;
  await client.query(sql, [credentialId]);
}

/**
 * Check if a credential has exhausted scrape attempts in the current cooldown window.
 * @param {number} credentialId - The credential ID to check
 * @param {number} thresholdMs - Time threshold in milliseconds (default: 24 hours)
 * @param {number} maxAttempts - Maximum allowed attempts during the window
 * @returns {Promise<boolean>} True when no more attempts are allowed, false otherwise
 */
async function wasScrapedRecently(
  credentialId,
  thresholdMs = SCRAPE_RATE_LIMIT_MS,
  maxAttempts = SCRAPE_RATE_LIMIT_MAX_ATTEMPTS,
) {
  if (!credentialId) return false;

  const safeThresholdMs = Number.isFinite(thresholdMs) && thresholdMs > 0
    ? thresholdMs
    : SCRAPE_RATE_LIMIT_MS;
  const safeMaxAttempts = Number.isFinite(maxAttempts) && maxAttempts > 0
    ? Math.floor(maxAttempts)
    : SCRAPE_RATE_LIMIT_MAX_ATTEMPTS;

  const client = await databaseRef.getClient();
  try {
    const windowStartIso = new Date(Date.now() - safeThresholdMs).toISOString();
    const result = await client.query(
      `SELECT COUNT(*) AS attempt_count
         FROM scrape_events
        WHERE credential_id = $1
          AND created_at >= $2`,
      [credentialId, windowStartIso],
    );
    const attemptCount = Number(result.rows[0]?.attempt_count || 0);
    return attemptCount >= safeMaxAttempts;
  } finally {
    client.release();
  }
}

function normalizeComparableText(value) {
  return String(value ?? '')
    .replace(/([A-Za-z])([\u0590-\u05FF])/g, '$1 $2')
    .replace(/([\u0590-\u05FF])([A-Za-z])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z\u0590-\u05FF])/g, '$1 $2')
    .replace(/([A-Za-z\u0590-\u05FF])([0-9])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^0-9a-z\u0590-\u05ff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getComparableAliasTags(value) {
  const normalized = normalizeComparableText(value);
  if (!normalized) return [];

  return MERCHANT_ALIAS_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(normalized)))
    .map((rule) => rule.canonical);
}

function getComparableTokens(value) {
  const normalized = normalizeComparableText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter((token) => token.length >= 2);
}

function getSharedTokenCount(leftTokens, rightTokens) {
  const rightSet = new Set(rightTokens);
  return leftTokens.reduce((count, token) => count + (rightSet.has(token) ? 1 : 0), 0);
}

function getNameMatchScore(left, right) {
  const a = normalizeComparableText(left);
  const b = normalizeComparableText(right);
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.startsWith(b) || b.startsWith(a)) return 2;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 6 && (a.includes(b) || b.includes(a))) return 1;

  const leftAliasTags = getComparableAliasTags(left);
  const rightAliasTags = getComparableAliasTags(right);
  const hasSharedAliasTag = leftAliasTags.some((tag) => rightAliasTags.includes(tag));
  if (hasSharedAliasTag) {
    const sharedTokenCount = getSharedTokenCount(
      getComparableTokens(left),
      getComparableTokens(right),
    );
    if (sharedTokenCount >= 2) {
      return 1;
    }
  }

  return 0;
}

function getAbsHoursDiff(leftIso, rightIso) {
  const left = new Date(leftIso);
  const right = new Date(rightIso);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.POSITIVE_INFINITY;
  return Math.abs(left.getTime() - right.getTime()) / (1000 * 60 * 60);
}

function getTransactionPrice(txn, isBank = false) {
  const rawAmount = txn?.chargedAmount || txn?.originalAmount || 0;
  return isBank ? rawAmount : rawAmount > 0 ? rawAmount * -1 : rawAmount;
}

function getIsraelDateTimeParts(value) {
  const parsed = normalizeOptionalDatetime(value);
  if (!parsed) return null;

  const parts = Object.create(null);
  for (const part of ISRAEL_DATE_PARTS_FORMATTER.formatToParts(parsed)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function isIsraelMidnight(value) {
  const parts = getIsraelDateTimeParts(value);
  if (!parts) return false;
  return parts.hour === '00' && parts.minute === '00' && parts.second === '00';
}

function hasSameInstant(left, right) {
  const leftDate = normalizeOptionalDatetime(left);
  const rightDate = normalizeOptionalDatetime(right);
  if (!leftDate || !rightDate) return false;
  return leftDate.getTime() === rightDate.getTime();
}

function hasSameProcessedMoment(left, right) {
  return hasSameInstant(left, right);
}

function shouldPreferIncomingCompletedDuplicateTimestamp(existingIso, incomingIso) {
  const existingDate = normalizeOptionalDatetime(existingIso);
  const incomingDate = normalizeOptionalDatetime(incomingIso);

  if (!existingDate) return Boolean(incomingDate);
  if (!incomingDate) return false;

  const existingIsMidnight = isIsraelMidnight(existingIso);
  const incomingIsMidnight = isIsraelMidnight(incomingIso);

  if (existingIsMidnight !== incomingIsMidnight) {
    return existingIsMidnight && !incomingIsMidnight;
  }

  return false;
}

function normalizeOptionalDatetime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildCompletionRecordFromTxn(txn) {
  return {
    name: txn.description ?? null,
    processedDate: txn.processedDate || null,
    processedDatetime: normalizeOptionalDatetime(txn.processedDate),
    originalAmount: txn.originalAmount ?? null,
    originalCurrency: txn.originalCurrency ?? null,
    chargedCurrency: txn.chargedCurrency ?? null,
    memo: txn.memo ?? null,
    type: txn.type ?? null,
  };
}

function buildCompletionRecordFromStoredTransaction(txn) {
  return {
    name: txn.name ?? null,
    processedDate: txn.processed_date || null,
    processedDatetime: normalizeOptionalDatetime(txn.processed_datetime || txn.processed_date),
    originalAmount: txn.original_amount ?? null,
    originalCurrency: txn.original_currency ?? null,
    chargedCurrency: txn.charged_currency ?? null,
    memo: txn.memo ?? null,
    type: txn.type ?? null,
  };
}

function isLikelyCompletedDuplicate(existingCandidate, transaction) {
  if (!existingCandidate || !transaction) return false;

  const existingParts = getIsraelDateTimeParts(existingCandidate.transaction_datetime);
  const incomingParts = getIsraelDateTimeParts(transaction.date);
  if (!existingParts || !incomingParts || existingParts.dateKey !== incomingParts.dateKey) {
    return false;
  }

  if (!hasSameProcessedMoment(existingCandidate.processed_date, transaction.processedDate)) {
    return false;
  }

  if (hasSameInstant(existingCandidate.transaction_datetime, transaction.date)) {
    return true;
  }

  return isIsraelMidnight(existingCandidate.transaction_datetime) || isIsraelMidnight(transaction.date);
}

async function mergeCompletedDuplicateTransaction(
  client,
  existingCandidate,
  completionRecord,
  transactionDate = null,
) {
  const shouldReplaceTimestamp = shouldPreferIncomingCompletedDuplicateTimestamp(
    existingCandidate?.transaction_datetime,
    transactionDate,
  );
  const normalizedTransactionDate = shouldReplaceTimestamp
    ? normalizeOptionalDatetime(transactionDate)
    : null;

  await client.query(
    `
      UPDATE transactions
      SET name = COALESCE($1, name),
          merchant_name = COALESCE($1, merchant_name),
          processed_date = COALESCE($2, processed_date),
          processed_datetime = COALESCE($3, processed_datetime),
          original_amount = COALESCE($4, original_amount),
          original_currency = COALESCE($5, original_currency),
          charged_currency = COALESCE($6, charged_currency),
          memo = CASE
            WHEN (memo IS NULL OR memo = '') AND $7 IS NOT NULL THEN $7
            ELSE memo
          END,
          type = COALESCE($8, type),
          date = COALESCE($9, date),
          transaction_datetime = COALESCE($10, transaction_datetime)
      WHERE identifier = $11 AND vendor = $12
    `,
    [
      completionRecord.name,
      completionRecord.processedDate,
      completionRecord.processedDatetime,
      completionRecord.originalAmount,
      completionRecord.originalCurrency,
      completionRecord.chargedCurrency,
      completionRecord.memo,
      completionRecord.type,
      normalizedTransactionDate,
      normalizedTransactionDate,
      existingCandidate.identifier,
      existingCandidate.vendor,
    ],
  );
}

async function promotePendingTransactionToCompleted(client, pendingCandidate, completionRecord) {
  await client.query(
    `
      UPDATE transactions
      SET status = 'completed',
          name = COALESCE($1, name),
          merchant_name = COALESCE($1, merchant_name),
          processed_date = COALESCE($2, processed_date),
          processed_datetime = COALESCE($3, processed_datetime),
          original_amount = COALESCE($4, original_amount),
          original_currency = COALESCE($5, original_currency),
          charged_currency = COALESCE($6, charged_currency),
          memo = CASE
            WHEN (memo IS NULL OR memo = '') AND $7 IS NOT NULL THEN $7
            ELSE memo
          END,
          type = COALESCE($8, type)
      WHERE identifier = $9 AND vendor = $10
    `,
    [
      completionRecord.name,
      completionRecord.processedDate,
      completionRecord.processedDatetime,
      completionRecord.originalAmount,
      completionRecord.originalCurrency,
      completionRecord.chargedCurrency,
      completionRecord.memo,
      completionRecord.type,
      pendingCandidate.identifier,
      pendingCandidate.vendor,
    ],
  );
}

async function deleteTransactionRecord(client, transaction) {
  await client.query(
    `DELETE FROM transactions WHERE identifier = $1 AND vendor = $2`,
    [transaction.identifier, transaction.vendor],
  );
}

function findMatchingScrapedCompletedTransaction(storedCompletedTxn, transactions = [], isBank = false) {
  const scored = transactions
    .filter((txn) => txn?.status === 'completed')
    .map((txn) => {
      if (Number(getTransactionPrice(txn, isBank)) !== Number(storedCompletedTxn?.price)) {
        return null;
      }

      const matchScore = getNameMatchScore(txn.description, storedCompletedTxn?.name);
      if (matchScore <= 0 || !isLikelyCompletedDuplicate(storedCompletedTxn, txn)) {
        return null;
      }

      return {
        txn,
        matchScore,
        hoursDiff: getAbsHoursDiff(txn.date, storedCompletedTxn.transaction_datetime),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.matchScore - a.matchScore || a.hoursDiff - b.hoursDiff);

  return scored[0]?.txn || null;
}

function buildReconciliationWindow(transactions = []) {
  const timestamps = transactions
    .map((txn) => normalizeOptionalDatetime(txn?.date))
    .filter(Boolean)
    .map((value) => value.getTime());

  if (timestamps.length === 0) {
    return null;
  }

  const windowMs = PENDING_COMPLETED_MATCH_WINDOW_HOURS * 60 * 60 * 1000;
  return {
    startIso: new Date(Math.min(...timestamps) - windowMs).toISOString(),
    endIso: new Date(Math.max(...timestamps) + windowMs).toISOString(),
  };
}

async function findLifecycleTransactionsForReconciliation(
  client,
  { vendor, accountNumber, startIso, endIso },
) {
  const result = await client.query(
    `
      SELECT
        identifier,
        vendor,
        name,
        status,
        price,
        processed_date,
        processed_datetime,
        original_amount,
        original_currency,
        charged_currency,
        memo,
        type,
        COALESCE(transaction_datetime, date) AS transaction_datetime
      FROM transactions
      WHERE vendor = $1
        AND (account_number IS $2 OR (account_number IS NULL AND $2 IS NULL))
        AND status IN ('pending', 'completed')
        AND COALESCE(transaction_datetime, date) BETWEEN $3 AND $4
      ORDER BY COALESCE(transaction_datetime, date) ASC
    `,
    [vendor, accountNumber ?? null, startIso, endIso],
  );

  return result.rows || [];
}

async function reconcileRecentlyScrapedAccountDuplicates(
  client,
  { vendor, accountNumber, transactions = [], isBank = false },
) {
  const completedTransactionsFromScrape = transactions.filter((txn) => txn?.status === 'completed');
  const window = buildReconciliationWindow(completedTransactionsFromScrape);
  if (!window) {
    return { duplicatePairsResolved: 0 };
  }

  const lifecycleTransactions = await findLifecycleTransactionsForReconciliation(client, {
    vendor,
    accountNumber,
    ...window,
  });

  if (lifecycleTransactions.length < 2) {
    return { duplicatePairsResolved: 0 };
  }

  const pendingTransactions = lifecycleTransactions.filter((txn) => txn.status === 'pending');
  const completedTransactions = lifecycleTransactions.filter((txn) => txn.status === 'completed');
  const usedPendingIdentifiers = new Set();
  let duplicatePairsResolved = 0;

  for (const completedTxn of completedTransactions) {
    const matchingScrapedCompletedTxn = findMatchingScrapedCompletedTransaction(
      completedTxn,
      completedTransactionsFromScrape,
      isBank,
    );
    if (!matchingScrapedCompletedTxn) {
      continue;
    }

    const matchingPendingCandidates = pendingTransactions.filter((candidate) => {
      if (usedPendingIdentifiers.has(candidate.identifier)) {
        return false;
      }

      return (
        Number(candidate.price) === Number(completedTxn.price) &&
        getAbsHoursDiff(candidate.transaction_datetime, completedTxn.transaction_datetime)
          <= PENDING_COMPLETED_MATCH_WINDOW_HOURS
      );
    });

    const bestPending = pickBestDuplicateCandidate(matchingPendingCandidates, {
      name: completedTxn.name,
      transactionDatetimeIso: completedTxn.transaction_datetime,
      status: 'pending',
    });

    if (!bestPending) {
      continue;
    }

    await promotePendingTransactionToCompleted(
      client,
      bestPending,
      buildCompletionRecordFromStoredTransaction(completedTxn),
    );
    await deleteTransactionRecord(client, completedTxn);
    usedPendingIdentifiers.add(bestPending.identifier);
    duplicatePairsResolved += 1;
  }

  return { duplicatePairsResolved };
}

async function findPotentialDuplicateTransactions(client, { vendor, accountNumber, price, transactionDatetimeIso }) {
  const transactionDate = new Date(transactionDatetimeIso);
  if (Number.isNaN(transactionDate.getTime())) return [];

  const windowMs = PENDING_COMPLETED_MATCH_WINDOW_HOURS * 60 * 60 * 1000;
  const startIso = new Date(transactionDate.getTime() - windowMs).toISOString();
  const endIso = new Date(transactionDate.getTime() + windowMs).toISOString();

  const result = await client.query(
    `
      SELECT
        identifier,
        vendor,
        name,
        status,
        processed_date,
        COALESCE(transaction_datetime, date) AS transaction_datetime
      FROM transactions
      WHERE vendor = $1
        AND (account_number IS $2 OR (account_number IS NULL AND $2 IS NULL))
        AND price = $3
        AND COALESCE(transaction_datetime, date) BETWEEN $4 AND $5
    `,
    [vendor, accountNumber ?? null, price, startIso, endIso],
  );

  return result.rows || [];
}

function pickBestDuplicateCandidate(candidates, { name, transactionDatetimeIso, status }) {
  const scored = candidates
    .filter((candidate) => (status ? candidate.status === status : true))
    .map((candidate) => {
      const matchScore = getNameMatchScore(name, candidate.name);
      if (matchScore <= 0) return null;
      const hoursDiff = getAbsHoursDiff(transactionDatetimeIso, candidate.transaction_datetime);
      return { ...candidate, matchScore, hoursDiff };
    })
    .filter(Boolean)
    .sort((a, b) => b.matchScore - a.matchScore || a.hoursDiff - b.hoursDiff);

  return scored[0] || null;
}

async function insertTransaction(txn, client, companyId, isBank, accountNumber, vendorNickname) {
  const transactionDate = new Date(txn.date);
  const transactionDatetimeIso = Number.isNaN(transactionDate.getTime())
    ? null
    : transactionDate.toISOString();

  const transactionPrice = getTransactionPrice(txn, isBank);

  if (transactionDatetimeIso && (txn.status === 'pending' || txn.status === 'completed')) {
    const candidates = await findPotentialDuplicateTransactions(client, {
      vendor: companyId,
      accountNumber,
      price: transactionPrice,
      transactionDatetimeIso,
    });

    const bestPending = pickBestDuplicateCandidate(candidates, {
      name: txn.description,
      transactionDatetimeIso,
      status: 'pending',
    });

    const bestCompleted = pickBestDuplicateCandidate(candidates, {
      name: txn.description,
      transactionDatetimeIso,
      status: 'completed',
    });

    if (txn.status === 'pending' && (bestCompleted || bestPending)) {
      return;
    }

    if (txn.status === 'completed' && bestPending) {
      await promotePendingTransactionToCompleted(client, bestPending, buildCompletionRecordFromTxn(txn));
      if (bestCompleted && isLikelyCompletedDuplicate(bestCompleted, txn)) {
        await deleteTransactionRecord(client, bestCompleted);
      }
      return;
    }

    if (txn.status === 'completed' && bestCompleted && isLikelyCompletedDuplicate(bestCompleted, txn)) {
      await mergeCompletedDuplicateTransaction(
        client,
        bestCompleted,
        buildCompletionRecordFromTxn(txn),
        txn.date,
      );
      return;
    }
  }

  const uniqueId = `${txn.identifier}-${companyId}-${txn.processedDate}-${txn.description}`;
  const hash = crypto.createHash('sha1');
  hash.update(uniqueId);
  const identifier = hash.digest('hex');

  if (isBank) {
    const bankCategory = await getBankCategoryDefinition(client);
    await client.query(
      `INSERT INTO transactions (
        identifier,
        vendor,
        vendor_nickname,
        date,
        name,
        price,
        category_definition_id,
        merchant_name,
        auto_categorized,
        confidence_score,
        type,
        processed_date,
        original_amount,
        original_currency,
        charged_currency,
        memo,
        status,
        account_number,
        category_type,
        transaction_datetime,
        processed_datetime
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      ON CONFLICT (identifier, vendor) DO NOTHING`,
      [
        identifier,
        companyId,
        vendorNickname || null,
        transactionDate,
        txn.description,
        transactionPrice,
        bankCategory.category_definition_id || bankCategory.id,
        txn.description,
        true,
        0.8,
        txn.type,
        txn.processedDate,
        txn.originalAmount,
        txn.originalCurrency,
        txn.chargedCurrency,
        txn.memo,
        txn.status,
        accountNumber,
        bankCategory.category_type || 'expense',
        transactionDate,
        txn.processedDate ? new Date(txn.processedDate) : new Date(),
      ],
    );
    return;
  }

  const amount = transactionPrice;

  let categoryDefinitionId = null;
  let parentCategory = null;
  let subcategory = null;
  let category = txn.category;

  const categorisation = await resolveCategory({
    client,
    rawCategory: txn.category,
    transactionName: txn.description,
  });

  if (categorisation) {
    categoryDefinitionId = categorisation.categoryDefinitionId;
    parentCategory = categorisation.parentCategory;
    subcategory = categorisation.subcategory;
    category = subcategory || parentCategory || category;
  } else if (amount < 0) {
    categoryDefinitionId = 1;
    const expenseCategory = await getCategoryInfo(1, client);
    if (expenseCategory) {
      category = expenseCategory.name;
      parentCategory = expenseCategory.name;
      subcategory = null;
    }
  }

  const categoryInfo = categoryDefinitionId ? await getCategoryInfo(categoryDefinitionId, client) : null;
  const categoryType = categoryInfo?.category_type || (category === 'Income' ? 'income' : 'expense');

  await client.query(
    `INSERT INTO transactions (
      identifier,
      vendor,
      vendor_nickname,
      date,
      name,
      price,
      category_definition_id,
      merchant_name,
      auto_categorized,
      confidence_score,
      type,
      processed_date,
      original_amount,
      original_currency,
      charged_currency,
      memo,
      status,
      account_number,
      category_type,
      transaction_datetime,
      processed_datetime
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    ON CONFLICT (identifier, vendor) DO NOTHING`,
    [
      identifier,
      companyId,
      vendorNickname || null,
      transactionDate,
      txn.description,
      amount,
      categoryDefinitionId,
      txn.description,
      Boolean(categoryDefinitionId),
      categoryDefinitionId ? 0.8 : 0.0,
      txn.type,
      txn.processedDate,
      txn.originalAmount,
      txn.originalCurrency,
      txn.chargedCurrency,
      txn.memo,
      txn.status,
      accountNumber,
      categoryType,
      transactionDate,
      txn.processedDate ? new Date(txn.processedDate) : new Date(),
    ],
  );
}

async function getBankCategoryDefinition(client) {
  if (cachedBankCategory) return cachedBankCategory;
  const bankCategory = await findCategoryByName(BANK_CATEGORY_NAME, null, client);
  if (!bankCategory) {
    throw new Error(`Bank category '${BANK_CATEGORY_NAME}' not found in category_definitions`);
  }
  cachedBankCategory = bankCategory;
  return bankCategory;
}

async function applyCategorizationRules(client) {
  const rulesResult = await client.query(
    `SELECT
        cr.id,
        cr.name_pattern,
        cr.target_category,
        cr.category_definition_id,
        cd.name AS resolved_subcategory,
        parent.name AS resolved_parent_category,
        cr.priority
      FROM categorization_rules cr
      LEFT JOIN category_definitions cd ON cd.id = cr.category_definition_id
      LEFT JOIN category_definitions parent ON parent.id = cd.parent_id
      WHERE cr.is_active = true
      ORDER BY cr.priority DESC, cr.id`,
  );

  const rules = rulesResult.rows;
  let totalUpdated = 0;

  for (const rule of rules) {
    const pattern = `%${rule.name_pattern}%`;
    let categoryId = rule.category_definition_id;
    let resolvedSub = rule.resolved_subcategory || null;
    let resolvedParent =
      rule.resolved_parent_category || (resolvedSub ? null : rule.target_category) || null;

    if (!categoryId) {
      const resolved = await resolveCategory({
        client,
        rawCategory: resolvedSub || resolvedParent || rule.target_category,
        transactionName: rule.name_pattern,
      });

      if (resolved) {
        categoryId = resolved.categoryDefinitionId;
        resolvedParent = resolved.parentCategory || resolvedParent;
        resolvedSub = resolved.subcategory || resolvedSub;
      }
    }

    const confidence = categoryId ? 0.8 : 0.5;

    const updateResult = await client.query(
      `UPDATE transactions
         SET category_definition_id = COALESCE($2, category_definition_id),
             auto_categorized = true,
             confidence_score = CASE
               WHEN confidence_score IS NULL OR confidence_score < $3 THEN $3
               ELSE confidence_score
             END
       WHERE ${likeInsensitive('name', '$1')}
         AND (
           category_definition_id IS NULL
           OR category_definition_id NOT IN (
             SELECT id FROM category_definitions
             WHERE name = $4 OR category_type = 'income'
           )
           OR category_definition_id IN (
             SELECT id FROM category_definitions
             WHERE depth_level < 2
           )
         )`,
      [pattern, categoryId, confidence, BANK_CATEGORY_NAME],
    );

    totalUpdated += updateResult.rowCount;
  }

  return { rulesApplied: rules.length, transactionsUpdated: totalUpdated };
}

async function applyAccountPairings(client) {
  const pairingsResult = await client.query(
    `SELECT
        id,
        credit_card_vendor,
        credit_card_account_number,
        bank_vendor,
        bank_account_number,
        match_patterns
      FROM account_pairings
      WHERE is_active = true`,
  );

  const pairings = pairingsResult.rows;
  if (pairings.length === 0) {
    return { pairingsApplied: 0, transactionsUpdated: 0 };
  }

  // Lookup the Credit Card Repayment category ID dynamically
  const creditCardRepaymentCategoryId = await getCreditCardRepaymentCategoryId(client);

  if (!creditCardRepaymentCategoryId) {
    console.warn('Credit Card Repayment category not found - skipping account pairings categorization');
    return { pairingsApplied: 0, transactionsUpdated: 0 };
  }

  let totalUpdated = 0;

  for (const pairing of pairings) {
    const bankVendor = pairing.bank_vendor;
    const bankAccountNumber = pairing.bank_account_number;
    const matchPatterns = pairing.match_patterns ? JSON.parse(pairing.match_patterns) : [];

    if (matchPatterns.length === 0) {
      continue;
    }

    const params = [bankVendor];
    const conditions = matchPatterns.map((pattern, idx) => {
      params.push(pattern);
      return containsInsensitive('name', `$${idx + 2}`);
    });

    // Add the category ID as a parameter
    params.push(creditCardRepaymentCategoryId);
    const categoryIdParamIndex = params.length;

    let query = `
      UPDATE transactions
         SET category_definition_id = $${categoryIdParamIndex}
       WHERE vendor = $1
         AND (${conditions.join(' OR ')})
    `;

    if (bankAccountNumber) {
      params.push(bankAccountNumber);
      query += ` AND account_number = $${params.length}`;
    }

    const updateResult = await client.query(query, params);
    totalUpdated += updateResult.rowCount;

    if (updateResult.rowCount > 0) {
      await client.query(
        `INSERT INTO account_pairing_log (pairing_id, action, transaction_count)
         VALUES ($1, $2, $3)`,
        [pairing.id, 'applied', updateResult.rowCount],
      );
    }
  }

  return { pairingsApplied: pairings.length, transactionsUpdated: totalUpdated };
}

async function updateVendorAccountNumbers(client, options, credentials, discoveredAccountNumbers, isBank) {
  if (discoveredAccountNumbers.size === 0) {
    return;
  }

  const accountNumbersStr = Array.from(discoveredAccountNumbers).join(';');
  const fieldName = isBank ? 'bank_account_number' : 'card6_digits';

  // Match by vendor_credentials.id when available to avoid ambiguity between:
  // - credentials.id (often the user's ID number for authentication)
  // - credentials.dbId (the vendor_credentials row ID used for scrape_events tracking)
  const credentialRowId = credentials?.dbId ?? credentials?.id;
  if (!credentialRowId) {
    return;
  }

  await client.query(
    `UPDATE vendor_credentials
        SET ${fieldName} = $1,
            updated_at = CURRENT_TIMESTAMP
      WHERE vendor = $2
        AND id = $3`,
    [accountNumbersStr, options.companyId, credentialRowId],
  );
}

async function updateVendorBalance(client, options, credentials, account, logger = console) {
  const normalizedBalance = normalizeBalance(account.balance);
  if (normalizedBalance === null) {
    logger?.debug?.(`No valid balance found for account ${account.accountNumber || 'unknown'}`);
    return;
  }

  logger?.info?.(`[Scrape:${options.companyId}] Captured balance for ${options.companyId}: ₪${normalizedBalance} (account: ${account.accountNumber || 'N/A'})`);

  // Find the credential record - credentials.id might be user ID number or database row ID
  // First, try to find by vendor + account number (most specific)
  let credentialRecord = null;
  if (account.accountNumber) {
    const accountResult = await client.query(
      `SELECT id FROM vendor_credentials
       WHERE vendor = $1 AND (bank_account_number = $2 OR card6_digits = $2)
       LIMIT 1`,
      [options.companyId, account.accountNumber]
    );
    if (accountResult.rows.length > 0) {
      credentialRecord = accountResult.rows[0];
    }
  }

  // If not found by account number, try by vendor only (single credential case)
  if (!credentialRecord) {
    const vendorResult = await client.query(
      `SELECT id FROM vendor_credentials
       WHERE vendor = $1
       LIMIT 1`,
      [options.companyId]
    );
    if (vendorResult.rows.length > 0) {
      credentialRecord = vendorResult.rows[0];
    }
  }

  if (!credentialRecord) {
    logger?.warn?.(`[Scrape:${options.companyId}] ✗ No credential record found for vendor ${options.companyId}`);
    return;
  }

  const dbCredentialId = credentialRecord.id;

  // Update using database row ID
  const result = await client.query(
    `UPDATE vendor_credentials
        SET current_balance = $1,
            balance_updated_at = CURRENT_TIMESTAMP,
            last_scrape_success = CURRENT_TIMESTAMP,
            last_scrape_status = 'success'
      WHERE id = $2`,
    [normalizedBalance, dbCredentialId],
  );

  if (result.rowCount > 0) {
    logger?.info?.(`[Scrape:${options.companyId}] ✓ Balance updated successfully for credential ID ${dbCredentialId}`);

    // Sync balance to investment holdings (bank accounts only)
    const isBank = isBankVendor(options.companyId);
    if (isBank) {
      try {
        // Pass credential with correct database ID and institution_id
        // Fetch institution_id if not present in credentials
        let institutionId = credentials.institution_id;
        if (!institutionId) {
          const instResult = await client.query(
            `SELECT institution_id FROM vendor_credentials WHERE id = $1`,
            [dbCredentialId]
          );
          institutionId = instResult.rows[0]?.institution_id;
        }
        const credentialForSync = {
          ...credentials,
          id: dbCredentialId,
          dbId: dbCredentialId,
          institution_id: institutionId,
          vendor: options.companyId,
        };
        logger?.info?.(`[Scrape:${options.companyId}] Starting balance sync to investments...`);
        const syncResult = await syncBankBalanceToInvestments(client, credentialForSync, normalizedBalance, account.accountNumber, logger);
        
        if (syncResult.success) {
          if (syncResult.skipped) {
            logger?.info?.(`[Scrape:${options.companyId}] Balance sync skipped: ${syncResult.reason}`);
          } else {
            logger?.info?.(`[Scrape:${options.companyId}] ✓ Balance synced to investments (filled ${syncResult.filledDates || 0} dates)`);
          }
        } else {
          logger?.warn?.(`[Scrape:${options.companyId}] Balance sync completed with error: ${syncResult.error}`);
        }
      } catch (syncError) {
        logger?.error?.(`[Scrape:${options.companyId}] Failed to sync balance to investment holdings:`, syncError.message);
        // Don't fail the whole scrape if balance sync fails
      }
    }
  } else {
    const credentialRef = getCredentialAuditLabel(credentials);
    logger?.warn?.(`[Scrape:${options.companyId}] ✗ Balance update failed - no matching credential found (vendor: ${options.companyId}, credential: ${credentialRef}, account: ${account.accountNumber || 'N/A'})`);
  }
}

async function processScrapeResult(client, { options, credentials, result, isBank, logger = console }) {
  let bankTransactions = 0;
  const discoveredAccountNumbers = new Set();

  const accountCount = result.accounts?.length || 0;
  const credentialRef = getCredentialAuditLabel(credentials);
  logger?.info?.(`[Scrape:${options.companyId}] Processing ${accountCount} accounts for credential: ${credentialRef}`);

  // Handle case where there are no accounts or no transactions
  if (!result.accounts || result.accounts.length === 0) {
    logger?.info?.(`[Scrape:${options.companyId}] No accounts returned from scraper - this may be normal if no new data since last sync`);
    return { bankTransactions: 0 };
  }

  // Count total transactions across all accounts
  const totalTxns = result.accounts.reduce((sum, acc) => sum + (acc.txns?.length || 0), 0);
  logger?.info?.(`[Scrape:${options.companyId}] Total transactions across all accounts: ${totalTxns}`);

  if (totalTxns === 0) {
    logger?.info?.(`[Scrape:${options.companyId}] No new transactions found - updating balances only`);
  }

  for (const account of result.accounts || []) {
    const txnCount = account.txns?.length || 0;
    const normalizedBalance = normalizeBalance(account.balance);
    const hasBalance = normalizedBalance !== null;
    logger?.info?.(`[Scrape:${options.companyId}] Account ${account.accountNumber || 'N/A'}: ${txnCount} transactions, balance: ${hasBalance ? `₪${normalizedBalance}` : 'N/A'}`);

    if (account.accountNumber) {
      discoveredAccountNumbers.add(account.accountNumber);
    }

    // Always try to update balance even if no transactions
    try {
      await updateVendorBalance(client, options, credentials, account, logger);
    } catch (balanceError) {
      logger?.error?.(`[Scrape:${options.companyId}] Failed to update balance for ${account.accountNumber}:`, balanceError.message);
      // Don't fail the entire scrape for balance update errors
    }

    for (const txn of account.txns || []) {
      if (isBank) {
        bankTransactions += 1;
      }
      await insertTransaction(txn, client, options.companyId, isBank, account.accountNumber, credentials.nickname);
    }

    const reconciliation = await reconcileRecentlyScrapedAccountDuplicates(client, {
      vendor: options.companyId,
      accountNumber: account.accountNumber,
      transactions: account.txns || [],
      isBank,
    });
    if (reconciliation.duplicatePairsResolved > 0) {
      logger?.info?.(
        `[Scrape:${options.companyId}] Reconciled ${reconciliation.duplicatePairsResolved} duplicate lifecycle pair(s) for account ${account.accountNumber || 'N/A'}`,
      );
    }
  }

  await updateVendorAccountNumbers(client, options, credentials, discoveredAccountNumbers, isBank);

  logger?.info?.(`[Scrape:${options.companyId}] Completed: ${bankTransactions} bank transactions, ${discoveredAccountNumbers.size} unique accounts`);

  return { bankTransactions };
}

/**
 * Internal implementation of runScrape
 * This function contains the actual scraping logic and is wrapped by the mutex
 */
async function _runScrapeInternal({
  options,
  credentials,
  execute,
  logger = console,
  repairStateProvider = defaultRepairStateProvider,
}) {
  if (!options?.companyId) {
    throw createHttpError(400, 'Missing companyId');
  }

  const companyType = CompanyTypes[options.companyId];
  if (!companyType) {
    throw createHttpError(400, 'Invalid company ID');
  }

  const isBank = isBankVendor(options.companyId);
  const repairContext = await resolveRepairBackfillState(
    { ...credentials, vendor: options.companyId },
    repairStateProvider,
    logger,
  );
  const startDateInfo = await resolveStartDate(options, credentials, {
    credentialId: repairContext.credentialId,
    applyRepairBackfill: repairContext.eligible,
  });
  const repairCompletionContext = {
    ...repairContext,
    vendor: options.companyId,
    eligible: repairContext.eligible && !startDateInfo.usedExplicitStartDate,
  };
  const resolvedStartDate = startDateInfo.date;
  const scrapeAnchor = {
    source: startDateInfo.anchorSource || 'vendor_fallback',
    overlapDays: Number.isFinite(startDateInfo.overlapDaysApplied)
      ? startDateInfo.overlapDaysApplied
      : null,
    repairBackfillApplied: Boolean(startDateInfo.repairBackfillApplied),
    usedExplicitStartDate: Boolean(startDateInfo.usedExplicitStartDate),
    credentialId: repairContext.credentialId,
    startDate: resolvedStartDate.toISOString(),
  };
  const client = await databaseRef.getClient();
  let auditId = null;
  let failureMessage = null;

  // Log the determined scrape date range for transparency
  const endDate = new Date();
  const auditLabel = getCredentialAuditLabel(credentials);
  logger?.info?.(`[Scrape:${options.companyId}] Credential: ${auditLabel}`);
  logger?.info?.(`[Scrape:${options.companyId}] Date range: ${resolvedStartDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  logger?.info?.(`[Scrape:${options.companyId}] Reason: ${startDateInfo.reason}`);
  logger?.info?.(
    `[Scrape:${options.companyId}] Anchor source: ${scrapeAnchor.source}; overlap=${scrapeAnchor.overlapDays ?? 0}; repair=${scrapeAnchor.repairBackfillApplied ? 'applied' : 'none'}`,
  );

  try {
    const triggeredBy = resolveTriggeredBy(credentials);
    try {
      auditId = await insertScrapeEvent(databaseRef, {
        triggeredBy,
        vendor: options.companyId,
        startDate: resolvedStartDate,
        credentialId: credentials.dbId || null,
      });
    } catch (error) {
      logger?.warn?.(`[Scrape:${options.companyId}] Failed to write scrape_events start record: ${error?.message || 'Unknown error'}`);
    }

    await client.query('BEGIN');

    const executablePath = await getPuppeteerExecutable(logger);
    if (!executablePath) {
      throw createHttpError(500,
        'No Chrome or Chromium browser found. Please install Google Chrome to enable bank syncing.',
        { errorType: 'browserNotFound' }
      );
    }
    const scraperOptions = buildScraperOptions(options, isBank, executablePath, resolvedStartDate);
    const scraperCredentials = prepareScraperCredentials(companyType, options, credentials);

    if (shouldSimulateDemoSync(options, credentials)) {
      logger?.info?.(
        `[Scrape:${options.companyId}] Using demo sync simulation for anonymized dataset`,
      );

      const simulatedResult = buildSimulatedDemoResult(options, credentials, isBank);
      const summary = await processScrapeResult(client, {
        options,
        credentials,
        result: simulatedResult,
        isBank,
        logger,
      });

      await applyCategorizationRules(client);
      await applyAccountPairings(client);
      if (credentials.dbId) {
        await markCredentialScrapeStatus(client, credentials.dbId, 'success');
      }

      const accountsCount = Array.isArray(simulatedResult.accounts) ? simulatedResult.accounts.length : 0;
      const message = `Demo sync simulated: accounts=${accountsCount}, bankTxns=${summary.bankTransactions}`;

      await client.query('COMMIT');
      await safeUpdateScrapeEventStatus(auditId, 'success', message, logger);
      await markRepairBackfillComplete(repairCompletionContext, repairStateProvider, logger);

      return {
        success: true,
        message: 'Demo sync completed with simulated transaction',
        accounts: simulatedResult.accounts,
        bankTransactions: summary.bankTransactions,
        simulated: true,
        scrapeAnchor,
      };
    }

    const scraperExecutor = execute
      ? () => execute({ scraperOptions, scraperCredentials })
      : async () => {
          const scraper = createScraper(scraperOptions);
          return scraper.scrape(scraperCredentials);
        };

    const result = await scraperExecutor();

    // Log raw scraper result for debugging
    logger?.info?.(`[Scrape:${options.companyId}] Raw result: success=${result?.success}, accounts=${result?.accounts?.length || 0}`);
    if (result?.accounts) {
      result.accounts.forEach((acc, idx) => {
        const normalizedBalance = normalizeBalance(acc.balance);
        const balanceLabel = normalizedBalance === null ? 'N/A' : normalizedBalance;
        logger?.info?.(`[Scrape:${options.companyId}] Account ${idx + 1}: accountNumber=${acc.accountNumber}, txns=${acc.txns?.length || 0}, balance=${balanceLabel}`);
      });
    }

    // Check for "no transactions found" messages which should be treated as success
    // Common Hebrew messages from Israeli banks meaning "no transactions found in date range"
    const noTransactionsPatterns = [
      'לא מצאנו תנועות',  // "We didn't find transactions"
      'לא נמצאו תנועות',  // "No transactions found"
      'אין תנועות',       // "No transactions"
      'no transactions',
      'no results',
    ];

    const isNoTransactionsError = result?.errorMessage && noTransactionsPatterns.some(
      pattern => result.errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );

    if (!result?.success) {
      // Handle "no transactions" as a soft success - just means nothing new since last scrape
      if (isNoTransactionsError) {
        logger?.info?.(`[Scrape:${options.companyId}] No new transactions found since last scrape - this is normal`);
        logger?.info?.(`[Scrape:${options.companyId}] Bank message: ${result?.errorMessage}`);
        
        // Try to update balance even without transactions (if accounts have balance info)
        // Some scrapers may still return account info with balance even if no new transactions
        if (result?.accounts?.length > 0) {
          const summary = await processScrapeResult(client, {
            options,
            credentials,
            result: { ...result, success: true }, // Treat as success for processing
            isBank,
            logger,
          });
          
          const successMessage = 'No new transactions (balance updated)';
          if (credentials.dbId) {
            await markCredentialScrapeStatus(client, credentials.dbId, 'success');
          }

          await client.query('COMMIT');
          await safeUpdateScrapeEventStatus(auditId, 'success', successMessage, logger);
          await markRepairBackfillComplete(repairCompletionContext, repairStateProvider, logger);
          
          return {
            success: true,
            message: 'No new transactions found - balance sync completed',
            accounts: result.accounts,
            bankTransactions: summary.bankTransactions,
            noNewTransactions: true,
            scrapeAnchor,
          };
        }
        
        // No accounts returned, but still mark as success (nothing to sync)
        // However, we should still forward-fill the portfolio history for this credential
        // so the "last update date" on the portfolio graph reflects this sync
        logger?.info?.(`[Scrape:${options.companyId}] No account data returned - forward-filling portfolio history with last known values`);
        
        try {
          const forwardFillResult = await forwardFillForCredential(client, credentials, logger);
          logger?.info?.(`[Scrape:${options.companyId}] Forward-fill completed: ${forwardFillResult.accountsUpdated} accounts updated, ${forwardFillResult.datesForwardFilled} date entries added`);
        } catch (forwardFillError) {
          logger?.warn?.(`[Scrape:${options.companyId}] Forward-fill failed (non-critical): ${forwardFillError.message}`);
        }
        
        const successMessage = 'No new transactions (portfolio history updated)';
        if (credentials.dbId) {
          await markCredentialScrapeStatus(client, credentials.dbId, 'success');
        }

        await client.query('COMMIT');
        await safeUpdateScrapeEventStatus(auditId, 'success', successMessage, logger);
        await markRepairBackfillComplete(repairCompletionContext, repairStateProvider, logger);
        
        return {
          success: true,
          message: 'No new transactions found since last scrape (portfolio history updated)',
          accounts: [],
          bankTransactions: 0,
          noNewTransactions: true,
          scrapeAnchor,
        };
      }

      // Log detailed error information for debugging
      logger?.error?.(`[Scrape:${options.companyId}] Scrape failed with errorType: ${result?.errorType || 'unknown'}`);
      logger?.error?.(`[Scrape:${options.companyId}] Error message: ${result?.errorMessage || 'No error message provided'}`);
      logger?.error?.(`[Scrape:${options.companyId}] Full result object: ${JSON.stringify({
        success: result?.success,
        errorType: result?.errorType,
        errorMessage: result?.errorMessage,
        accounts: result?.accounts?.length || 0,
        // Include any additional fields that might provide context
        ...(result?.error && { error: String(result.error) }),
      })}`);

      const baseMessage = `${result?.errorType || 'ScrapeError'}: ${result?.errorMessage || 'Unknown error'}`;
      failureMessage = buildScrapeFailureMessage({
        vendor: options.companyId,
        errorType: result?.errorType,
        errorMessage: result?.errorMessage,
        statusCode: 400,
        details: {
          accounts: Array.isArray(result?.accounts) ? result.accounts.length : 0,
          hasAccounts: Array.isArray(result?.accounts) && result.accounts.length > 0,
        },
      });
      throw createHttpError(400, baseMessage, { errorType: result?.errorType });
    }

    const summary = await processScrapeResult(client, {
      options,
      credentials,
      result,
      isBank,
      logger,
    });

    await applyCategorizationRules(client);
    await applyAccountPairings(client);
    if (credentials.dbId) {
      await markCredentialScrapeStatus(client, credentials.dbId, 'success');
    }

    const accountsCount = Array.isArray(result.accounts) ? result.accounts.length : 0;
    const message = `Success: accounts=${accountsCount}, bankTxns=${summary.bankTransactions}`;

    await client.query('COMMIT');
    await safeUpdateScrapeEventStatus(auditId, 'success', message, logger);
    await markRepairBackfillComplete(repairCompletionContext, repairStateProvider, logger);

    return {
      success: true,
      message: 'Scraping and database update completed successfully',
      accounts: result.accounts,
      bankTransactions: summary.bankTransactions,
      scrapeAnchor,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    const failureDetails = failureMessage || buildScrapeFailureMessage({
      vendor: options.companyId,
      errorType: error?.errorType || error?.name,
      errorMessage: error?.message,
      statusCode: error?.statusCode,
    });
    await safeUpdateScrapeEventStatus(auditId, 'failed', failureDetails, logger);
    if (credentials.dbId) {
      await markCredentialScrapeStatus(client, credentials.dbId, 'failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Public wrapper for runScrape that ensures only one scrape runs at a time
 * Uses a mutex to prevent SQLite "cannot start a transaction within a transaction" errors
 * @param {Object} params - Scrape parameters
 * @param {Object} params.options - Scrape options including companyId and startDate
 * @param {Object} params.credentials - Credentials for the scraper
 * @param {Function} [params.execute] - Optional custom executor function
 * @param {Object} [params.logger] - Optional logger instance
 * @returns {Promise<Object>} Scrape result
 */
async function runScrape(params) {
  const queueLength = scrapeMutex.getQueueLength();
  if (queueLength > 0) {
    params.logger?.info?.(
      `[Scrape:${params.options?.companyId}] Waiting for ${queueLength} other scrape(s) to complete...`
    );
  }

  return scrapeMutex.runExclusive(() => _runScrapeInternal(params));
}

module.exports = {
  runScrape,
  wasScrapedRecently,
  _internal: {
    createHttpError,
    hasNonEmptyString,
    pickRandom,
    resolvePrimaryAccountNumber,
    normalizeCredentialId,
    normalizeCompletedCredentialIds,
    buildRepairBackfillDate,
    resolveRepairBackfillState,
    markRepairBackfillComplete,
    isAnonymizedSqliteDatabase,
    shouldSimulateDemoSync,
    buildSimulatedDemoResult,
    isBankVendor,
    getCredentialAuditLabel,
    resolveTriggeredBy,
    getPuppeteerExecutable,
    resolveStartDate,
    buildScraperOptions,
    normalizeBalance,
    prepareScraperCredentials,
    insertScrapeEvent,
    updateScrapeEventStatus,
    safeUpdateScrapeEventStatus,
    truncateMessage,
    buildScrapeFailureMessage,
    markCredentialScrapeStatus,
    normalizeComparableText,
    getNameMatchScore,
    getAbsHoursDiff,
    getTransactionPrice,
    getIsraelDateTimeParts,
    isIsraelMidnight,
    hasSameInstant,
    hasSameProcessedMoment,
    shouldPreferIncomingCompletedDuplicateTimestamp,
    normalizeOptionalDatetime,
    buildCompletionRecordFromTxn,
    buildCompletionRecordFromStoredTransaction,
    isLikelyCompletedDuplicate,
    mergeCompletedDuplicateTransaction,
    promotePendingTransactionToCompleted,
    deleteTransactionRecord,
    findMatchingScrapedCompletedTransaction,
    buildReconciliationWindow,
    findLifecycleTransactionsForReconciliation,
    reconcileRecentlyScrapedAccountDuplicates,
    findPotentialDuplicateTransactions,
    pickBestDuplicateCandidate,
    insertTransaction,
    getBankCategoryDefinition,
    applyCategorizationRules,
    applyAccountPairings,
    updateVendorAccountNumbers,
    updateVendorBalance,
    processScrapeResult,
    _runScrapeInternal,
  },
  __setDatabaseForTests(dbOverride = null) {
    databaseRef = dbOverride || baseDatabase;
  },
  __resetDatabaseForTests() {
    databaseRef = baseDatabase;
  },
  __setLastTransactionDateServiceForTests(serviceOverride = null) {
    lastTransactionDateServiceRef = serviceOverride || lastTransactionDateService;
  },
  __resetLastTransactionDateServiceForTests() {
    lastTransactionDateServiceRef = lastTransactionDateService;
  },
};

module.exports.default = module.exports;
