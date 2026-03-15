const express = require('express');

// Dynamic imports for ES modules
let suggestionAnalyzer;
let autoLinker;
const {
  buildPikadonCandidate,
  transactionLooksLikePikadonDeposit,
} = require('../services/investments/pikadon-candidates.js');

function normalizePikadonDetails(details) {
  if (!details || typeof details !== 'object') {
    return null;
  }

  const maturityDate = typeof details.maturity_date === 'string'
    ? details.maturity_date.trim()
    : '';
  const interestRate =
    details.interest_rate === undefined || details.interest_rate === null || details.interest_rate === ''
      ? null
      : Number(details.interest_rate);

  return {
    maturity_date: maturityDate || null,
    interest_rate: Number.isFinite(interestRate) ? interestRate : null,
    notes: typeof details.notes === 'string' ? details.notes.trim() : null,
  };
}

async function syncLinkedPikadonHolding({
  pool,
  pikadonService,
  accountId,
  transactionIdentifier,
  transactionVendor,
  transaction,
  pikadonCandidate,
  existingHolding,
  pikadonDetails,
  dbAdapter,
}) {
  const candidate = pikadonCandidate || buildPikadonCandidate({
    accountId,
    transactionIdentifier,
    transactionVendor,
    transaction,
  });
  if (!candidate) {
    return null;
  }

  const linkedPikadon = existingHolding
    || await pikadonService.findLinkedPikadonByDepositTransaction?.(
      transactionIdentifier,
      transactionVendor,
      dbAdapter,
    )
    || null;
  if (linkedPikadon) {
    if (Number(linkedPikadon.account_id) !== Number(accountId)) {
      await pool.query(
        `
          UPDATE investment_holdings
          SET account_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `,
        [accountId, linkedPikadon.id],
      );
    }

    let updatedPikadon = linkedPikadon;
    if (pikadonDetails) {
      updatedPikadon = (
        await pikadonService.updatePikadon(linkedPikadon.id, pikadonDetails, dbAdapter)
      ).pikadon;
    }

    await pool.query(
      'UPDATE transactions SET is_pikadon_related = 1 WHERE identifier = $1 AND vendor = $2',
      [transactionIdentifier, transactionVendor],
    );

    return {
      pikadon: {
        ...updatedPikadon,
        account_id: Number(accountId),
      },
      synced: true,
    };
  }

  const created = await pikadonService.createPikadon(
    {
      account_id: Number(accountId),
      cost_basis: candidate.principal,
      as_of_date: candidate.deposit_date,
      maturity_date: pikadonDetails?.maturity_date,
      deposit_transaction_id: transactionIdentifier,
      deposit_transaction_vendor: transactionVendor,
      interest_rate: pikadonDetails?.interest_rate ?? null,
      notes: pikadonDetails?.notes || 'Linked from pikadon transaction',
    },
    dbAdapter,
  );

  await pool.query(
    'UPDATE transactions SET is_pikadon_related = 1 WHERE identifier = $1 AND vendor = $2',
    [transactionIdentifier, transactionVendor],
  );

  return created;
}

async function findExistingLinkedPikadon(
  pikadonService,
  transactionIdentifier,
  transactionVendor,
  dbAdapter,
) {
  if (typeof pikadonService?.findLinkedPikadonByDepositTransaction !== 'function') {
    return null;
  }

  return pikadonService.findLinkedPikadonByDepositTransaction(
    transactionIdentifier,
    transactionVendor,
    dbAdapter,
  );
}

function pikadonNeedsSetup(existingHolding, pikadonDetails) {
  if (pikadonDetails?.maturity_date) {
    return false;
  }

  return !existingHolding?.maturity_date;
}

function buildPikadonRequirementResponse(candidate) {
  return {
    error: 'pikadon_details_required',
    pikadonCandidate: candidate,
  };
}

async function getQueryClient(databaseService) {
  if (typeof databaseService?.getClient === 'function') {
    return databaseService.getClient();
  }

  return {
    query: (...args) => databaseService.query(...args),
    release: () => {},
  };
}

async function loadESModules() {
  if (!suggestionAnalyzer) {
    suggestionAnalyzer = await import('../services/investments/suggestion-analyzer.js');
  }
  if (!autoLinker) {
    autoLinker = await import('../services/investments/auto-linker.js');
  }
}

