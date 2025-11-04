import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared handlers
// eslint-disable-next-line @typescript-eslint/no-var-requires
const transactionsHandlers = require('../../routes/transactions.js');

// Backing services
// eslint-disable-next-line @typescript-eslint/no-var-requires
const metricsService = require('../../services/transactions/metrics.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const listService = require('../../services/transactions/list.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const adminService = require('../../services/transactions/admin.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/available_months', transactionsHandlers.getAvailableMonths);
  app.get('/api/transactions/recent', transactionsHandlers.getRecentTransactions);
  app.get('/api/transactions/search', transactionsHandlers.searchTransactions);
  app.get('/api/category_expenses', transactionsHandlers.getCategoryExpenses);
  app.post('/api/manual_transaction', transactionsHandlers.createManualTransaction);
  app.put('/api/transactions/:id', transactionsHandlers.updateTransaction);
  app.delete('/api/transactions/:id', transactionsHandlers.deleteTransaction);
  return app;
}

describe('Electron transaction endpoints', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns available months', async () => {
    const months = ['2025-11', '2025-10'];
    const spy = vi.spyOn(metricsService, 'listAvailableMonths').mockResolvedValue(months);

    const res = await request(app).get('/api/available_months').expect(200);

    expect(res.body).toEqual(months);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('lists recent transactions', async () => {
    const payload = { transactions: [{ identifier: 't-1' }], count: 1, hasMore: false };
    const spy = vi.spyOn(listService, 'listRecentTransactions').mockResolvedValue(payload);

    const res = await request(app).get('/api/transactions/recent?limit=5').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ limit: '5' });
  });

  it('searches transactions', async () => {
    const payload = { transactions: [], count: 0, filters: {} };
    const spy = vi.spyOn(listService, 'searchTransactions').mockResolvedValue(payload);

    const res = await request(app).get('/api/transactions/search?vendor=acme').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ vendor: 'acme' });
  });

  it('propagates metric service errors', async () => {
    vi.spyOn(metricsService, 'getCategoryExpenses').mockRejectedValue({
      status: 422,
      message: 'invalid params',
    });

    const res = await request(app).get('/api/category_expenses').expect(422);
    expect(res.body.error).toMatch(/invalid params/i);
  });

  it('creates a manual transaction', async () => {
    const payload = { id: 'txn-123' };
    vi.spyOn(adminService, 'createManualTransaction').mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/manual_transaction')
      .send({ description: 'Manual' })
      .expect(200);

    expect(res.body).toEqual(payload);
  });

  it('updates a transaction', async () => {
    const payload = { success: true };
    vi.spyOn(adminService, 'updateTransaction').mockResolvedValue(payload);

    const res = await request(app)
      .put('/api/transactions/abc')
      .send({ category_definition_id: 123 })
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(adminService.updateTransaction).toHaveBeenCalledWith('abc', {
      category_definition_id: 123,
    });
  });

  it('deletes a transaction', async () => {
    const payload = { success: true };
    vi.spyOn(adminService, 'deleteTransaction').mockResolvedValue(payload);

    const res = await request(app).delete('/api/transactions/abc').expect(200);

    expect(res.body).toEqual(payload);
    expect(adminService.deleteTransaction).toHaveBeenCalledWith('abc');
  });
});
