import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared accounts router under test
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAccountsRouter } = require('../../routes/accounts.js');

// Backing services to be mocked
// eslint-disable-next-line @typescript-eslint/no-var-requires
const settlementService = require('../../services/accounts/settlement.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lastUpdateService = require('../../services/accounts/last-update.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pairingsService = require('../../services/accounts/pairings.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const unpairedService = require('../../services/accounts/unpaired.js');

function buildApp() {
  const app = express();
  app.use(express.json());

  app.use('/api/accounts', createAccountsRouter());

  return app;
}

describe('Electron /api/accounts routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns settlement candidates', async () => {
    const payload = { candidates: [{ id: 1 }] };
    const spy = vi
      .spyOn(settlementService, 'findSettlementCandidates')
      .mockResolvedValue(payload);

    const res = await request(app).get('/api/accounts/find-settlement-candidates').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns last update timestamps', async () => {
    const payload = [{ id: 1, last_update: '2025-10-31T00:00:00Z' }];
    const spy = vi
      .spyOn(lastUpdateService, 'listAccountLastUpdates')
      .mockResolvedValue(payload);

    const res = await request(app).get('/api/accounts/last-update').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('creates a pairing', async () => {
    const spy = vi.spyOn(pairingsService, 'createPairing').mockResolvedValue({ pairingId: 'abc' });

    const res = await request(app)
      .post('/api/accounts/pairing')
      .send({ sourceAccountId: 1, targetAccountId: 2 })
      .expect(201);

    expect(res.body).toEqual({
      message: 'Pairing created successfully',
      pairingId: 'abc',
    });
    expect(spy).toHaveBeenCalledWith({ sourceAccountId: 1, targetAccountId: 2 });
  });

  it('surfaces service errors with appropriate status codes', async () => {
    vi.spyOn(pairingsService, 'listPairings').mockRejectedValue({
      status: 503,
      message: 'database unavailable',
    });

    const res = await request(app).get('/api/accounts/pairing').expect(503);

    expect(res.body.error).toMatch(/database unavailable/i);
  });

  it('returns unpaired transaction count', async () => {
    vi.spyOn(unpairedService, 'getUnpairedTransactionCount').mockResolvedValue(42);

    const res = await request(app).get('/api/accounts/unpaired-transactions-count').expect(200);

    expect(res.body).toEqual({ count: 42 });
  });
});
