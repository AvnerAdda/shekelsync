const database = require('../database.js');
const { decrypt } = require('../../../lib/server/encryption.js');
const { STALE_SYNC_THRESHOLD_MS, SCRAPE_RATE_LIMIT_MS } = require('../../../utils/constants.js');
const scrapingService = require('./run.js');

let databaseRef = database;
let scrapingServiceRef = scrapingService;

function decryptCredential(value, fieldName) {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('Invalid encrypted credential value');
    }
    return decrypt(value);
  } catch {
    const error = new Error(
      `Saved credential field ${fieldName || 'unknown'} could not be decrypted. ` +
      'Re-enter this account before syncing.',
    );
    error.code = 'credential_decrypt_failed';
    throw error;
  }
}

function defaultLogger() {
  /* no-op */
}

function toLogger(logger = console) {
  if (!logger) {
    return {
      log: defaultLogger,
      info: defaultLogger,
      warn: defaultLogger,
      error: defaultLogger,
    };
  }

  return {
    log: logger.log ? logger.log.bind(logger) : defaultLogger,
    info: logger.info ? logger.info.bind(logger) : defaultLogger,
    warn: logger.warn ? logger.warn.bind(logger) : defaultLogger,
    error: logger.error ? logger.error.bind(logger) : defaultLogger,
  };
}

