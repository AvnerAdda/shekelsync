const express = require('express');

const categoriesHierarchyService = require('../services/categories/hierarchy.js');
const categoriesTransactionsService = require('../services/categories/transactions.js');

function createCategoriesRouter() {
  const router = express.Router();

  router.get('/hierarchy', async (req, res) => {
    try {
      const result = await categoriesHierarchyService.listHierarchy(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Categories hierarchy get error:', error);
      const status = error?.status || 500;
      res.status(status).json({ error: error?.message || 'Internal server error' });
    }
  });

  router.post('/hierarchy', async (req, res) => {
    try {
      const category = await categoriesHierarchyService.createCategory(req.body || {});
      res.status(201).json(category);
    } catch (error) {
      console.error('Categories hierarchy create error:', error);
      const status = error?.status || 500;
      res.status(status).json({ error: error?.message || 'Internal server error' });
    }
  });

  router.put('/hierarchy', async (req, res) => {
    try {
      const category = await categoriesHierarchyService.updateCategory(req.body || {});
      res.json(category);
    } catch (error) {
      console.error('Categories hierarchy update error:', error);
      const status = error?.status || 500;
      res.status(status).json({ error: error?.message || 'Internal server error' });
    }
  });

  router.delete('/hierarchy', async (req, res) => {
    try {
      const result = await categoriesHierarchyService.deleteCategory(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Categories hierarchy delete error:', error);
      const status = error?.status || 500;
      res.status(status).json({ error: error?.message || 'Internal server error' });
    }
  });

  router.get('/transactions', async (req, res) => {
    try {
      const result = await categoriesTransactionsService.listCategoryTransactions(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Categories transactions error:', error);
      const status = error?.status || 500;
      res.status(status).json({ error: error?.message || 'Failed to fetch category transactions' });
    }
  });

  return router;
}

module.exports = { createCategoriesRouter };
