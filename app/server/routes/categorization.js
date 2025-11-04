const express = require('express');

const categorizationService = require('../services/categorization/rules.js');
const categorizeTransactionService = require('../services/categorization/categorize-transaction.js');

function createCategorizationRouter() {
  const router = express.Router();

  router.get('/categorization_rules', async (_req, res) => {
    try {
      const rules = await categorizationService.listRules();
      res.json(rules);
    } catch (error) {
      console.error('Categorization rules list error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to fetch categorization rules',
      });
    }
  });

  router.post('/categorization_rules', async (req, res) => {
    try {
      const rule = await categorizationService.createRule(req.body || {});
      res.status(201).json(rule);
    } catch (error) {
      console.error('Categorization rules create error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to create categorization rule',
      });
    }
  });

  router.put('/categorization_rules', async (req, res) => {
    try {
      const rule = await categorizationService.updateRule(req.body || {});
      res.json(rule);
    } catch (error) {
      console.error('Categorization rules update error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to update categorization rule',
      });
    }
  });

  const handleRuleDelete = async (req, res) => {
    try {
      const id = req.params?.id || req.query?.id;
      const result = await categorizationService.deleteRule({ id });
      res.json(result);
    } catch (error) {
      console.error('Categorization rules delete error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to delete categorization rule',
      });
    }
  };

  router.delete('/categorization_rules', handleRuleDelete);
  router.delete('/categorization_rules/:id', handleRuleDelete);

  router.post('/categorize_transaction', async (req, res) => {
    try {
      const result = await categorizeTransactionService.categorizeTransaction(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Categorize transaction error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to categorize transaction',
      });
    }
  });

  router.post('/apply_categorization_rules', async (_req, res) => {
    try {
      const result = await categorizationService.applyCategorizationRules();
      res.json(result);
    } catch (error) {
      console.error('Apply categorization rules error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to apply categorization rules',
      });
    }
  });

  router.post('/categorization_rules/auto-create', async (req, res) => {
    try {
      const result = await categorizationService.createAutoRule(req.body || {});
      res.status(201).json(result);
    } catch (error) {
      const status = error?.status || 500;

      // Only log real errors (500+), not client errors like 400/409
      if (status >= 500) {
        console.error('Categorization auto-create error:', error);
      } else {
        console.log('Categorization auto-create:', error?.message);
      }

      res.status(status).json({
        error: error?.message || 'Failed to create rule',
        ...(error?.ruleId ? { ruleId: error.ruleId } : {}),
        details: error?.stack,
      });
    }
  });

  router.get('/categorization_rules/preview', async (req, res) => {
    try {
      const result = await categorizationService.previewRuleMatches(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Categorization preview error:', error);
      const status = error?.status || 500;
      res.status(status).json({
        error: error?.message || 'Failed to preview pattern matches',
        details: error?.stack,
      });
    }
  });

  router.post('/merge_categories', async (req, res) => {
    try {
      const result = await categorizationService.mergeCategories(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Merge categories error:', error);
      res.status(error?.status || 500).json({
        error: error?.message || 'Failed to merge categories',
      });
    }
  });

  return router;
}

module.exports = { createCategorizationRouter };
