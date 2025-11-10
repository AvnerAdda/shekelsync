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
const holdingsService = require('../../services/investments/holdings.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const summaryService = require('../../services/investments/summary.js');

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
});
