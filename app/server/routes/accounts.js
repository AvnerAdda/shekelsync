const express = require('express');

const settlementService = require('../services/accounts/settlement.js');
const lastUpdateService = require('../services/accounts/last-update.js');
const pairingsService = require('../services/accounts/pairings.js');
const unpairedService = require('../services/accounts/unpaired.js');
const lastTransactionDateService = require('../services/accounts/last-transaction-date.js');
const smartMatchService = require('../services/accounts/smart-match.js');

function handleServiceError(res, error, fallbackMessage) {
  const status = error?.status || error?.statusCode || 500;
  res.status(status).json({
    success: false,
    error: error?.message || fallbackMessage || 'Internal server error',
    ...(error?.existingId ? { existingId: error.existingId } : {}),
  });
}

function createAccountsRouter() {
  const router = express.Router();

  router.get('/find-settlement-candidates', async (req, res) => {
    try {
      const result = await settlementService.findSettlementCandidates(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Settlement candidates error:', error);
      handleServiceError(res, error, 'Failed to find settlement candidates');
    }
  });

  router.get('/last-update', async (req, res) => {
    try {
      const accounts = await lastUpdateService.listAccountLastUpdates();
      res.json(accounts);
    } catch (error) {
      console.error('Accounts last update error:', error);
      handleServiceError(res, error, 'Failed to fetch account last updates');
    }
  });

  router.get('/pairing', async (req, res) => {
    try {
      const pairings = await pairingsService.listPairings(req.query || {});
      res.json({ pairings });
    } catch (error) {
      console.error('Pairings list error:', error);
      handleServiceError(res, error, 'Failed to fetch account pairings');
    }
  });

  router.post('/pairing', async (req, res) => {
    try {
      const result = await pairingsService.createPairing(req.body || {});
      res.status(201).json({
        message: 'Pairing created successfully',
        pairingId: result.pairingId,
      });
    } catch (error) {
      console.error('Pairing create error:', error);
      handleServiceError(res, error, 'Failed to create pairing');
    }
  });

  router.put('/pairing', async (req, res) => {
    try {
      await pairingsService.updatePairing(req.body || {});
      res.json({ message: 'Pairing updated successfully' });
    } catch (error) {
      console.error('Pairing update error:', error);
      handleServiceError(res, error, 'Failed to update pairing');
    }
  });

  router.delete('/pairing', async (req, res) => {
    try {
      const id = req.query?.id || req.body?.id;
      await pairingsService.deletePairing({ id });
      res.json({ message: 'Pairing deleted successfully' });
    } catch (error) {
      console.error('Pairing delete error:', error);
      handleServiceError(res, error, 'Failed to delete pairing');
    }
  });

  router.get('/truly-unpaired-transactions', async (req, res) => {
    try {
      const result = await unpairedService.getTrulyUnpairedTransactions(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Truly unpaired error:', error);
      handleServiceError(res, error, 'Failed to fetch unpaired transactions');
    }
  });

  router.get('/unpaired-transactions-count', async (req, res) => {
    try {
      const count = await unpairedService.getUnpairedTransactionCount();
      res.json({ count });
    } catch (error) {
      console.error('Unpaired count error:', error);
      handleServiceError(res, error, 'Failed to count unpaired transactions');
    }
  });

  router.get('/last-transaction-date', async (req, res) => {
    try {
      const result = await lastTransactionDateService.getLastTransactionDate(req.query || {});
      res.json(result);
    } catch (error) {
      console.error('Last transaction date error:', error);
      handleServiceError(res, error, 'Failed to fetch last transaction date');
    }
  });

  router.post('/smart-match', async (req, res) => {
    try {
      const result = await smartMatchService.findSmartMatches(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Smart match error:', error);
      handleServiceError(res, error, 'Failed to perform smart match');
    }
  });

  return router;
}

module.exports = { createAccountsRouter };
