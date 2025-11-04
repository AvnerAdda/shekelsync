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

  return router;
}

module.exports = { createInvestmentsRouter };
