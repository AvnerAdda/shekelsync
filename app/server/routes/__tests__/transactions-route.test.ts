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
  app.get('/api/box_panel_data', transactionsHandlers.getBoxPanelData);
  app.get('/api/category_by_month', transactionsHandlers.getCategoryByMonth);
  app.get('/api/transactions/recent', transactionsHandlers.getRecentTransactions);
  app.get('/api/transactions/search', transactionsHandlers.searchTransactions);
  app.get('/api/category_expenses', transactionsHandlers.getCategoryExpenses);
  app.get('/api/expenses_by_month', transactionsHandlers.getExpensesByMonth);
  app.get('/api/month_by_categories', transactionsHandlers.getMonthByCategories);
  app.post('/api/manual_transaction', transactionsHandlers.createManualTransaction);
  app.put('/api/transactions/:id', transactionsHandlers.updateTransaction);
  app.put('/api/transactions', transactionsHandlers.updateTransaction);
  app.delete('/api/transactions/:id', transactionsHandlers.deleteTransaction);
  app.delete('/api/transactions', transactionsHandlers.deleteTransaction);
  app.get('/api/transactions/tags', transactionsHandlers.getAllTags);
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

  it('returns box panel data', async () => {
    const payload = { categories: 5, nonMapped: 1, allTransactions: 10, lastMonth: '01-01-2025' };
    const spy = vi.spyOn(metricsService, 'getBoxPanelData').mockResolvedValue(payload);

    const res = await request(app).get('/api/box_panel_data').expect(200);

    expect(res.body).toEqual(payload);
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

  it('returns category spending timeline', async () => {
    const payload = [{ amount: -50, year: '2025' }];
    const spy = vi.spyOn(metricsService, 'getCategorySpendingTimeline').mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/category_by_month?category=Food&month=3&groupByYear=true')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ category: 'Food', month: '3', groupByYear: 'true' });
  });

  it('returns expenses by month', async () => {
    const payload = [{ amount: -100, year: '2024' }];
    const spy = vi.spyOn(metricsService, 'getExpensesByMonth').mockResolvedValue(payload);

    const res = await request(app).get('/api/expenses_by_month?month=6&groupByYear=false').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ month: '6', groupByYear: 'false' });
  });

  it('returns month by categories data', async () => {
    const payload = [{ category_definition_id: 1, value: 20 }];
    const spy = vi.spyOn(metricsService, 'getMonthByCategories').mockResolvedValue(payload);

    const res = await request(app).get('/api/month_by_categories?month=2025-01').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ month: '2025-01' });
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

  it('rejects transaction update when id missing', async () => {
    const res = await request(app).put('/api/transactions').send({ price: 10 }).expect(400);
    expect(res.body.error).toMatch(/ID parameter is required/i);
  });

  it('rejects transaction update when no updatable fields provided', async () => {
    const res = await request(app).put('/api/transactions/abc').send({}).expect(400);
    expect(res.body.error).toMatch(/updatable field/i);
  });

  it('deletes a transaction', async () => {
    const payload = { success: true };
    vi.spyOn(adminService, 'deleteTransaction').mockResolvedValue(payload);

    const res = await request(app).delete('/api/transactions/abc').expect(200);

    expect(res.body).toEqual(payload);
    expect(adminService.deleteTransaction).toHaveBeenCalledWith('abc');
  });

  it('rejects delete when id missing', async () => {
    const res = await request(app).delete('/api/transactions').expect(400);
    expect(res.body.error).toMatch(/ID parameter is required/i);
  });

  it('returns all tags', async () => {
    vi.spyOn(listService, 'getAllTags').mockResolvedValue(['rent', 'groceries']);

    const res = await request(app).get('/api/transactions/tags').expect(200);

    expect(res.body).toEqual(['rent', 'groceries']);
  });

  it('propagates service errors across remaining handlers', async () => {
    vi.spyOn(metricsService, 'listAvailableMonths').mockRejectedValue({
      status: 502,
      message: 'months failed',
    });
    await request(app).get('/api/available_months').expect(502);

    vi.spyOn(metricsService, 'getBoxPanelData').mockRejectedValue(new Error('box failed'));
    const boxRes = await request(app).get('/api/box_panel_data').expect(500);
    expect(boxRes.body.error).toMatch(/box failed/i);

    vi.spyOn(metricsService, 'getCategorySpendingTimeline').mockRejectedValue({
      status: 503,
      message: 'timeline failed',
    });
    await request(app).get('/api/category_by_month').expect(503);

    vi.spyOn(metricsService, 'getExpensesByMonth').mockRejectedValue({
      status: 501,
      message: 'expenses failed',
    });
    await request(app).get('/api/expenses_by_month').expect(501);

    vi.spyOn(metricsService, 'getMonthByCategories').mockRejectedValue({
      status: 504,
      message: 'month-by-categories failed',
    });
    await request(app).get('/api/month_by_categories').expect(504);

    vi.spyOn(listService, 'listRecentTransactions').mockRejectedValue({
      status: 500,
      message: 'recent failed',
    });
    await request(app).get('/api/transactions/recent').expect(500);

    vi.spyOn(listService, 'searchTransactions').mockRejectedValue({
      status: 500,
      message: 'search failed',
    });
    await request(app).get('/api/transactions/search').expect(500);

    vi.spyOn(adminService, 'createManualTransaction').mockRejectedValue({
      status: 500,
      message: 'create failed',
    });
    await request(app).post('/api/manual_transaction').send({}).expect(500);

    vi.spyOn(adminService, 'updateTransaction').mockRejectedValue({
      status: 409,
      message: 'update failed',
    });
    const updateRes = await request(app)
      .put('/api/transactions/abc')
      .send({ memo: 'x' })
      .expect(409);
    expect(updateRes.body.error).toMatch(/update failed/i);

    vi.spyOn(adminService, 'deleteTransaction').mockRejectedValue({
      status: 410,
      message: 'delete failed',
    });
    const deleteRes = await request(app).delete('/api/transactions/abc').expect(410);
    expect(deleteRes.body.error).toMatch(/delete failed/i);

    vi.spyOn(listService, 'getAllTags').mockRejectedValue({
      status: 500,
      message: 'tags failed',
    });
    const tagsRes = await request(app).get('/api/transactions/tags').expect(500);
    expect(tagsRes.body.error).toMatch(/tags failed/i);
  });
});
