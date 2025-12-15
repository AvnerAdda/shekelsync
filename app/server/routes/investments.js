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
const bankSummaryService = require('../services/investments/bank-summary.js');
const suggestionAnalyzerCJS = require('../services/investments/suggestion-analyzer-cjs.js');
const manualMatchingService = require('../services/investments/manual-matching.js');
const pikadonService = require('../services/investments/pikadon.js');

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

      const database = require('../services/database.js');
      const pool = database;

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
        confidence = 1.0
      } = req.body;

      if (!transaction_identifier || !transaction_vendor || !account_id) {
        return res.status(400).json({
          error: 'transaction_identifier, transaction_vendor, and account_id are required'
        });
      }

      const database = require('../services/database.js');
      const pool = database;

      // First, get the transaction date
      const txnQuery = `
        SELECT date FROM transactions
        WHERE identifier = ? AND vendor = ?
        LIMIT 1
      `;
      const txnResult = await pool.query(txnQuery, [transaction_identifier, transaction_vendor]);

      if (!txnResult.rows || txnResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Transaction not found',
          transaction_identifier,
          transaction_vendor
        });
      }

      const transactionDate = txnResult.rows[0].date;

      // Insert or update the link
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
        VALUES (?, ?, ?, ?, ?, ?, 'user')
        ON CONFLICT(transaction_identifier, transaction_vendor) DO UPDATE SET
          account_id = excluded.account_id,
          link_method = excluded.link_method,
          confidence = excluded.confidence,
          created_at = datetime('now')
      `;

      await pool.query(insertQuery, [
        transaction_identifier,
        transaction_vendor,
        transactionDate,
        account_id,
        link_method,
        confidence
      ]);

      res.status(201).json({
        success: true,
        message: 'Transaction linked successfully',
        link: {
          transaction_identifier,
          transaction_vendor,
          account_id,
          link_method,
          confidence
        }
      });
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

      const database = require('../services/database.js');
      const pool = database;

      const query = `
        SELECT
          tal.*,
          t.name as transaction_name,
          t.price as transaction_amount,
          t.date as transaction_date
        FROM transaction_account_links tal
        LEFT JOIN transactions t ON tal.transaction_identifier = t.identifier
          AND tal.transaction_vendor = t.vendor
        WHERE tal.account_id = ?
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

      const database = require('../services/database.js');
      const pool = database;

      const deleteQuery = `
        DELETE FROM transaction_account_links
        WHERE transaction_identifier = ? AND transaction_vendor = ?
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

  // Manual Matching Routes
  router.get('/manual-matching/unmatched-repayments', async (req, res) => {
    try {
      const {
        creditCardAccountNumber,
        creditCardVendor,
        bankVendor,
        bankAccountNumber,
        matchPatterns
      } = req.query;

      if (!creditCardVendor || !bankVendor) {
        return res.status(400).json({
          error: 'Missing required parameters: creditCardVendor, bankVendor'
        });
      }

      // Parse matchPatterns from JSON string if provided
      let patternsArray = null;
      if (matchPatterns) {
        try {
          patternsArray = JSON.parse(matchPatterns);
        } catch (e) {
          return res.status(400).json({
            error: 'Invalid matchPatterns format - must be JSON array'
          });
        }
      }

      const repayments = await manualMatchingService.getUnmatchedRepayments({
        creditCardAccountNumber: creditCardAccountNumber || null,
        creditCardVendor,
        bankVendor,
        bankAccountNumber: bankAccountNumber || null,
        matchPatterns: patternsArray
      });

      res.json({
        success: true,
        repayments
      });
    } catch (error) {
      console.error('Manual matching - get unmatched repayments error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch unmatched repayments',
        details: error?.stack,
      });
    }
  });

  router.get('/manual-matching/available-expenses', async (req, res) => {
    try {
      const {
        repaymentDate,
        creditCardAccountNumber,
        creditCardVendor,
        processedDate  // NEW: Smart date filtering
      } = req.query;

      if (!repaymentDate || !creditCardVendor) {
        return res.status(400).json({
          error: 'Missing required parameters: repaymentDate, creditCardVendor'
        });
      }

      const expenses = await manualMatchingService.getAvailableExpenses({
        repaymentDate,
        creditCardAccountNumber: creditCardAccountNumber || null,
        creditCardVendor,
        processedDate: processedDate || null  // NEW: Optional smart date filter
      });

      res.json({
        success: true,
        expenses,
        smartDateUsed: !!processedDate  // Indicate if smart matching was used
      });
    } catch (error) {
      console.error('Manual matching - get available expenses error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch available expenses',
        details: error?.stack,
      });
    }
  });

  // NEW: Get available processed dates (billing cycles) for smart matching
  router.get('/manual-matching/processed-dates', async (req, res) => {
    try {
      const {
        creditCardAccountNumber,
        creditCardVendor,
        startDate,
        endDate
      } = req.query;

      if (!creditCardVendor) {
        return res.status(400).json({
          error: 'Missing required parameter: creditCardVendor'
        });
      }

      const processedDates = await manualMatchingService.getAvailableProcessedDates({
        creditCardAccountNumber: creditCardAccountNumber || null,
        creditCardVendor,
        startDate: startDate || null,
        endDate: endDate || null
      });

      res.json({
        success: true,
        processedDates,
        count: processedDates.length
      });
    } catch (error) {
      console.error('Manual matching - get processed dates error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch processed dates',
        details: error?.stack,
      });
    }
  });

  // NEW: Get bank repayments for a specific processed date
  router.get('/manual-matching/bank-repayments-for-date', async (req, res) => {
    try {
      const {
        processedDate,
        bankVendor,
        bankAccountNumber,
        matchPatterns
      } = req.query;

      if (!processedDate || !bankVendor) {
        return res.status(400).json({
          error: 'Missing required parameters: processedDate, bankVendor'
        });
      }

      // Parse matchPatterns from JSON string if provided
      let patternsArray = null;
      if (matchPatterns) {
        try {
          patternsArray = JSON.parse(matchPatterns);
        } catch (e) {
          return res.status(400).json({
            error: 'Invalid matchPatterns format - must be JSON array'
          });
        }
      }

      const result = await manualMatchingService.getBankRepaymentsForProcessedDate({
        processedDate,
        bankVendor,
        bankAccountNumber: bankAccountNumber || null,
        matchPatterns: patternsArray
      });

      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('Manual matching - get bank repayments for date error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch bank repayments for date',
        details: error?.stack,
      });
    }
  });

  router.post('/manual-matching/save-match', async (req, res) => {
    try {
      const {
        repaymentTxnId,
        repaymentVendor,
        repaymentDate,
        repaymentAmount,
        cardNumber,
        ccVendor,
        expenses,
        tolerance  // NEW: Optional tolerance parameter (default: 2, max: 50)
      } = req.body;

      if (!repaymentTxnId || !repaymentVendor || !repaymentDate || repaymentAmount === undefined || repaymentAmount === null || !ccVendor || !expenses || !Array.isArray(expenses)) {
        return res.status(400).json({
          error: 'Missing required parameters: repaymentTxnId, repaymentVendor, repaymentDate, repaymentAmount, ccVendor, expenses (array)'
        });
      }

      const result = await manualMatchingService.saveManualMatch({
        repaymentTxnId,
        repaymentVendor,
        repaymentDate,
        repaymentAmount,
        cardNumber: cardNumber || null,
        ccVendor,
        expenses,
        tolerance: tolerance ? parseFloat(tolerance) : 2  // NEW: Pass tolerance (default: 2)
      });

      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('Manual matching - save match error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to save manual match',
        details: error?.stack,
      });
    }
  });

  router.get('/manual-matching/stats', async (req, res) => {
    try {
      const { bankVendor, bankAccountNumber } = req.query;

      if (!bankVendor) {
        return res.status(400).json({
          error: 'Missing required parameter: bankVendor'
        });
      }

      const stats = await manualMatchingService.getMatchingStats({
        bankVendor,
        bankAccountNumber: bankAccountNumber || null
      });

      res.json({
        success: true,
        stats
      });
    } catch (error) {
      console.error('Manual matching - get stats error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch matching stats',
        details: error?.stack,
      });
    }
  });

  router.get('/manual-matching/weekly-stats', async (req, res) => {
    try {
      const {
        creditCardAccountNumber,
        creditCardVendor,
        bankVendor,
        bankAccountNumber,
        matchPatterns,
        startDate,
        endDate
      } = req.query;

      if (!creditCardVendor || !bankVendor) {
        return res.status(400).json({
          error: 'Missing required parameters: creditCardVendor, bankVendor'
        });
      }

      // Parse matchPatterns if provided
      let patternsArray = null;
      if (matchPatterns) {
        try {
          patternsArray = JSON.parse(matchPatterns);
        } catch (e) {
          return res.status(400).json({
            error: 'Invalid matchPatterns format - must be JSON array'
          });
        }
      }

      const weeklyStats = await manualMatchingService.getWeeklyMatchingStats({
        creditCardAccountNumber: creditCardAccountNumber || '',
        creditCardVendor,
        bankVendor,
        bankAccountNumber: bankAccountNumber || null,
        matchPatterns: patternsArray,
        startDate,
        endDate
      });

      res.json({
        success: true,
        weeklyStats,
        count: weeklyStats.length
      });
    } catch (error) {
      console.error('Manual matching - weekly stats error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to fetch weekly stats',
        details: error?.stack,
      });
    }
  });

  router.get('/manual-matching/find-combinations', async (req, res) => {
    try {
      const {
        repaymentTxnId,
        repaymentDate,
        repaymentAmount,
        creditCardAccountNumber,
        creditCardVendor,
        tolerance,
        maxCombinationSize,
        includeMatched,
        processedDate  // NEW: Smart date filtering
      } = req.query;

      if (!repaymentTxnId || !repaymentDate || !repaymentAmount || !creditCardVendor) {
        return res.status(400).json({
          error: 'Missing required parameters: repaymentTxnId, repaymentDate, repaymentAmount, creditCardVendor'
        });
      }

      const combinations = await manualMatchingService.findMatchingCombinations({
        repaymentTxnId,
        repaymentDate,
        repaymentAmount: parseFloat(repaymentAmount),
        creditCardAccountNumber: creditCardAccountNumber || '',
        creditCardVendor,
        tolerance: tolerance ? parseFloat(tolerance) : 0,  // Default: 0 for perfect match
        maxCombinationSize: maxCombinationSize ? parseInt(maxCombinationSize) : 15,
        includeMatched: includeMatched === 'true' || includeMatched === true,  // Include already matched expenses
        processedDate: processedDate || null  // NEW: Optional smart date filter
      });

      res.json({
        success: true,
        combinations,
        count: combinations.length
      });
    } catch (error) {
      console.error('Manual matching - find combinations error:', error);
      res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to find matching combinations',
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

module.exports = { createInvestmentsRouter };
