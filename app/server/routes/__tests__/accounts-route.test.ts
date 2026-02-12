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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lastTransactionDateService = require('../../services/accounts/last-transaction-date.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const smartMatchService = require('../../services/accounts/smart-match.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const creditCardDetectorService = require('../../services/accounts/credit-card-detector.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const autoPairingService = require('../../services/accounts/auto-pairing.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const discrepancyService = require('../../services/accounts/discrepancy.js');

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

  it('handles settlement candidate errors', async () => {
    vi.spyOn(settlementService, 'findSettlementCandidates').mockRejectedValue(
      Object.assign(new Error('boom'), { status: 500 }),
    );

    const res = await request(app).get('/api/accounts/find-settlement-candidates').expect(500);
    expect(res.body.error).toBeDefined();
  });

  it('handles unpaired count errors', async () => {
    vi.spyOn(unpairedService, 'getUnpairedTransactionCount').mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/accounts/unpaired-transactions-count').expect(500);
    expect(res.body.error).toBeDefined();
  });

  it('lists pairings', async () => {
    const payload = [{ id: 1 }];
    vi.spyOn(pairingsService, 'listPairings').mockResolvedValue(payload);

    const res = await request(app).get('/api/accounts/pairing').expect(200);
    expect(res.body).toEqual({ pairings: payload });
  });

  it('updates and deletes pairings', async () => {
    vi.spyOn(pairingsService, 'updatePairing').mockResolvedValue({ success: true });
    vi.spyOn(pairingsService, 'deletePairing').mockResolvedValue({ success: true });

    await request(app).put('/api/accounts/pairing').send({ id: 1 }).expect(200);
    await request(app).delete('/api/accounts/pairing?id=1').expect(200);

    expect(pairingsService.updatePairing).toHaveBeenCalledWith({ id: 1 });
    expect(pairingsService.deletePairing).toHaveBeenCalledWith({ id: '1' });
  });

  it('fetches last transaction date and smart match results', async () => {
    vi.spyOn(lastTransactionDateService, 'getLastTransactionDate').mockResolvedValue({ date: '2025-01-01' });
    vi.spyOn(smartMatchService, 'findSmartMatches').mockResolvedValue({ matches: [] });

    const lastDate = await request(app).get('/api/accounts/last-transaction-date').expect(200);
    expect(lastDate.body).toEqual({ date: '2025-01-01' });

    const smartMatch = await request(app).post('/api/accounts/smart-match').send({}).expect(200);
    expect(smartMatch.body).toEqual({ matches: [] });
  });

  it('lists truly unpaired transactions', async () => {
    vi.spyOn(unpairedService, 'getTrulyUnpairedTransactions').mockResolvedValue([{ id: 'u1' }]);

    const res = await request(app).get('/api/accounts/truly-unpaired-transactions').expect(200);
    expect(res.body).toEqual([{ id: 'u1' }]);
  });

  it('returns credit card suggestions', async () => {
    vi.spyOn(creditCardDetectorService, 'detectCreditCardSuggestions').mockResolvedValue([{ card: '1234' }]);

    const res = await request(app).get('/api/accounts/credit-card-suggestions').expect(200);
    expect(res.body).toEqual([{ card: '1234' }]);
  });

  it('returns auto-pair results with status based on creation state', async () => {
    vi.spyOn(autoPairingService, 'autoPairCreditCard')
      .mockResolvedValueOnce({ success: true, wasCreated: true, pairingId: 9 })
      .mockResolvedValueOnce({ success: true, wasCreated: false, pairingId: 9 })
      .mockResolvedValueOnce({ success: false, reason: 'no match' });

    const created = await request(app)
      .post('/api/accounts/auto-pair')
      .send({ creditCardId: 1 })
      .expect(201);
    expect(created.body).toMatchObject({ success: true, wasCreated: true, pairingId: 9 });

    const updated = await request(app)
      .post('/api/accounts/auto-pair')
      .send({ creditCardId: 1 })
      .expect(200);
    expect(updated.body).toMatchObject({ success: true, wasCreated: false, pairingId: 9 });

    const noMatch = await request(app)
      .post('/api/accounts/auto-pair')
      .send({ creditCardId: 1 })
      .expect(200);
    expect(noMatch.body).toMatchObject({ success: false, reason: 'no match' });
  });

  it('handles auto-pair errors and includes existingId when provided', async () => {
    vi.spyOn(autoPairingService, 'autoPairCreditCard').mockRejectedValue({
      status: 409,
      message: 'pairing exists',
      existingId: 77,
    });

    const res = await request(app).post('/api/accounts/auto-pair').send({ creditCardId: 1 }).expect(409);
    expect(res.body).toMatchObject({
      success: false,
      error: 'pairing exists',
      existingId: 77,
    });
  });

  it('returns best bank account and handles service errors', async () => {
    vi.spyOn(autoPairingService, 'findBestBankAccount')
      .mockResolvedValueOnce({ found: true, bankAccountId: 22 })
      .mockRejectedValueOnce({ statusCode: 503, message: 'temporarily unavailable' });

    const ok = await request(app).post('/api/accounts/find-bank-account').send({}).expect(200);
    expect(ok.body).toEqual({ found: true, bankAccountId: 22 });

    const fail = await request(app).post('/api/accounts/find-bank-account').send({}).expect(503);
    expect(fail.body.error).toBe('temporarily unavailable');
  });

  it('returns discrepancy calculation fallback when service returns null', async () => {
    vi.spyOn(autoPairingService, 'calculateDiscrepancy').mockResolvedValue(null);

    const res = await request(app).post('/api/accounts/calculate-discrepancy').send({ pairingId: 3 }).expect(200);
    expect(res.body).toEqual({ exists: false });
  });

  it('handles discrepancy calculation errors', async () => {
    vi.spyOn(autoPairingService, 'calculateDiscrepancy').mockRejectedValue({
      status: 422,
      message: 'invalid pairing',
    });

    const res = await request(app).post('/api/accounts/calculate-discrepancy').send({ pairingId: 3 }).expect(422);
    expect(res.body.error).toBe('invalid pairing');
  });

  it('resolves discrepancy using route param pairing id', async () => {
    const resolveSpy = vi.spyOn(discrepancyService, 'resolveDiscrepancy').mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/accounts/pairing/15/resolve-discrepancy')
      .send({ resolution: 'accept' })
      .expect(200);

    expect(res.body).toEqual({ success: true });
    expect(resolveSpy).toHaveBeenCalledWith({ pairingId: 15, resolution: 'accept' });
  });

  it('returns discrepancy status fallback and handles status errors', async () => {
    const statusSpy = vi.spyOn(discrepancyService, 'getDiscrepancyStatus')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce({ statusCode: 500, message: 'status failed' });

    const fallback = await request(app).get('/api/accounts/pairing/33/discrepancy-status').expect(200);
    expect(fallback.body).toEqual({ acknowledged: false });
    expect(statusSpy).toHaveBeenCalledWith(33);

    const failed = await request(app).get('/api/accounts/pairing/33/discrepancy-status').expect(500);
    expect(failed.body.error).toBe('status failed');
  });

  it('handles resolve discrepancy errors', async () => {
    vi.spyOn(discrepancyService, 'resolveDiscrepancy').mockRejectedValue({
      status: 400,
      message: 'cannot resolve',
    });

    const res = await request(app)
      .post('/api/accounts/pairing/20/resolve-discrepancy')
      .send({ resolution: 'reject' })
      .expect(400);

    expect(res.body.error).toBe('cannot resolve');
  });

  it('handles service failures across remaining account endpoints', async () => {
    vi.spyOn(lastUpdateService, 'listAccountLastUpdates').mockRejectedValue({
      status: 502,
      message: 'last-update failed',
    });
    vi.spyOn(pairingsService, 'createPairing').mockRejectedValue({
      statusCode: 422,
      message: 'create failed',
    });
    vi.spyOn(pairingsService, 'updatePairing').mockRejectedValue({
      status: 409,
      message: 'update failed',
    });
    vi.spyOn(pairingsService, 'deletePairing').mockRejectedValue({
      status: 410,
      message: 'delete failed',
    });
    vi.spyOn(unpairedService, 'getTrulyUnpairedTransactions').mockRejectedValue({
      status: 503,
      message: 'unpaired list failed',
    });
    vi.spyOn(lastTransactionDateService, 'getLastTransactionDate').mockRejectedValue({
      statusCode: 500,
      message: 'last-date failed',
    });
    vi.spyOn(smartMatchService, 'findSmartMatches').mockRejectedValue({
      status: 429,
      message: 'smart-match failed',
    });
    vi.spyOn(creditCardDetectorService, 'detectCreditCardSuggestions').mockRejectedValue({
      status: 500,
      message: 'suggestions failed',
    });

    const lastUpdateRes = await request(app).get('/api/accounts/last-update').expect(502);
    expect(lastUpdateRes.body.error).toBe('last-update failed');

    const createPairingRes = await request(app).post('/api/accounts/pairing').send({}).expect(422);
    expect(createPairingRes.body.error).toBe('create failed');

    const updatePairingRes = await request(app).put('/api/accounts/pairing').send({ id: 1 }).expect(409);
    expect(updatePairingRes.body.error).toBe('update failed');

    const deletePairingRes = await request(app).delete('/api/accounts/pairing?id=1').expect(410);
    expect(deletePairingRes.body.error).toBe('delete failed');

    const unpairedRes = await request(app).get('/api/accounts/truly-unpaired-transactions').expect(503);
    expect(unpairedRes.body.error).toBe('unpaired list failed');

    const lastDateRes = await request(app).get('/api/accounts/last-transaction-date').expect(500);
    expect(lastDateRes.body.error).toBe('last-date failed');

    const smartMatchRes = await request(app).post('/api/accounts/smart-match').send({}).expect(429);
    expect(smartMatchRes.body.error).toBe('smart-match failed');

    const suggestionsRes = await request(app).get('/api/accounts/credit-card-suggestions').expect(500);
    expect(suggestionsRes.body.error).toBe('suggestions failed');
  });
});
