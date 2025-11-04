const express = require('express');

const budgetsService = require('../services/budgets.js');

function sendError(res, error, fallbackMessage = 'Internal server error') {
  const status = error?.status || error?.statusCode || 500;
  res.status(status).json({
    success: false,
    error: error?.message || fallbackMessage,
  });
}

function createBudgetsRouter() {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const budgets = await budgetsService.listBudgets();
      res.json(budgets);
    } catch (error) {
      console.error('Budgets list error:', error);
      sendError(res, error, 'Failed to load budgets');
    }
  });

  router.get('/usage', async (_req, res) => {
    try {
      const usage = await budgetsService.listBudgetUsage();
      res.json(usage);
    } catch (error) {
      console.error('Budget usage error:', error);
      sendError(res, error, 'Failed to load budget usage');
    }
  });

  router.post('/', async (req, res) => {
    try {
      const budget = await budgetsService.upsertBudget(req.body || {});
      res.status(201).json(budget);
    } catch (error) {
      console.error('Budget create error:', error);
      sendError(res, error, 'Failed to create budget');
    }
  });

  router.put('/', async (req, res) => {
    try {
      const budget = await budgetsService.updateBudget(req.body || {});
      res.json(budget);
    } catch (error) {
      console.error('Budget update error:', error);
      sendError(res, error, 'Failed to update budget');
    }
  });

  router.delete('/', async (req, res) => {
    try {
      const result = await budgetsService.deactivateBudget(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Budget delete error:', error);
      sendError(res, error, 'Failed to delete budget');
    }
  });

  return router;
}

module.exports = { createBudgetsRouter };
