import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createInvestmentsRouter } = require('../../routes/investments.js');

// Services
// eslint-disable-next-line @typescript-eslint/no-var-requires
const patternsService = require('../../services/investments/patterns.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pendingSuggestionsService = require('../../services/investments/pending-suggestions.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const costBasisService = require('../../services/investments/suggest-cost-basis.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const accountsService = require('../../services/investments/accounts.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const checkExistingService = require('../../services/investments/check-existing.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const assetsService = require('../../services/investments/assets.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const holdingsService = require('../../services/investments/holdings.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const summaryService = require('../../services/investments/summary.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ignoredManualMatchingService = require('../../services/investments/manual-matching.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bankSummaryService = require('../../services/investments/bank-summary.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ignoredDatabase = require('../../services/database.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pikadonService = require('../../services/investments/pikadon.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/investments', createInvestmentsRouter());
  return app;
}

describe('Shared /api/investments routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns pending suggestions', async () => {
    vi.spyOn(pendingSuggestionsService, 'listPendingSuggestions').mockResolvedValue({
      pendingSuggestions: [],
      total: 0,
    });

    const res = await request(app).get('/api/investments/pending-suggestions').expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.pending_suggestions)).toBe(true);
  });

  it('creates a new investment pattern', async () => {
    const payload = { id: 'pattern-1' };
    const spy = vi.spyOn(patternsService, 'createPattern').mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/investments/patterns')
      .send({ vendor: 'test' })
      .expect(201);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ vendor: 'test' });
  });

  it('lists investment accounts', async () => {
    const accounts = [{ id: 'acct-1' }];
    vi.spyOn(accountsService, 'listAccounts').mockResolvedValue(accounts);

    const res = await request(app).get('/api/investments/accounts').expect(200);

    expect(res.body).toEqual(accounts);
  });

  it('updates an investment holding', async () => {
    const holding = { id: 'holding-1' };
    const spy = vi.spyOn(holdingsService, 'upsertHolding').mockResolvedValue(holding);

    const res = await request(app)
      .post('/api/investments/holdings')
      .send({ id: 'holding-1' })
      .expect(201);

    expect(res.body).toEqual(holding);
    expect(spy).toHaveBeenCalledWith({ id: 'holding-1' });
  });

  it('handles cost basis errors', async () => {
    vi.spyOn(costBasisService, 'suggestCostBasis').mockRejectedValue({
      status: 422,
      message: 'Invalid request',
    });

    const res = await request(app)
      .get('/api/investments/suggest-cost-basis')
      .expect(422);

    expect(res.body.error).toMatch(/invalid request/i);
  });

  it('returns investment summary', async () => {
    const summary = { totalPortfolioValue: 1234 };
    vi.spyOn(summaryService, 'getInvestmentSummary').mockResolvedValue(summary);

    const res = await request(app).get('/api/investments/summary').expect(200);

    expect(res.body).toEqual(summary);
  });

  it('checks existing investments and lists patterns', async () => {
    vi.spyOn(checkExistingService, 'getExistingInvestments').mockResolvedValue({ exists: true });
    vi.spyOn(patternsService, 'listPatterns').mockResolvedValue([{ id: 'p1' }]);

    const existing = await request(app).get('/api/investments/check-existing?vendor=acme').expect(200);
    expect(existing.body.exists).toBe(true);

    const patterns = await request(app).get('/api/investments/patterns').expect(200);
    expect(patterns.body).toEqual([{ id: 'p1' }]);
  });

  it('lists assets and returns bank summary', async () => {
    vi.spyOn(assetsService, 'listAssets').mockResolvedValue([{ id: 'a1' }]);
    vi.spyOn(bankSummaryService, 'getBankBalanceSummary').mockResolvedValue({ balances: [] });

    const assets = await request(app).get('/api/investments/assets').expect(200);
    expect(assets.body).toEqual([{ id: 'a1' }]);

    const bank = await request(app).get('/api/investments/bank-summary').expect(200);
    expect(bank.body).toEqual({ balances: [] });
  });

  it('validates transaction link inputs and returns 400s', async () => {
    const resCreate = await request(app).post('/api/investments/transaction-links').send({}).expect(400);
    expect(resCreate.body.error).toMatch(/transaction_identifier/);

    const resList = await request(app).get('/api/investments/transaction-links').expect(400);
    expect(resList.body.error).toMatch(/account_id/);

    const resDelete = await request(app)
      .delete('/api/investments/transaction-links?transaction_identifier=1')
      .expect(400);
    expect(resDelete.body.error).toMatch(/transaction_vendor/);
  });

  it('returns 400 when manual matching required params are missing', async () => {
    const unmatched = await request(app).get('/api/investments/manual-matching/unmatched-repayments').expect(400);
    expect(unmatched.body.error).toMatch(/Missing required parameters/);

    const available = await request(app).get('/api/investments/manual-matching/available-expenses').expect(400);
    expect(available.body.error).toMatch(/Missing required parameters/);
  });

  it('returns 400 for invalid suggestions dismiss payload', async () => {
    const res = await request(app).post('/api/investments/suggestions/dismiss').send({}).expect(400);
    expect(res.body.error).toMatch(/transactionIdentifiers/);
  });

  it('returns pikadon payloads', async () => {
    vi.spyOn(pikadonService, 'listPikadon').mockResolvedValue([{ id: 1 }]);
    vi.spyOn(pikadonService, 'getPikadonSummary').mockResolvedValue({ count: 1 });
    vi.spyOn(pikadonService, 'detectPikadonPairs').mockResolvedValue({ pairs: [] });

    const list = await request(app).get('/api/investments/pikadon').expect(200);
    expect(list.body).toEqual([{ id: 1 }]);

    const summary = await request(app).get('/api/investments/pikadon/summary').expect(200);
    expect(summary.body).toEqual({ count: 1 });

    const detect = await request(app).get('/api/investments/pikadon/detect').expect(200);
    expect(detect.body).toEqual({ pairs: [] });
  });
});
