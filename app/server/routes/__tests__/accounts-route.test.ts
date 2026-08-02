import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared accounts router under test
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAccountsRouter } = require('../../routes/accounts.js');

// Backing services to be mocked
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lastUpdateService = require('../../services/accounts/last-update.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pairingsService = require('../../services/accounts/pairings.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lastTransactionDateService = require('../../services/accounts/last-transaction-date.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const creditCardDetectorService = require('../../services/accounts/credit-card-detector.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const autoPairingService = require('../../services/accounts/auto-pairing.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pairingMatchDetailsService = require('../../services/accounts/pairing-match-details.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const currentMonthPairingGapService = require('../../services/accounts/current-month-pairing-gap.js');

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

  it('fetches last transaction date', async () => {
    vi.spyOn(lastTransactionDateService, 'getLastTransactionDate').mockResolvedValue({ date: '2025-01-01' });

    const lastDate = await request(app).get('/api/accounts/last-transaction-date').expect(200);
    expect(lastDate.body).toEqual({ date: '2025-01-01' });
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

  it('returns current month pairing gap summary', async () => {
    const payload = {
      windowDays: 30,
      windowStartDate: '2026-02-08',
      windowEndDate: '2026-03-08',
      tolerance: 2,
      totals: {
        bankAmount: 1000,
        cardAmount: 900,
        missingAmount: 100,
        affectedPairingsCount: 1,
        affectedCyclesCount: 1,
      },
      pairings: [{ pairingId: 12, missingAmount: 100 }],
      generatedAt: '2026-03-08T00:00:00.000Z',
    };
    const spy = vi
      .spyOn(currentMonthPairingGapService, 'getCurrentMonthPairingGap')
      .mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/accounts/pairing/current-month-gap?days=30')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ days: 30 });
  });

  it('validates current month pairing gap days param', async () => {
    const spy = vi
      .spyOn(currentMonthPairingGapService, 'getCurrentMonthPairingGap')
      .mockResolvedValue({});

    const zeroDays = await request(app)
      .get('/api/accounts/pairing/current-month-gap?days=0')
      .expect(400);
    expect(zeroDays.body.error).toContain('days');

    const invalidMixed = await request(app)
      .get('/api/accounts/pairing/current-month-gap?days=10abc')
      .expect(400);
    expect(invalidMixed.body.error).toContain('days');

    const outOfRange = await request(app)
      .get('/api/accounts/pairing/current-month-gap?days=31')
      .expect(400);
    expect(outOfRange.body.error).toContain('days');

    expect(spy).not.toHaveBeenCalled();
  });

  it('handles current month pairing gap service errors', async () => {
    vi.spyOn(currentMonthPairingGapService, 'getCurrentMonthPairingGap').mockRejectedValue({
      status: 503,
      message: 'pairing gap unavailable',
    });

    const res = await request(app)
      .get('/api/accounts/pairing/current-month-gap')
      .expect(503);
    expect(res.body.error).toBe('pairing gap unavailable');
  });

  it('returns pairing match details for a valid pairing id', async () => {
    const payload = {
      pairing: { id: 15 },
      summary: { cyclesCount: 1 },
      cycles: [{ cycleDate: '2026-02-09', repayments: [], cardTransactions: [] }],
    };
    const spy = vi.spyOn(pairingMatchDetailsService, 'getPairingMatchDetails').mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/accounts/pairing/15/match-details?monthsBack=6&cycleDate=2026-02-09')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ pairingId: 15, monthsBack: 6, cycleDate: '2026-02-09' });
  });

  it('validates match details query params before calling service', async () => {
    const spy = vi.spyOn(pairingMatchDetailsService, 'getPairingMatchDetails').mockResolvedValue({
      pairing: {},
      summary: {},
      cycles: [],
    });

    const invalidId = await request(app).get('/api/accounts/pairing/abc/match-details').expect(400);
    expect(invalidId.body.error).toContain('pairingId');

    const invalidMixedId = await request(app).get('/api/accounts/pairing/10abc/match-details').expect(400);
    expect(invalidMixedId.body.error).toContain('pairingId');

    const invalidMonthsBack = await request(app)
      .get('/api/accounts/pairing/10/match-details?monthsBack=0')
      .expect(400);
    expect(invalidMonthsBack.body.error).toContain('monthsBack');

    const invalidMixedMonthsBack = await request(app)
      .get('/api/accounts/pairing/10/match-details?monthsBack=6abc')
      .expect(400);
    expect(invalidMixedMonthsBack.body.error).toContain('monthsBack');

    const invalidCycleDate = await request(app)
      .get('/api/accounts/pairing/10/match-details?cycleDate=2026/02/09')
      .expect(400);
    expect(invalidCycleDate.body.error).toContain('cycleDate');

    expect(spy).not.toHaveBeenCalled();
  });

  it('handles pairing match details service errors', async () => {
    vi.spyOn(pairingMatchDetailsService, 'getPairingMatchDetails').mockRejectedValue({
      statusCode: 503,
      message: 'pairing details unavailable',
    });

    const res = await request(app).get('/api/accounts/pairing/15/match-details').expect(503);
    expect(res.body.error).toBe('pairing details unavailable');
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
    vi.spyOn(lastTransactionDateService, 'getLastTransactionDate').mockRejectedValue({
      statusCode: 500,
      message: 'last-date failed',
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

    const lastDateRes = await request(app).get('/api/accounts/last-transaction-date').expect(500);
    expect(lastDateRes.body.error).toBe('last-date failed');

    const suggestionsRes = await request(app).get('/api/accounts/credit-card-suggestions').expect(500);
    expect(suggestionsRes.body.error).toBe('suggestions failed');
  });

  it('does not expose retired account endpoints', async () => {
    const requests = [
      request(app).get('/api/accounts/find-settlement-candidates'),
      request(app).get('/api/accounts/truly-unpaired-transactions'),
      request(app).get('/api/accounts/unpaired-transactions-count'),
      request(app).post('/api/accounts/smart-match'),
      request(app).post('/api/accounts/find-bank-account'),
      request(app).post('/api/accounts/calculate-discrepancy'),
      request(app).post('/api/accounts/pairing/1/resolve-discrepancy'),
      request(app).get('/api/accounts/pairing/1/discrepancy-status'),
    ];

    const responses = await Promise.all(requests);
    responses.forEach((response) => expect(response.status).toBe(404));
  });
});
