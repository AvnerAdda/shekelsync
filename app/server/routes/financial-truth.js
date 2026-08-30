const express = require('express');
const financialTruthService = require('../services/financial-truth.js');

function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error('Financial truth error:', error);
  res.status(status).json({
    success: false,
    error: status < 500 ? error.message : 'Failed to update financial truth',
    ...(error?.code ? { code: error.code } : {}),
  });
}

function createFinancialTruthRouter({ service = financialTruthService } = {}) {
  const router = express.Router();

  router.post('/corrections/preview', (req, res) => {
    try {
      res.json(service.previewCorrection(req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/corrections', (req, res) => {
    try {
      res.status(201).json(service.createCorrection(req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/corrections', (req, res) => {
    try {
      res.json(service.listCorrections({ status: req.query.status }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/corrections/:id/revert', (req, res) => {
    try {
      res.json(service.revertCorrection(req.params.id));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/presentation-dismissals/:sourceKey', (req, res) => {
    try {
      res.json(service.setPresentationDismissal(
        req.params.sourceKey,
        { hidden: req.body?.hidden !== false, sourceType: req.body?.sourceType },
      ));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/presentation-dismissals', (_req, res) => {
    try {
      res.json(service.listPresentationDismissals());
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

module.exports = { createFinancialTruthRouter };
