const express = require('express');

const runScrapeService = require('../services/scraping/run.js');
const bulkScrapeService = require('../services/scraping/bulk.js');
const scrapeEventsService = require('../services/scraping/events.js');
const scrapeStatusService = require('../services/scraping/status.js');
const { wasScrapedRecently } = require('../services/scraping/run.js');
const { maybeRunAutoDetection } = require('../services/analytics/subscriptions.js');
const databaseService = require('../services/database.js');
const {
  SCRAPE_RATE_LIMIT_MS,
  SCRAPE_RATE_LIMIT_MAX_ATTEMPTS,
} = require('../../utils/constants.js');

let appLogger = null;
try {
  ({ logger: appLogger } = require('../../../electron/logger.js'));
} catch {
  appLogger = null;
}

function stringifyLogArg(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emitLog(level, prefix, args = []) {
  const normalizedLevel = level === 'log' ? 'info' : level;
  const consoleLevel = normalizedLevel === 'info' ? 'log' : normalizedLevel;
  if (typeof console[consoleLevel] === 'function') {
    console[consoleLevel](prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }

  if (appLogger && typeof appLogger[normalizedLevel] === 'function') {
    const message = args.map(stringifyLogArg).join(' ');
    appLogger[normalizedLevel](`${prefix}${message ? ` ${message}` : ''}`);
  }
}

function createLogger(vendor) {
  const prefix = vendor ? `[Scrape:${vendor}]` : '[Scrape]';
  return {
    log: (...args) => emitLog('info', prefix, args),
    info: (...args) => emitLog('info', prefix, args),
    warn: (...args) => emitLog('warn', prefix, args),
    error: (...args) => emitLog('error', prefix, args),
    debug: (...args) => emitLog('debug', prefix, args),
  };
}

const routeLogger = createLogger('router');

let CompanyTypes = {};
try {
  ({ CompanyTypes } = require('israeli-bank-scrapers'));
} catch (error) {
  routeLogger.warn('Failed to load CompanyTypes from israeli-bank-scrapers.', error);
}

async function resolveCredentialRateLimitDetails(
  credentialId,
  thresholdMs = SCRAPE_RATE_LIMIT_MS,
  maxAttempts = SCRAPE_RATE_LIMIT_MAX_ATTEMPTS,
) {
  if (!credentialId) return null;

  const safeThresholdMs = Number.isFinite(thresholdMs) && thresholdMs > 0
    ? thresholdMs
    : SCRAPE_RATE_LIMIT_MS;
  const safeMaxAttempts = Number.isFinite(maxAttempts) && maxAttempts > 0
    ? Math.floor(maxAttempts)
    : SCRAPE_RATE_LIMIT_MAX_ATTEMPTS;

  let client = null;
  try {
    client = await databaseService.getClient();
    const windowStartIso = new Date(Date.now() - safeThresholdMs).toISOString();
    const attemptsResult = await client.query(
      `SELECT created_at
         FROM scrape_events
        WHERE credential_id = $1
          AND created_at >= $2
        ORDER BY created_at ASC`,
      [credentialId, windowStartIso],
    );
    const attempts = Array.isArray(attemptsResult?.rows)
      ? attemptsResult.rows
        .map((row) => new Date(row.created_at))
        .filter((date) => !Number.isNaN(date.getTime()))
      : [];

    if (attempts.length > 0) {
      const oldestAttempt = attempts[0];
      const latestAttempt = attempts[attempts.length - 1];
      const nextAllowedAtMs = oldestAttempt.getTime() + safeThresholdMs;
      const retryAfter = Math.max(0, Math.ceil((nextAllowedAtMs - Date.now()) / 1000));
      const remaining = Math.max(0, safeMaxAttempts - attempts.length);

      return {
        retryAfter,
        lastAttemptAt: latestAttempt.toISOString(),
        nextAllowedAt: new Date(nextAllowedAtMs).toISOString(),
        attemptCount: attempts.length,
        maxAttempts: safeMaxAttempts,
        remaining,
      };
    }

    const fallbackResult = await client.query(
      'SELECT last_scrape_attempt FROM vendor_credentials WHERE id = $1',
      [credentialId],
    );
    const lastAttemptRaw = fallbackResult?.rows?.[0]?.last_scrape_attempt;
    if (!lastAttemptRaw) return null;

    const lastAttempt = new Date(lastAttemptRaw);
    if (Number.isNaN(lastAttempt.getTime())) return null;

    const nextAllowedAtMs = lastAttempt.getTime() + safeThresholdMs;
    const retryAfter = Math.max(0, Math.ceil((nextAllowedAtMs - Date.now()) / 1000));

    return {
      retryAfter,
      lastAttemptAt: lastAttempt.toISOString(),
      nextAllowedAt: new Date(nextAllowedAtMs).toISOString(),
      attemptCount: 1,
      maxAttempts: safeMaxAttempts,
      remaining: Math.max(0, safeMaxAttempts - 1),
    };
  } catch {
    return null;
  } finally {
    try {
      client?.release();
    } catch {
      // Ignore client release failures in best-effort metadata lookup.
    }
  }
}

function resolveRateLimitMetadata(res) {
  if (!res || typeof res.get !== 'function') {
    return null;
  }

  const limitRaw = res.get('X-RateLimit-Limit');
  const remainingRaw = res.get('X-RateLimit-Remaining');
  const resetRaw = res.get('X-RateLimit-Reset');

  const limit = typeof limitRaw === 'string' ? Number.parseInt(limitRaw, 10) : NaN;
  const remaining = typeof remainingRaw === 'string' ? Number.parseInt(remainingRaw, 10) : NaN;
  const resetAt = typeof resetRaw === 'string' && resetRaw.trim().length > 0
    ? resetRaw
    : null;

  const metadata = {};
  if (Number.isFinite(limit)) metadata.limit = limit;
  if (Number.isFinite(remaining)) metadata.remaining = remaining;
  if (resetAt) metadata.resetAt = resetAt;

  return Object.keys(metadata).length > 0 ? metadata : null;
}

function createScrapingRouter({ mainWindow, onProgress, services = {} } = {}) {
  const {
    runScrape: runScrapeFn = runScrapeService.runScrape,
    bulkScrape: bulkScrapeFn = bulkScrapeService.bulkScrape,
    listScrapeEvents: listScrapeEventsFn = scrapeEventsService.listScrapeEvents,
    getScrapeStatusById: getScrapeStatusByIdFn = scrapeStatusService.getScrapeStatusById,
    wasScrapedRecently: wasScrapedRecentlyFn = wasScrapedRecently,
  } = services;

  const router = express.Router();

  const sendProgress = (payload) => {
    if (typeof onProgress === 'function') {
      onProgress(payload);
    }

    if (mainWindow?.webContents?.send) {
      try {
        mainWindow.webContents.send('scrape:progress', payload);
      } catch (error) {
        routeLogger.error('Failed to emit progress to renderer', error);
      }
    }
  };

  router.post('/scrape', async (req, res) => {
    try {
      const { options, credentials } = req.body || {};
      const vendor = options?.companyId;
      const fromSavedCredential =
        credentials?.fromSavedCredential === true ||
        String(credentials?.fromSavedCredential || '').toLowerCase() === 'true';

      if (!vendor || !credentials) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: companyId or credentials',
        });
      }

      sendProgress({
        vendor,
        status: 'starting',
        progress: 5,
        message: 'Preparing scraper...',
      });

      const logger = createLogger(vendor);

      // Try to look up the credential ID from the database for scrape event tracking
      let dbId = credentials?.dbId ?? null;
      if (!dbId) {
        try {
          const credentialsService = require('../services/credentials.js');
          const dbCredentials = await credentialsService.listCredentials({ vendor });

          if (Array.isArray(dbCredentials) && dbCredentials.length > 0) {
            const nickname = credentials?.nickname ? String(credentials.nickname) : null;
            const username = credentials?.username ? String(credentials.username) : null;
            const idNumber = credentials?.id
              ? String(credentials.id)
              : (credentials?.id_number ? String(credentials.id_number) : null);

            const match =
              (nickname
                ? dbCredentials.find((entry) => entry?.nickname === nickname)
                : null) ||
              (username
                ? dbCredentials.find(
                    (entry) =>
                      entry?.username &&
                      String(entry.username).toLowerCase() === username.toLowerCase(),
                  )
                : null) ||
              (idNumber
                ? dbCredentials.find(
                    (entry) => entry?.id_number && String(entry.id_number) === idNumber,
                  )
                : null);

            if (match?.id) {
              dbId = match.id;
            } else if (dbCredentials.length === 1) {
              dbId = dbCredentials[0].id;
            }
          }
        } catch (lookupError) {
          logger.warn?.('Failed to lookup credential ID, scrape will proceed without it:', lookupError);
        }
      }

      if (fromSavedCredential && !dbId) {
        sendProgress({
          vendor,
          status: 'failed',
          progress: 100,
          message: 'Saved account was not found. Please re-add this account before syncing.',
          error: 'credential_not_found',
        });

        return res.status(409).json({
          success: false,
          message: 'Saved account was not found. Please re-add this account before syncing.',
          reason: 'credential_not_found',
        });
      }

      // Check rate limit (skip if force override is enabled)
      const forceOverride = options?.force === true;
      if (dbId && !forceOverride) {
        const isRateLimited = await wasScrapedRecentlyFn(dbId);
        if (isRateLimited) {
          const fallbackRetryAfter = Math.ceil(SCRAPE_RATE_LIMIT_MS / 1000);
          const details = await resolveCredentialRateLimitDetails(dbId);
          const retryAfter = Number.isFinite(details?.retryAfter) ? details.retryAfter : fallbackRetryAfter;
          const accountRateLimit = {
            limit: SCRAPE_RATE_LIMIT_MAX_ATTEMPTS,
            remaining: Number.isFinite(details?.remaining) ? details.remaining : 0,
            resetAt: details?.nextAllowedAt || null,
          };
          res.set('Retry-After', String(retryAfter));
          sendProgress({
            vendor,
            status: 'failed',
            progress: 100,
            message: `Sync blocked by cooldown. Try again in ${retryAfter} seconds.`,
            error: 'account_recently_scraped',
          });

          return res.status(429).json({
            success: false,
            message: 'This account was synced recently. To avoid duplicate imports and temporary bank login lockouts, another sync is blocked for a short cooldown window.',
            reason: 'account_recently_scraped',
            rateLimited: true,
            retryAfter,
            nextAllowedAt: details?.nextAllowedAt || null,
            lastAttemptAt: details?.lastAttemptAt || null,
            rateLimit: {
              ...(resolveRateLimitMetadata(res) || {}),
              ...accountRateLimit,
            },
          });
        }
      }

      if (forceOverride) {
        logger.warn?.('Force override used - bypassing rate limit. Use with caution!');
      }

      const result = await runScrapeFn({
        options,
        credentials: { ...credentials, dbId },
        logger,
      });

      const transactionCount = Array.isArray(result.accounts)
        ? result.accounts.reduce(
            (sum, account) =>
              sum + (Array.isArray(account.txns) ? account.txns.length : 0),
            0,
          )
        : 0;

      sendProgress({
        vendor,
        status: 'completed',
        progress: 100,
        message: `Scraping completed (${transactionCount} transactions)`,
        transactions: transactionCount,
      });

      maybeRunAutoDetection({ locale: req.locale, defaultStatus: 'review' })
        .catch((detectError) => {
          logger.warn?.('Auto-detection failed:', detectError?.message || detectError);
        });

      res.status(200).json({
        ...result,
        transactionCount,
        rateLimit: resolveRateLimitMetadata(res),
      });
    } catch (error) {
      routeLogger.error('Scrape API error:', error);
      const vendor = req.body?.options?.companyId;

      if (vendor) {
        sendProgress({
          vendor,
          status: 'failed',
          progress: 100,
          message: error?.message || 'Scraping failed',
          error: error?.message,
        });
      }

      const statusCode = error?.status || 500;
      res.status(statusCode).json({
        success: false,
        message: error?.message || 'Internal server error',
        errorType: error?.errorType,
        error: error?.payload || error?.message,
        rateLimit: resolveRateLimitMetadata(res),
      });
    }
  });

  router.post('/scrape/bulk', async (req, res) => {
    try {
      sendProgress({
        vendor: 'bulk',
        status: 'starting',
        progress: 0,
        message: 'Bulk scrape initiated',
      });

      const result = await bulkScrapeFn({
        logger: createLogger('bulk'),
        createLogger: (vendor) => createLogger(`bulk:${vendor}`),
        onAccountStart: ({ account, index, total }) => {
          sendProgress({
            vendor: account.vendor,
            status: 'starting',
            progress: Math.round((index / Math.max(total, 1)) * 100),
            message: `Scraping ${account.vendor} (${index + 1}/${total})`,
          });
        },
        onAccountComplete: ({ account, index, total, result: summary }) => {
          sendProgress({
            vendor: account.vendor,
            status: summary.success ? 'completed' : 'failed',
            progress: Math.round(((index + 1) / Math.max(total, 1)) * 100),
            message: summary.message,
            transactions: summary.transactionCount,
          });
        },
      });

      sendProgress({
        vendor: 'bulk',
        status: 'completed',
        progress: 100,
        message: result.message,
        totals: {
          success: result.successCount,
          failure: result.failureCount,
          transactions: result.totalTransactions,
        },
      });

      maybeRunAutoDetection({ locale: req.locale, defaultStatus: 'review' })
        .catch((detectError) => {
          routeLogger.warn('Auto-detection failed:', detectError?.message || detectError);
        });

      res.status(200).json(result);
    } catch (error) {
      routeLogger.error('Bulk scrape API error:', error);
      sendProgress({
        vendor: 'bulk',
        status: 'failed',
        progress: 100,
        message: error?.message || 'Bulk scrape failed',
      });
      res.status(500).json({
        success: false,
        message: 'Bulk scrape failed',
        error: error?.message || 'Unknown error',
      });
    }
  });

  router.get('/scrape_events', async (req, res) => {
    try {
      const events = await listScrapeEventsFn(req.query || {});
      res.status(200).json({
        success: true,
        events,
      });
    } catch (error) {
      routeLogger.error('Get scrape events error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch scrape events',
        error: error?.message,
      });
    }
  });

  router.get('/scrape/status/:id', async (req, res) => {
    try {
      const event = await getScrapeStatusByIdFn(req.params?.id);
      res.status(200).json({
        success: true,
        event,
      });
    } catch (error) {
      routeLogger.error('Get scrape status error:', error);
      res.status(error?.status || 500).json({
        success: false,
        message: error?.message || 'Failed to fetch scrape status',
      });
    }
  });

  router.post('/scrape/test', async (req, res) => {
    try {
      const { companyId } = req.body || {};
      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: 'Company ID is required',
        });
      }

      const companyType = CompanyTypes?.[companyId];
      if (!companyType) {
        return res.status(400).json({
          success: false,
          message: `Invalid company ID: ${companyId}`,
        });
      }

      res.status(200).json({
        success: true,
        message: 'Scraper configuration is valid',
        companyId,
        companyType,
        isSupported: true,
      });
    } catch (error) {
      routeLogger.error('Test scraper error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to test scraper configuration',
        error: error?.message,
      });
    }
  });

  return router;
}

module.exports = { createScrapingRouter };
