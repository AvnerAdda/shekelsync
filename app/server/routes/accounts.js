const express = require('express');

const settlementService = require('../services/accounts/settlement.js');
const lastUpdateService = require('../services/accounts/last-update.js');
const pairingsService = require('../services/accounts/pairings.js');
const unpairedService = require('../services/accounts/unpaired.js');
const lastTransactionDateService = require('../services/accounts/last-transaction-date.js');
const smartMatchService = require('../services/accounts/smart-match.js');
const creditCardDetectorService = require('../services/accounts/credit-card-detector.js');
const autoPairingService = require('../services/accounts/auto-pairing.js');
const discrepancyService = require('../services/accounts/discrepancy.js');

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

  router.get('/credit-card-suggestions', async (req, res) => {
    try {
      const result = await creditCardDetectorService.detectCreditCardSuggestions();
      res.json(result);
    } catch (error) {
      console.error('Credit card suggestions error:', error);
      handleServiceError(res, error, 'Failed to detect credit card suggestions');
    }
  });

  // Auto-pair a credit card to its bank account
  router.post('/auto-pair', async (req, res) => {
    try {
      const result = await autoPairingService.autoPairCreditCard(req.body || {});
      if (result.success) {
        res.status(result.wasCreated ? 201 : 200).json(result);
      } else {
        res.status(200).json(result);
      }
    } catch (error) {
      console.error('Auto-pair error:', error);
      handleServiceError(res, error, 'Failed to auto-pair credit card');
    }
  });

  // Find best bank account for a credit card (without creating pairing)
  router.post('/find-bank-account', async (req, res) => {
    try {
      const result = await autoPairingService.findBestBankAccount(req.body || {});
      res.json(result);
    } catch (error) {
      console.error('Find bank account error:', error);
      handleServiceError(res, error, 'Failed to find bank account');
    }
  });

  // Calculate discrepancy for a pairing
  router.post('/calculate-discrepancy', async (req, res) => {
    try {
      const result = await autoPairingService.calculateDiscrepancy(req.body || {});
      res.json(result || { exists: false });
    } catch (error) {
      console.error('Calculate discrepancy error:', error);
      handleServiceError(res, error, 'Failed to calculate discrepancy');
    }
  });

  // Resolve a discrepancy for a pairing
  router.post('/pairing/:id/resolve-discrepancy', async (req, res) => {
    try {
      const pairingId = parseInt(req.params.id, 10);
      const result = await discrepancyService.resolveDiscrepancy({
        pairingId,
        ...req.body,
      });
      res.json(result);
    } catch (error) {
      console.error('Resolve discrepancy error:', error);
      handleServiceError(res, error, 'Failed to resolve discrepancy');
    }
  });

  // Get discrepancy status for a pairing
  router.get('/pairing/:id/discrepancy-status', async (req, res) => {
    try {
      const pairingId = parseInt(req.params.id, 10);
      const result = await discrepancyService.getDiscrepancyStatus(pairingId);
      res.json(result || { acknowledged: false });
    } catch (error) {
      console.error('Get discrepancy status error:', error);
      handleServiceError(res, error, 'Failed to get discrepancy status');
    }
  });

  return router;
}

module.exports = { createAccountsRouter };
