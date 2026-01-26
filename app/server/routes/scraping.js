const express = require('express');

const runScrapeService = require('../services/scraping/run.js');
const bulkScrapeService = require('../services/scraping/bulk.js');
const scrapeEventsService = require('../services/scraping/events.js');
const scrapeStatusService = require('../services/scraping/status.js');
const { wasScrapedRecently } = require('../services/scraping/run.js');

let CompanyTypes = {};
try {
  ({ CompanyTypes } = require('israeli-bank-scrapers'));
} catch (error) {
  console.warn('[ScrapingRouter] Failed to load CompanyTypes from israeli-bank-scrapers.', error);
}

function createLogger(vendor) {
  const prefix = vendor ? `[Scrape:${vendor}]` : '[Scrape]';
  return {
    log: (...args) => console.log(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

function createScrapingRouter({ mainWindow, onProgress, services = {} } = {}) {
  const {
    runScrape: runScrapeFn = runScrapeService.runScrape,
    bulkScrape: bulkScrapeFn = bulkScrapeService.bulkScrape,
    listScrapeEvents: listScrapeEventsFn = scrapeEventsService.listScrapeEvents,
    getScrapeStatusById: getScrapeStatusByIdFn = scrapeStatusService.getScrapeStatusById,
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
        console.error('[Scrape] Failed to emit progress to renderer', error);
      }
    }
  };

  router.post('/scrape', async (req, res) => {
    try {
      const { options, credentials } = req.body || {};
      const vendor = options?.companyId;

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

      // Check rate limit (skip if force override is enabled)
      const forceOverride = options?.force === true;
      if (dbId && !forceOverride) {
        const isRateLimited = await wasScrapedRecently(dbId);
        if (isRateLimited) {
          return res.status(429).json({
            success: false,
            message: 'This account was already scraped in the last 24 hours. Please wait before trying again.',
            rateLimited: true,
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

      res.status(200).json({
        ...result,
        transactionCount,
      });
    } catch (error) {
      console.error('Scrape API error:', error);
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

      res.status(200).json({
        success: false,
        message: error?.message || 'Internal server error',
        errorType: error?.errorType,
        error: error?.payload || error?.stack || error?.message,
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

      res.status(200).json(result);
    } catch (error) {
      console.error('[Bulk Scrape] API error:', error);
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
      console.error('Get scrape events error:', error);
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
      console.error('Get scrape status error:', error);
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
      console.error('Test scraper error:', error);
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
