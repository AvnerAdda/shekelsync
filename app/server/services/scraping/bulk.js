const database = require('../database.js');
const { decrypt } = require('../../../lib/server/encryption.js');
const { STALE_SYNC_THRESHOLD_MS } = require('../../../utils/constants.js');
const scrapingService = require('./run.js');
const accountsService = require('../accounts/last-transaction-date.js');

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
    logger = console,
    onAccountStart,
    onAccountComplete,
    createLogger,
  } = options;

  const log = toLogger(logger);
  const client = await database.getClient();

  try {
    const thresholdDate = new Date(Date.now() - thresholdMs);

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
          COALESCE(last_scrapes.last_successful_scrape, vc.created_at) AS last_update
        FROM vendor_credentials vc
        LEFT JOIN (
          SELECT 
            vendor,
            MAX(CASE WHEN status = 'success' THEN created_at ELSE NULL END) AS last_successful_scrape
          FROM scrape_events
          GROUP BY vendor
        ) last_scrapes ON vc.vendor = last_scrapes.vendor
        WHERE COALESCE(last_scrapes.last_successful_scrape, vc.created_at) < $1
        ORDER BY last_update ASC
      `,
      [thresholdDate],
    );

    const staleAccounts = staleAccountsResult.rows;

    if (staleAccounts.length === 0) {
      return {
        success: true,
        message: 'All accounts are up to date',
        totalProcessed: 0,
        successCount: 0,
        failureCount: 0,
        totalTransactions: 0,
        results: [],
      };
    }

    log.info?.(`[Bulk Scrape] Found ${staleAccounts.length} accounts needing sync`);

    const totalAccounts = staleAccounts.length;

    // Process accounts sequentially to avoid SQLite transaction conflicts
    // SQLite doesn't support concurrent transactions on the same connection
    const processedResults = [];

    for (let index = 0; index < staleAccounts.length; index++) {
      const account = staleAccounts[index];
      onAccountStart?.({ account, index, total: totalAccounts });

      try {
        const decryptedCredentials = {
          dbId: account.id, // Database row ID for scrape event tracking
          id: account.id_number ? decrypt(account.id_number) : null,
          card6Digits: account.card6_digits ? decrypt(account.card6_digits) : null,
          password: account.password ? decrypt(account.password) : null,
          username: account.username ? decrypt(account.username) : null,
          bankAccountNumber: account.bank_account_number || null,
          identification_code: account.identification_code ? decrypt(account.identification_code) : null,
          nickname: account.nickname,
          institution_id: account.institution_id,
          vendor: account.vendor,
        };

        let startDate;
        try {
          const lookup = await accountsService.getLastTransactionDate({ vendor: account.vendor });
          startDate = new Date(lookup.lastTransactionDate);
        } catch (lookupError) {
          log.warn?.(
            `[Bulk Scrape] Failed to resolve last transaction date for ${account.vendor}: ${lookupError.message}`,
          );
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);
        }

        const scrapeOptions = {
          companyId: account.vendor,
          startDate,
          combineInstallments: false,
          showBrowser: true,
          additionalTransactionInformation: true,
        };

        log.info?.(`[Bulk Scrape] Starting scrape for ${account.vendor} (${account.nickname})`);

        const accountLogger = typeof createLogger === 'function' ? createLogger(account.vendor) : logger;

        const scrapeResult = await scrapingService.runScrape({
          options: scrapeOptions,
          credentials: decryptedCredentials,
          logger: accountLogger,
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
          status: 'failed',
          message: error.message || 'Unknown error',
          transactionCount: 0,
        };

        onAccountComplete?.({ account, index, total: totalAccounts, result: failure, error });

        processedResults.push(failure);
      }
    }

    const successCount = processedResults.filter((entry) => entry.success).length;
    const failureCount = processedResults.length - successCount;
    const totalTransactions = processedResults.reduce(
      (sum, entry) => sum + (entry.transactionCount || 0),
      0,
    );

    log.info?.(
      `[Bulk Scrape] Completed: ${successCount} successful, ${failureCount} failed, ${totalTransactions} total transactions`,
    );

    return {
      success: true,
      message: `Bulk scrape completed: ${successCount}/${processedResults.length} accounts synced successfully`,
      totalProcessed: processedResults.length,
      successCount,
      failureCount,
      totalTransactions,
      results: processedResults,
    };
  } finally {
    if (client.release) {
      client.release();
    }
  }
}

module.exports = {
  bulkScrape,
};

module.exports.default = module.exports;
