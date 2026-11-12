const express = require('express');

const payrollService = require('../services/payroll/service.js');

function sendError(res, error, message) {
  const status = error?.status || 500;
  if (status >= 500) {
    console.error(`${message}:`, error);
  }
  res.status(status).json({
    success: false,
    error: status < 500 ? error.message : message,
  });
}

function createPayrollRouter() {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      res.json(await payrollService.getPayrollSetup());
    } catch (error) {
      sendError(res, error, 'Failed to fetch payroll setup');
    }
  });

  router.get('/salary-candidates', async (_req, res) => {
    try {
      res.json(await payrollService.getSalaryCandidates());
    } catch (error) {
      sendError(res, error, 'Failed to fetch salary candidates');
    }
  });

  router.put('/:member', async (req, res) => {
    try {
      res.json(await payrollService.saveEmployment(req.params.member, req.body || {}));
    } catch (error) {
      sendError(res, error, 'Failed to save employment');
    }
  });

  router.delete('/:member', async (req, res) => {
    try {
      res.json(await payrollService.deleteEmployment(req.params.member));
    } catch (error) {
      sendError(res, error, 'Failed to delete employment');
    }
  });

  return router;
}

module.exports = { createPayrollRouter };