function __setESModulesForTests(modules = {}) {
  if (modules.suggestionAnalyzer) {
    suggestionAnalyzer = modules.suggestionAnalyzer;
  }
  if (modules.autoLinker) {
    autoLinker = modules.autoLinker;
  }
}

function __resetESModulesForTests() {
  suggestionAnalyzer = null;
  autoLinker = null;
}

function createInvestmentsRouter({ services = {} } = {}) {
  const checkExistingService = services.checkExistingService || require('../services/investments/check-existing.js');
  const historyService = services.historyService || require('../services/investments/history.js');
  const performanceService = services.performanceService || require('../services/investments/performance.js');
  const patternsService = services.patternsService || require('../services/investments/patterns.js');
  const pendingSuggestionsService = services.pendingSuggestionsService || require('../services/investments/pending-suggestions.js');
  const costBasisService = services.costBasisService || require('../services/investments/suggest-cost-basis.js');
  const accountsService = services.accountsService || require('../services/investments/accounts.js');
  const assetsService = services.assetsService || require('../services/investments/assets.js');
  const holdingsService = services.holdingsService || require('../services/investments/holdings.js');
  const summaryService = services.summaryService || require('../services/investments/summary.js');
  const balanceSheetService = services.balanceSheetService || require('../services/investments/balance-sheet.js');
  const positionsService = services.positionsService || require('../services/investments/positions.js');
  const bankSummaryService = services.bankSummaryService || require('../services/investments/bank-summary.js');
  const suggestionAnalyzerCJS = services.suggestionAnalyzerCJS || require('../services/investments/suggestion-analyzer-cjs.js');
  const pikadonService = services.pikadonService || require('../services/investments/pikadon.js');
  const databaseService = services.databaseService || require('../services/database.js');

  const router = express.Router();

  router.get('/check-existing', async (req, res) => {
    try {
      const result = await checkExistingService.getExistingInvestments(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments check-existing error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch investment overview',
        details: error?.payload || error?.stack,
      });
    }
  });

  router.get('/history', async (req, res) => {
    try {
      const result = await historyService.getInvestmentHistory(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments history error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch investment history',
        details: error?.payload || error?.stack,
      });
    }
  });

  router.get('/performance', async (req, res) => {
    try {
      const result = await performanceService.getInvestmentPerformance(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments performance error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch investment performance',
        details: error?.stack,
      });
    }
  });

  router.get('/patterns', async (req, res) => {
    try {
      const result = await patternsService.listPatterns(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments patterns list error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch investment patterns',
        details: error?.payload || error?.stack,
      });
    }
  });

  router.post('/patterns', async (req, res) => {
    try {
      const result = await patternsService.createPattern(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Investments pattern create error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to create investment pattern',
        details: error?.payload || error?.stack,
      });
    }
  });

  router.delete('/patterns', async (req, res) => {
    try {
      const result = await patternsService.removePattern(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments pattern delete error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to delete investment pattern',
        details: error?.payload || error?.stack,
      });
    }
  });

  router.get('/pending-suggestions', async (req, res) => {
    try {
      const result = await pendingSuggestionsService.listPendingSuggestions(req.query || {});
      res.json({
        success: true,
        pending_suggestions: result.pendingSuggestions,
        total: result.total,
      });
    } catch (error) {
      console.error('Investments pending suggestions list error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to fetch pending suggestions',
        details: error?.stack,
      });
    }
  });

  router.post('/pending-suggestions', async (req, res) => {
    try {
      const result = await pendingSuggestionsService.applySuggestionAction(req.body || {});
      res.json({
        success: true,
        action: result.action,
        message: result.message,
        link_created: result.linkCreated || null,
      });
    } catch (error) {
      console.error('Investments pending suggestion update error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to update suggestion',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/smart-suggestions
   * NEW: Working CommonJS version that analyzes unlinked transactions
   * Query params: thresholdDays (default: 90)
   */
  router.get('/smart-suggestions', async (req, res) => {
    try {
      const { thresholdDays = 90 } = req.query;

      const suggestions = await suggestionAnalyzerCJS.analyzeInvestmentTransactions(parseInt(thresholdDays, 10));

      res.json({
        success: true,
        count: suggestions.length,
        suggestions: suggestions
      });
    } catch (error) {
      console.error('Smart suggestions error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to analyze transactions',
        details: error?.stack,
      });
    }
  });

  router.get('/suggest-cost-basis', async (req, res) => {
    try {
      const result = await costBasisService.suggestCostBasis(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments suggest cost basis error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to suggest cost basis',
        details: error?.stack,
      });
    }
  });

  router.get('/accounts', async (req, res) => {
    try {
      const result = await accountsService.listAccounts(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments accounts list error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch investment accounts',
        details: error?.stack,
      });
    }
  });

  router.post('/accounts', async (req, res) => {
    try {
      const result = await accountsService.createAccount(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Investments account create error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to create investment account',
        details: error?.stack,
      });
    }
  });

  router.put('/accounts', async (req, res) => {
    try {
      const result = await accountsService.updateAccount(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Investments account update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update investment account',
        details: error?.stack,
      });
    }
  });

  router.delete('/accounts', async (req, res) => {
    try {
      const result = await accountsService.deactivateAccount(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments account delete error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to deactivate investment account',
        details: error?.stack,
      });
    }
  });

  router.get('/assets', async (req, res) => {
    try {
      const result = await assetsService.listAssets(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments assets list error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch investment assets',
        details: error?.stack,
      });
    }
  });

  router.post('/assets', async (req, res) => {
    try {
      const result = await assetsService.createAsset(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Investments asset create error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to create investment asset',
        details: error?.stack,
      });
    }
  });

  router.put('/assets', async (req, res) => {
    try {
      const result = await assetsService.updateAsset(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Investments asset update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update investment asset',
        details: error?.stack,
      });
    }
  });

  router.delete('/assets', async (req, res) => {
    try {
      const result = await assetsService.deactivateAsset(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments asset delete error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to deactivate investment asset',
        details: error?.stack,
      });
    }
  });

  router.get('/holdings', async (req, res) => {
    try {
      const result = await holdingsService.listHoldings(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments holdings list error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch investment holdings',
        details: error?.stack,
      });
    }
  });

  router.post('/holdings', async (req, res) => {
    try {
      const result = await holdingsService.upsertHolding(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Investments holding upsert error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to upsert investment holding',
        details: error?.stack,
      });
    }
  });

  router.delete('/holdings', async (req, res) => {
    try {
      const result = await holdingsService.deleteHolding(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments holding delete error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to delete investment holding',
        details: error?.stack,
      });
    }
  });

  router.get('/summary', async (req, res) => {
    try {
      const result = await summaryService.getInvestmentSummary(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments summary error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch investment summary',
        details: error?.stack,
      });
    }
  });

  router.get('/balance-sheet', async (req, res) => {
    try {
      const result = await balanceSheetService.getInvestmentBalanceSheet(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments balance sheet error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch investment balance sheet',
        details: error?.stack,
      });
    }
  });

  router.get('/positions', async (req, res) => {
    try {
      const result = await positionsService.listPositions(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Investments positions list error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch investment positions',
        details: error?.stack,
      });
    }
  });

  router.post('/position-events', async (req, res) => {
    try {
      const result = await positionsService.createPositionEvent(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Investments position-event create error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to create investment position event',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/bank-summary
   * Get comprehensive bank balance summary with historical data
   * Query params: startDate, endDate, months (default: 3), aggregation (daily/weekly/monthly)
   */
  router.get('/bank-summary', async (req, res) => {
    try {
      const result = await bankSummaryService.getBankBalanceSummary(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Bank balance summary error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to fetch bank balance summary',
        details: error?.stack,
      });
    }
  });

  // New intelligent suggestion endpoints

  /**
   * POST /api/investments/analyze-transactions
   * Analyzes uncategorized investment transactions and returns smart account suggestions
   * Query params: thresholdDays (default: 90)
   */
  router.post('/analyze-transactions', async (req, res) => {
    try {
      await loadESModules();
      const { thresholdDays = 90 } = req.body;
      const suggestions = await suggestionAnalyzer.analyzeInvestmentTransactions(thresholdDays);

      res.json({
        success: true,
        count: suggestions.length,
        suggestions
      });
    } catch (error) {
      console.error('Investments analyze-transactions error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to analyze investment transactions',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/suggestions/pending
   * Returns active account suggestions above dismissal threshold
   * Query params: thresholdDays (default: 90), dismissalThreshold (default: 3)
   */
  router.get('/suggestions/pending', async (req, res) => {
    try {
      console.log('[Suggestions API] Loading ES modules...');
      await loadESModules();
      console.log('[Suggestions API] ES modules loaded successfully');

      const { thresholdDays = 90, dismissalThreshold = 3 } = req.query;
      console.log('[Suggestions API] Query params:', { thresholdDays, dismissalThreshold });

      // Get all suggestions
      console.log('[Suggestions API] Analyzing investment transactions...');
      const allSuggestions = await suggestionAnalyzer.analyzeInvestmentTransactions(parseInt(thresholdDays));
      console.log('[Suggestions API] Found', allSuggestions.length, 'suggestions');

      // Filter based on dismissal threshold
      // Note: This would require fetching existing pending_transaction_suggestions to check dismiss_count
      // For now, return all suggestions (can be enhanced with dismissal tracking)

      res.json({
        success: true,
        count: allSuggestions.length,
        suggestions: allSuggestions,
        threshold: parseInt(dismissalThreshold)
      });
    } catch (error) {
      console.error('[Suggestions API] Error:', error);
      console.error('[Suggestions API] Stack:', error?.stack);
      res.status(error?.statusCode || 500).json({
        success: false,
        error: error?.message || 'Failed to fetch pending suggestions',
        details: error?.stack,
      });
    }
  });

  /**
   * POST /api/investments/suggestions/dismiss
   * Marks a suggestion as dismissed and increments dismiss counter
   * Body: { transactionIdentifiers: [{identifier, vendor}] }
   */
  router.post('/suggestions/dismiss', async (req, res) => {
    try {
      const { transactionIdentifiers } = req.body;

      if (!transactionIdentifiers || !Array.isArray(transactionIdentifiers)) {
        return res.status(400).json({
          error: 'transactionIdentifiers array is required'
        });
      }

      const pool = databaseService;

      let dismissedCount = 0;

      for (const { identifier, vendor } of transactionIdentifiers) {
        const query = `
          INSERT INTO pending_transaction_suggestions (
            transaction_identifier,
            transaction_vendor,
            status,
            dismiss_count,
            last_dismissed_at
          )
          VALUES ($1, $2, 'dismissed', 1, CURRENT_TIMESTAMP)
          ON CONFLICT(transaction_identifier, transaction_vendor) DO UPDATE SET
            dismiss_count = dismiss_count + 1,
            last_dismissed_at = CURRENT_TIMESTAMP,
            status = 'dismissed'
        `;

        await pool.query(query, [identifier, vendor]);
        dismissedCount++;
      }

      res.json({
        success: true,
        dismissedCount,
        message: `Dismissed ${dismissedCount} suggestion(s)`
      });
    } catch (error) {
      console.error('Investments dismiss suggestion error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to dismiss suggestions',
        details: error?.stack,
      });
    }
  });

  /**
   * POST /api/investments/transaction-links
   * Links a single transaction to an investment account
   * Body: {
   *   transaction_identifier: string,
   *   transaction_vendor: string,
   *   account_id: number,
   *   link_method: string (optional, default: 'manual'),
   *   confidence: number (optional, default: 1.0)
   * }
   */
  router.post('/transaction-links', async (req, res) => {
    try {
      const {
        transaction_identifier,
        transaction_vendor,
        account_id,
        link_method = 'manual',
        confidence = 1.0,
        pikadon_details,
      } = req.body;

      if (!transaction_identifier || !transaction_vendor || !account_id) {
        return res.status(400).json({
          error: 'transaction_identifier, transaction_vendor, and account_id are required'
        });
      }

      const client = await getQueryClient(databaseService);
      let transactionComplete = false;

      try {
        await client.query('BEGIN');

        // First, get the transaction details so we can sync pikadon holdings when relevant.
        const txnQuery = `
          SELECT date, name, memo, price
          FROM transactions
          WHERE identifier = $1 AND vendor = $2
          LIMIT 1
        `;
        const txnResult = await client.query(txnQuery, [transaction_identifier, transaction_vendor]);

        if (!txnResult.rows || txnResult.rows.length === 0) {
          await client.query('ROLLBACK');
          transactionComplete = true;
          return res.status(404).json({
            error: 'Transaction not found',
            transaction_identifier,
            transaction_vendor
          });
        }

        const transaction = txnResult.rows[0];
        const transactionDate = transaction.date;
        const normalizedPikadonDetails = normalizePikadonDetails(pikadon_details);
        const pikadonCandidate = buildPikadonCandidate({
          accountId: account_id,
          transactionIdentifier: transaction_identifier,
          transactionVendor: transaction_vendor,
          transaction,
        });
        const existingPikadon = pikadonCandidate
          ? await findExistingLinkedPikadon(
            pikadonService,
            transaction_identifier,
            transaction_vendor,
            client,
          )
          : null;

        if (pikadonCandidate && pikadonNeedsSetup(existingPikadon, normalizedPikadonDetails)) {
          await client.query('ROLLBACK');
          transactionComplete = true;
          return res.status(422).json(buildPikadonRequirementResponse(pikadonCandidate));
        }

        const insertQuery = `
          INSERT INTO transaction_account_links (
            transaction_identifier,
            transaction_vendor,
            transaction_date,
            account_id,
            link_method,
            confidence,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'user')
          ON CONFLICT(transaction_identifier, transaction_vendor) DO UPDATE SET
            account_id = excluded.account_id,
            link_method = excluded.link_method,
            confidence = excluded.confidence,
            created_at = CURRENT_TIMESTAMP
        `;

        await client.query(insertQuery, [
          transaction_identifier,
          transaction_vendor,
          transactionDate,
          account_id,
          link_method,
          confidence
        ]);

        const pikadonSync = await syncLinkedPikadonHolding({
          pool: client,
          pikadonService,
          accountId: account_id,
          transactionIdentifier: transaction_identifier,
          transactionVendor: transaction_vendor,
          transaction,
          pikadonCandidate,
          existingHolding: existingPikadon,
          pikadonDetails: normalizedPikadonDetails,
          dbAdapter: client,
        });

        await client.query('COMMIT');
        transactionComplete = true;

        res.status(201).json({
          success: true,
          message: 'Transaction linked successfully',
          link: {
            transaction_identifier,
            transaction_vendor,
            account_id,
            link_method,
            confidence
          },
          pikadon: pikadonSync?.pikadon || null,
          pikadonSynced: Boolean(pikadonSync),
        });
      } catch (error) {
        if (!transactionComplete) {
          try {
            await client.query('ROLLBACK');
          } catch (_rollbackError) {
            // Ignore rollback failures and surface the original error.
          }
        }
        throw error;
      } finally {
        client.release?.();
      }
    } catch (error) {
      console.error('Investments transaction-link create error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to link transaction',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/transaction-links
   * Get all transaction links for a specific account
   * Query params: account_id
   */
  router.get('/transaction-links', async (req, res) => {
    try {
      const { account_id } = req.query;

      if (!account_id) {
        return res.status(400).json({
          error: 'account_id is required'
        });
      }

      const pool = databaseService;

      const query = `
        SELECT
          tal.*,
          t.name as transaction_name,
          t.price as transaction_amount,
          t.date as transaction_date
        FROM transaction_account_links tal
        LEFT JOIN transactions t ON tal.transaction_identifier = t.identifier
          AND tal.transaction_vendor = t.vendor
        WHERE tal.account_id = $1
        ORDER BY tal.created_at DESC
      `;

      const result = await pool.query(query, [account_id]);

      res.json({
        success: true,
        count: result.rows.length,
        links: result.rows
      });
    } catch (error) {
      console.error('Investments transaction-links list error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch transaction links',
        details: error?.stack,
      });
    }
  });

  /**
   * DELETE /api/investments/transaction-links
   * Unlink a transaction from an investment account
   * Query params: transaction_identifier, transaction_vendor
   */
  router.delete('/transaction-links', async (req, res) => {
    try {
      const { transaction_identifier, transaction_vendor } = req.query;

      if (!transaction_identifier || !transaction_vendor) {
        return res.status(400).json({
          error: 'transaction_identifier and transaction_vendor are required'
        });
      }

      const pool = databaseService;

      const deleteQuery = `
        DELETE FROM transaction_account_links
        WHERE transaction_identifier = $1 AND transaction_vendor = $2
      `;

      await pool.query(deleteQuery, [transaction_identifier, transaction_vendor]);

      res.json({
        success: true,
        message: 'Transaction unlinked successfully'
      });
    } catch (error) {
      console.error('Investments transaction-link delete error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to unlink transaction',
        details: error?.stack,
      });
    }
  });

  /**
   * POST /api/investments/suggestions/create-from-suggestion
   * Creates account + holding + links transactions from a grouped suggestion
   * Body: {
   *   accountDetails: { account_name, account_type, institution, ... },
   *   holdingDetails: { current_value, cost_basis, as_of_date, ... },
   *   transactions: [{transactionIdentifier, transactionVendor, ...}]
   * }
   */
  router.post('/suggestions/create-from-suggestion', async (req, res) => {
    try {
      const { accountDetails, holdingDetails, transactions } = req.body;

      if (!accountDetails || !holdingDetails) {
        return res.status(400).json({
          error: 'accountDetails and holdingDetails are required'
        });
      }

      // Step 1: Create account
      const accountResponse = await accountsService.createAccount(accountDetails);
      const account = accountResponse?.account || accountResponse;

      if (!account || !account.id) {
        throw new Error('Failed to create investment account');
      }

      // Step 2: Create holding with history
      const holdingResponse = await holdingsService.upsertHolding({
        account_id: account.id,
        ...holdingDetails,
        save_history: true
      });
      const holding = holdingResponse?.holding || holdingResponse;

      // Step 3: Link transactions if provided
      let linkResult = null;
      if (transactions && transactions.length > 0) {
        await loadESModules();
        linkResult = await autoLinker.linkMultipleTransactions(
          account.id,
          transactions,
          'auto',
          0.95 // High confidence for user-confirmed suggestions
        );

        // Mark pikadon-related transactions so rollforward excludes them
        for (const txn of transactions) {
          const identifier = txn.transactionIdentifier || txn.identifier;
          const vendor = txn.transactionVendor || txn.vendor;
          const name = txn.transactionName || txn.name || '';
          if (identifier && vendor && transactionLooksLikePikadonDeposit({ name })) {
            await databaseService.query(
              'UPDATE transactions SET is_pikadon_related = 1 WHERE identifier = $1 AND vendor = $2',
              [identifier, vendor]
            );
          }
        }
      }

      res.status(201).json({
        success: true,
        account,
        holding,
        linkResult,
        message: `Successfully created account "${accountDetails.account_name}" with ${linkResult?.successCount || 0} linked transactions`
      });
    } catch (error) {
      console.error('Investments create-from-suggestion error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to create account from suggestion',
        details: error?.stack,
      });
    }
  });

  // ==========================================
  // PIKADON (Term Deposit) Routes
  // ==========================================

  /**
   * GET /api/investments/pikadon
   * List all pikadon holdings
   * Query params: accountId, status, includeTransactions
   */
  router.get('/pikadon', async (req, res) => {
    try {
      const result = await pikadonService.listPikadon(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Pikadon list error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch pikadon list',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/pikadon/summary
   * Get pikadon summary statistics
   */
  router.get('/pikadon/summary', async (req, res) => {
    try {
      const result = await pikadonService.getPikadonSummary();
      res.json(result);
    } catch (error) {
      console.error('Pikadon summary error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch pikadon summary',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/pikadon/detect
   * Detect potential pikadon deposit/return pairs from transactions
   * Query params: startDate, endDate, vendor
   */
  router.get('/pikadon/detect', async (req, res) => {
    try {
      const result = await pikadonService.detectPikadonPairs(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Pikadon detect error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to detect pikadon pairs',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/pikadon/interest-income
   * Get pikadon interest income for analytics
   * Query params: startDate, endDate
   */
  router.get('/pikadon/interest-income', async (req, res) => {
    try {
      const result = await pikadonService.getPikadonInterestIncome(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Pikadon interest income error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch pikadon interest income',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/pikadon/maturity-breakdown
   * Get pikadon maturity breakdown for analytics
   * Shows principal returned, interest earned, and new deposits (for rollovers)
   * Query params: startDate, endDate
   */
  router.get('/pikadon/maturity-breakdown', async (req, res) => {
    try {
      const result = await pikadonService.getPikadonMaturityBreakdown(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Pikadon maturity breakdown error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch pikadon maturity breakdown',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/pikadon/auto-detect
   * Smart event-based detection of pikadon transactions
   * Groups by date into maturity events and builds chains automatically
   * Query params: startDate, endDate, vendor
   */
  router.get('/pikadon/auto-detect', async (req, res) => {
    try {
      const result = await pikadonService.autoDetectPikadonEvents(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Pikadon auto-detect error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to auto-detect pikadon events',
        details: error?.stack,
      });
    }
  });

  /**
   * POST /api/investments/pikadon/auto-setup
   * One-click setup: Create all pikadon entries from detected events
   * Body: { account_id, startDate?, endDate?, vendor? }
   */
  router.post('/pikadon/auto-setup', async (req, res) => {
    try {
      const { account_id, ...params } = req.body || {};
      const result = await pikadonService.autoSetupPikadon(account_id, params);
      res.json(result);
    } catch (error) {
      console.error('Pikadon auto-setup error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to auto-setup pikadon',
        details: error?.stack,
      });
    }
  });

  /**
   * POST /api/investments/pikadon
   * Create a new pikadon holding
   * Body: { account_id, cost_basis, maturity_date, deposit_transaction_id, deposit_transaction_vendor, interest_rate, notes, as_of_date, parent_pikadon_id }
   */
  router.post('/pikadon', async (req, res) => {
    try {
      const result = await pikadonService.createPikadon(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      console.error('Pikadon create error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to create pikadon',
        details: error?.stack,
      });
    }
  });

  /**
   * PUT /api/investments/pikadon/:id
   * Update editable pikadon metadata
   */
  router.put('/pikadon/:id', async (req, res) => {
    try {
      const result = await pikadonService.updatePikadon(req.params.id, req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Investments pikadon update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update pikadon',
        details: error?.stack,
      });
    }
  });

  /**
   * PUT /api/investments/pikadon/:id/link-return
   * Link a return transaction to a pikadon and mark as matured
   * Body: { return_transaction_id, return_transaction_vendor, return_amount }
   */
  router.put('/pikadon/:id/link-return', async (req, res) => {
    try {
      const result = await pikadonService.linkReturnTransaction(req.params.id, req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Pikadon link return error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to link return transaction',
        details: error?.stack,
      });
    }
  });

  /**
   * PUT /api/investments/pikadon/:id/status
   * Update pikadon status
   * Body: { status: 'active' | 'matured' | 'rolled_over' }
   */
  router.put('/pikadon/:id/status', async (req, res) => {
    try {
      const { status } = req.body;
      const result = await pikadonService.updatePikadonStatus(req.params.id, status);
      res.json(result);
    } catch (error) {
      console.error('Pikadon status update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update pikadon status',
        details: error?.stack,
      });
    }
  });

  /**
   * DELETE /api/investments/pikadon/:id
   * Delete a pikadon holding
   */
  router.delete('/pikadon/:id', async (req, res) => {
    try {
      const result = await pikadonService.deletePikadon(req.params.id);
      res.json(result);
    } catch (error) {
      console.error('Pikadon delete error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to delete pikadon',
        details: error?.stack,
      });
    }
  });

  /**
   * POST /api/investments/pikadon/:id/rollover
   * Rollover a matured pikadon into a new one
   * Links return transaction, marks old as rolled_over, creates new pikadon
   */
  router.post('/pikadon/:id/rollover', async (req, res) => {
    try {
      const result = await pikadonService.rolloverPikadon(req.params.id, req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Pikadon rollover error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to rollover pikadon',
        details: error?.stack,
      });
    }
  });

  /**
   * GET /api/investments/pikadon/:id/chain
   * Get the rollover chain for a pikadon (all ancestors and descendants)
   */
  router.get('/pikadon/:id/chain', async (req, res) => {
    try {
      const result = await pikadonService.getRolloverChain(req.params.id);
      res.json(result);
    } catch (error) {
      console.error('Pikadon chain error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch pikadon chain',
        details: error?.stack,
      });
    }
  });

  return router;
}

module.exports = {
  createInvestmentsRouter,
  __setESModulesForTests,
  __resetESModulesForTests,
};