async function bulkScrape(options = {}) {
  const {
    thresholdMs = STALE_SYNC_THRESHOLD_MS,
    rateLimitMs = SCRAPE_RATE_LIMIT_MS,
    logger = console,
    showBrowser = false,
    repairStateProvider,
    onAccountStart,
    onAccountComplete,
    createLogger,
  } = options;

  const log = toLogger(logger);
  const client = await databaseRef.getClient();

  try {
    const thresholdDate = new Date(Date.now() - thresholdMs);
    const rateLimitDate = new Date(Date.now() - rateLimitMs);

    const staleAccountsResult = await client.query(
      `
        SELECT
          vc.id,
          vc.vendor,
          vc.nickname,
          vc.username,
          vc.password,
          vc.id_number,
          vc.card6_digits,
          vc.bank_account_number,
          vc.identification_code,
          vc.institution_id,
          COALESCE(vc.updated_at, vc.created_at) AS credential_last_updated,
          COALESCE(last_scrapes.last_successful_scrape, vc.created_at) AS last_update
        FROM vendor_credentials vc
        LEFT JOIN (
          SELECT
            credential_id,
            MAX(CASE WHEN status = 'success' THEN created_at ELSE NULL END) AS last_successful_scrape
          FROM scrape_events
          WHERE credential_id IS NOT NULL
          GROUP BY credential_id
        ) last_scrapes ON vc.id = last_scrapes.credential_id
        WHERE (
          -- Sync accounts that were never successfully scraped.
          last_scrapes.last_successful_scrape IS NULL
          -- Sync accounts with stale successful scrapes.
          OR COALESCE(last_scrapes.last_successful_scrape, vc.created_at) < $1
          -- Sync accounts whose credentials changed after their last successful scrape.
          OR COALESCE(last_scrapes.last_successful_scrape, vc.created_at) < COALESCE(vc.updated_at, vc.created_at)
        )
          AND (
            vc.last_scrape_attempt IS NULL
            OR vc.last_scrape_attempt < $2
            -- Allow an immediate retry if credentials were edited after the last attempt.
            OR COALESCE(vc.updated_at, vc.created_at) > vc.last_scrape_attempt
          )
        ORDER BY last_update ASC
      `,
      [thresholdDate, rateLimitDate],
    );

    const staleAccounts = staleAccountsResult.rows;

    if (staleAccounts.length === 0) {
      return {
        success: true,
        status: 'success',
        message: 'All accounts are up to date',
        totalProcessed: 0,
        successCount: 0,
        failureCount: 0,
        blockedCount: 0,
        totalTransactions: 0,
        results: [],
      };
    }

    log.info?.(`[Bulk Scrape] Found ${staleAccounts.length} accounts needing sync`);

    const totalAccounts = staleAccounts.length;

    // Process accounts sequentially to avoid SQLite transaction conflicts
    // SQLite doesn't support concurrent transactions on the same connection
    const processedResults = [];

    // Enter bulk mode to disable expensive triggers during bulk inserts
    // This significantly improves performance for large scraping operations
    const pool = databaseRef._pool || databaseRef;
    const hasBulkMode = typeof pool.enterBulkMode === 'function';
    if (hasBulkMode) {
      log.info?.('[Bulk Scrape] Entering bulk mode - disabling triggers for performance');
      pool.enterBulkMode();
    }

    for (let index = 0; index < staleAccounts.length; index++) {
      const account = staleAccounts[index];
      onAccountStart?.({ account, index, total: totalAccounts });

      try {
        const decryptedUsername = decryptCredential(account.username, 'username');
        const decryptedIdentificationCode = decryptCredential(
          account.identification_code,
          'identification_code',
        );

        const decryptedCredentials = {
          dbId: account.id, // Database row ID for scrape event tracking
          id: decryptCredential(account.id_number, 'id_number'),
          // Card/account identifiers are intentionally stored as plain values.
          card6Digits: account.card6_digits || null,
          password: decryptCredential(account.password, 'password'),
          username: decryptedUsername,
          userCode: decryptedUsername,
          email: decryptedUsername,
          bankAccountNumber: account.bank_account_number || null,
          identification_code: decryptedIdentificationCode,
          num: decryptedIdentificationCode,
          nationalID: decryptedIdentificationCode,
          otpToken: decryptedIdentificationCode,
          nickname: account.nickname,
          institution_id: account.institution_id,
          vendor: account.vendor,
        };

        const scrapeOptions = {
          companyId: account.vendor,
          combineInstallments: false,
          showBrowser: Boolean(showBrowser),
          additionalTransactionInformation: true,
        };

        log.info?.(`[Bulk Scrape] Starting scrape for ${account.vendor} (${account.nickname})`);

        const accountLogger = typeof createLogger === 'function' ? createLogger(account.vendor) : logger;

        const scrapeResult = await scrapingServiceRef.runScrape({
          options: scrapeOptions,
          credentials: decryptedCredentials,
          logger: accountLogger,
          repairStateProvider,
        });

        const transactionCount = Array.isArray(scrapeResult.accounts)
          ? scrapeResult.accounts.reduce((sum, acc) => sum + (Array.isArray(acc.txns) ? acc.txns.length : 0), 0)
          : 0;

        const summary = {
          vendor: account.vendor,
          nickname: account.nickname,
          success: Boolean(scrapeResult.success),
          status: scrapeResult.success ? 'success' : 'failed',
          message:
            scrapeResult.message ||
            (scrapeResult.success ? 'Scraped successfully' : scrapeResult.errorMessage || 'Scrape failed'),
          transactionCount,
          error: scrapeResult.error || scrapeResult.errorMessage || null,
        };

        onAccountComplete?.({ account, index, total: totalAccounts, result: summary });

        log.info?.(
          `[Bulk Scrape] ${account.vendor} - status=${summary.status}, transactions=${transactionCount}`,
        );

        processedResults.push(summary);
      } catch (error) {
        log.error?.(`[Bulk Scrape] Error scraping ${account.vendor}:`, error);

        const failure = {
          vendor: account.vendor,
          nickname: account.nickname,
          success: false,
          status: error.code === 'credential_decrypt_failed' ? 'blocked' : 'failed',
          message: error.message || 'Unknown error',
          transactionCount: 0,
          reason: error.code || null,
          blocked: error.code === 'credential_decrypt_failed',
        };

        onAccountComplete?.({ account, index, total: totalAccounts, result: failure, error });

        processedResults.push(failure);
      }
    }

    const successCount = processedResults.filter((entry) => entry.success).length;
    const blockedCount = processedResults.filter((entry) => entry.blocked).length;
    const failureCount = processedResults.length - successCount - blockedCount;
    const unsuccessfulCount = failureCount + blockedCount;
    const totalTransactions = processedResults.reduce(
      (sum, entry) => sum + (entry.transactionCount || 0),
      0,
    );

    // Exit bulk mode and rebuild indexes/exclusions
    if (hasBulkMode) {
      log.info?.('[Bulk Scrape] Exiting bulk mode - rebuilding indexes and exclusions');
      pool.exitBulkMode();
      
      // Rebuild FTS index for any new transactions
      if (typeof pool.rebuildFtsIndex === 'function') {
        log.info?.('[Bulk Scrape] Rebuilding FTS search index');
        pool.rebuildFtsIndex();
      }
      
      // Rebuild pairing exclusions for new transactions
      if (typeof pool.rebuildPairingExclusions === 'function') {
        log.info?.('[Bulk Scrape] Rebuilding pairing exclusions');
        pool.rebuildPairingExclusions();
      }
    }

    log.info?.(
      `[Bulk Scrape] Completed: ${successCount} successful, ${failureCount} failed, ${blockedCount} blocked, ${totalTransactions} total transactions`,
    );

    const status = unsuccessfulCount === 0
      ? 'success'
      : successCount > 0
        ? 'partial'
        : blockedCount === processedResults.length
          ? 'blocked'
          : 'failed';
    const message = status === 'blocked'
      ? `Sync blocked: ${blockedCount} saved account${blockedCount === 1 ? '' : 's'} could not be decrypted. Re-enter those credentials before syncing.`
      : status === 'partial' && blockedCount > 0
        ? `Bulk sync partially completed: ${successCount}/${processedResults.length} accounts synced; ${blockedCount} require credential re-entry.`
        : `Bulk scrape completed: ${successCount}/${processedResults.length} accounts synced successfully`;

    return {
      success: status === 'success',
      status,
      message,
      totalProcessed: processedResults.length,
      successCount,
      failureCount,
      blockedCount,
      totalTransactions,
      results: processedResults,
    };
  } finally {
    // Ensure bulk mode is exited even on error
    const pool = databaseRef._pool || databaseRef;
    if (typeof pool.exitBulkMode === 'function' && typeof pool.isBulkModeActive === 'function' && pool.isBulkModeActive()) {
      pool.exitBulkMode();
      if (typeof pool.rebuildFtsIndex === 'function') {
        pool.rebuildFtsIndex();
      }
      if (typeof pool.rebuildPairingExclusions === 'function') {
        pool.rebuildPairingExclusions();
      }
    }
    
    if (client.release) {
      client.release();
    }
  }
}

module.exports = {
  bulkScrape,
  __setDatabaseForTests(overrides = null) {
    databaseRef = overrides ? { ...database, ...overrides } : database;
  },
  __setScrapingServiceForTests(overrides = null) {
    scrapingServiceRef = overrides ? { ...scrapingService, ...overrides } : scrapingService;
  },
};

module.exports.default = module.exports;
