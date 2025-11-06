const express = require('express');

const checkExistingService = require('../services/investments/check-existing.js');
const historyService = require('../services/investments/history.js');
const patternsService = require('../services/investments/patterns.js');
const pendingSuggestionsService = require('../services/investments/pending-suggestions.js');
const costBasisService = require('../services/investments/suggest-cost-basis.js');
const accountsService = require('../services/investments/accounts.js');
const assetsService = require('../services/investments/assets.js');
const holdingsService = require('../services/investments/holdings.js');
const summaryService = require('../services/investments/summary.js');

// Dynamic imports for ES modules
let suggestionAnalyzer;
let autoLinker;

async function loadESModules() {
  if (!suggestionAnalyzer) {
    suggestionAnalyzer = await import('../services/investments/suggestion-analyzer.js');
  }
  if (!autoLinker) {
    autoLinker = await import('../services/investments/auto-linker.js');
  }
}

function createInvestmentsRouter() {
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
      await loadESModules();
      const { thresholdDays = 90, dismissalThreshold = 3 } = req.query;

      // Get all suggestions
      const allSuggestions = await suggestionAnalyzer.analyzeInvestmentTransactions(parseInt(thresholdDays));

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
      console.error('Investments pending suggestions error:', error);
      res.status(error?.statusCode || 500).json({
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

      const { getPool } = require('../../../pages/api/db');
      const pool = getPool();

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
          VALUES (?, ?, 'dismissed', 1, datetime('now'))
          ON CONFLICT(transaction_identifier, transaction_vendor) DO UPDATE SET
            dismiss_count = dismiss_count + 1,
            last_dismissed_at = datetime('now'),
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
      const account = await accountsService.createAccount(accountDetails);

      if (!account || !account.id) {
        throw new Error('Failed to create investment account');
      }

      // Step 2: Create holding with history
      const holding = await holdingsService.upsertHolding({
        account_id: account.id,
        ...holdingDetails,
        save_history: true
      });

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

  return router;
}

module.exports = { createInvestmentsRouter };
