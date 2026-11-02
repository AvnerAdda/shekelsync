'use strict';

/**
 * Real-estate, mortgage and market-data routes, mounted under
 * /api/investments by createInvestmentsRouter.
 */

function sendError(res, error, fallback, label) {
  if (!error?.status || error.status >= 500) console.error(`${label}:`, error);
  res.status(error?.status || 500).json({
    error: error?.message || fallback,
    details: error?.status && error.status < 500 ? undefined : error?.stack,
  });
}

function scenarioFromQuery(query = {}) {
  const scenario = {};
  for (const field of ['primeShiftPct', 'primeOverridePct', 'cpiAnnualOverridePct', 'cpiShiftPct', 'anchorShiftPct']) {
    if (query[field] !== undefined) scenario[field] = query[field];
  }
  return scenario;
}

function registerRealEstateRoutes(router, { realEstateSimulatorService, mortgageService, marketDataService }) {
  router.post('/real-estate/estimate', async (req, res) => {
    try {
      const estimate = realEstateSimulatorService.estimateRealEstateValue(req.body || {});
      res.json({ estimate });
    } catch (error) {
      sendError(res, error, 'Failed to estimate real estate value', 'Real estate estimate error');
    }
  });

  router.get('/real-estate/overview', async (_req, res) => {
    try {
      const overview = await realEstateSimulatorService.getRealEstateOverview();
      const enriched = await mortgageService.enrichOverview(overview, {
        summarize: realEstateSimulatorService.summarizeOverview,
      });
      // Refresh stale market data in the background; never blocks the response.
      Promise.resolve(marketDataService.ensureFresh()).catch(() => {});
      res.json(enriched);
    } catch (error) {
      sendError(res, error, 'Failed to fetch real estate overview', 'Real estate overview fetch error');
    }
  });

  router.get('/real-estate/profiles/:accountId', async (req, res) => {
    try {
      res.json(await realEstateSimulatorService.getRealEstateProfile(req.params.accountId));
    } catch (error) {
      sendError(res, error, 'Failed to fetch real estate profile', 'Real estate profile fetch error');
    }
  });

  router.put('/real-estate/profiles/:accountId', async (req, res) => {
    try {
      const body = req.body || {};
      // The price-index valuation needs cached CBS data: compute the ratio here.
      const indexed = await Promise.resolve()
        .then(() => mortgageService.priceIndexValuation(req.params.accountId, body))
        .catch(() => null);
      const result = await realEstateSimulatorService.upsertRealEstateProfile(
        req.params.accountId,
        indexed ? { ...body, price_index_ratio: indexed.ratio } : body,
      );
      // Detailed tracks own the mortgage figures; re-apply them over any edit.
      await Promise.resolve()
        .then(() => mortgageService.syncLegacyColumns(req.params.accountId))
        .catch(() => null);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Failed to save real estate profile', 'Real estate profile upsert error');
    }
  });

  router.post('/real-estate/properties/:accountId/mortgage/stress', async (req, res) => {
    try {
      res.json(await mortgageService.getStressTest(req.params.accountId, req.body || {}));
    } catch (error) {
      sendError(res, error, 'Failed to run the stress test', 'Mortgage stress error');
    }
  });

  router.get('/real-estate/properties/:accountId/mortgage/refinance-check', async (req, res) => {
    try {
      res.json(await mortgageService.getRefinanceCheck(req.params.accountId, {
        asOf: req.query?.asOf,
        switchingCosts: req.query?.switchingCosts,
      }));
    } catch (error) {
      sendError(res, error, 'Failed to check refinancing', 'Mortgage refinance check error');
    }
  });

  router.post('/real-estate/properties/:accountId/mortgage/refinance-preview', async (req, res) => {
    try {
      res.json(await mortgageService.previewRefinance(req.params.accountId, req.body || {}));
    } catch (error) {
      sendError(res, error, 'Failed to compare the refinance offer', 'Mortgage refinance preview error');
    }
  });

  router.get('/real-estate/properties/:accountId/reconciliation', async (req, res) => {
    try {
      res.json(await mortgageService.getReconciliation(req.params.accountId, { asOf: req.query?.asOf }));
    } catch (error) {
      sendError(res, error, 'Failed to reconcile mortgage payments', 'Mortgage reconciliation error');
    }
  });

  router.put('/real-estate/properties/:accountId/mortgage/payment-matcher', async (req, res) => {
    try {
      res.json(await mortgageService.savePaymentMatcher(req.params.accountId, req.body || {}));
    } catch (error) {
      sendError(res, error, 'Failed to save payment matcher', 'Mortgage payment matcher error');
    }
  });

  router.post('/real-estate/profiles/:accountId/apply-valuation', async (req, res) => {
    try {
      const result = await realEstateSimulatorService.applyRealEstateValuation({
        accountId: req.params.accountId,
        ...(req.body || {}),
      });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error, 'Failed to apply real estate valuation', 'Real estate valuation apply error');
    }
  });

  // ---- Mortgage tracks -----------------------------------------------------

  router.get('/real-estate/properties/:accountId/mortgage', async (req, res) => {
    try {
      res.json(await mortgageService.getMortgageView(req.params.accountId, {
        asOf: req.query?.asOf,
        scenario: scenarioFromQuery(req.query),
      }));
    } catch (error) {
      sendError(res, error, 'Failed to load mortgage', 'Mortgage fetch error');
    }
  });

  router.put('/real-estate/properties/:accountId/mortgage', async (req, res) => {
    try {
      res.json(await mortgageService.saveMortgage(req.params.accountId, req.body || {}));
    } catch (error) {
      sendError(res, error, 'Failed to save mortgage', 'Mortgage save error');
    }
  });

  router.delete('/real-estate/properties/:accountId/mortgage', async (req, res) => {
    try {
      res.json(await mortgageService.deleteMortgage(req.params.accountId));
    } catch (error) {
      sendError(res, error, 'Failed to delete mortgage', 'Mortgage delete error');
    }
  });

  router.post('/real-estate/mortgage/preview', async (req, res) => {
    try {
      res.json(await mortgageService.previewMortgage(req.body || {}));
    } catch (error) {
      sendError(res, error, 'Failed to compute mortgage preview', 'Mortgage preview error');
    }
  });

  router.post('/real-estate/mortgage/calibrate', async (req, res) => {
    try {
      res.json(await mortgageService.calibrateTrack(req.body || {}));
    } catch (error) {
      sendError(res, error, 'Failed to calibrate mortgage track', 'Mortgage calibrate error');
    }
  });

  // ---- Sale / break-even analysis and mortgage health ---------------------

  router.get('/real-estate/properties/:accountId/analysis', async (req, res) => {
    try {
      res.json(await mortgageService.getPropertyAnalysis(req.params.accountId, { asOf: req.query?.asOf }));
    } catch (error) {
      sendError(res, error, 'Failed to analyse property', 'Property analysis error');
    }
  });

  router.put('/real-estate/properties/:accountId/settings', async (req, res) => {
    try {
      res.json(await mortgageService.savePropertySettings(req.params.accountId, req.body || {}));
    } catch (error) {
      sendError(res, error, 'Failed to save property settings', 'Property settings save error');
    }
  });

  router.put('/real-estate/properties/:accountId/costs', async (req, res) => {
    try {
      res.json(await mortgageService.savePropertyCosts(req.params.accountId, req.body || []));
    } catch (error) {
      sendError(res, error, 'Failed to save property costs', 'Property costs save error');
    }
  });

  // ---- Market data ---------------------------------------------------------

  router.get('/market-data/snapshot', async (_req, res) => {
    try {
      res.json(await marketDataService.getMarketSnapshot());
    } catch (error) {
      sendError(res, error, 'Failed to load market data', 'Market data snapshot error');
    }
  });

  router.post('/market-data/sync', async (req, res) => {
    try {
      const body = req.body || {};
      const result = await marketDataService.syncMarketSeries({
        keys: Array.isArray(body.keys) ? body.keys : undefined,
        force: body.force === true,
      });
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Failed to sync market data', 'Market data sync error');
    }
  });

  router.get('/market-data/series/:key', async (req, res) => {
    try {
      res.json(await marketDataService.getSeries(req.params.key, {
        from: typeof req.query?.from === 'string' ? req.query.from : undefined,
        to: typeof req.query?.to === 'string' ? req.query.to : undefined,
      }));
    } catch (error) {
      sendError(res, error, 'Failed to load market series', 'Market data series error');
    }
  });
}

module.exports = { registerRealEstateRoutes };
