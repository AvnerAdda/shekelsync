import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared budgets router
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createBudgetsRouter } = require('../../routes/budgets.js');

// Backing service
// eslint-disable-next-line @typescript-eslint/no-var-requires
const budgetsService = require('../../services/budgets.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/budgets', createBudgetsRouter());
  return app;
}

describe('Electron /api/budgets routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists budgets', async () => {
    const budgets = [{ id: '1', name: 'Housing' }];
    const spy = vi.spyOn(budgetsService, 'listBudgets').mockResolvedValue(budgets);

    const res = await request(app).get('/api/budgets').expect(200);

    expect(res.body).toEqual(budgets);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('creates a budget', async () => {
    const payload = { id: '1', name: 'Transport' };
    const spy = vi.spyOn(budgetsService, 'upsertBudget').mockResolvedValue(payload);

    const res = await request(app).post('/api/budgets').send({ name: 'Transport' }).expect(201);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ name: 'Transport' });
  });

  it('returns usage data', async () => {
    const usage = [{ budgetId: '1', percentage: 50 }];
    const spy = vi.spyOn(budgetsService, 'listBudgetUsage').mockResolvedValue(usage);

    const res = await request(app).get('/api/budgets/usage').expect(200);

    expect(res.body).toEqual(usage);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('propagates service errors', async () => {
    vi.spyOn(budgetsService, 'listBudgets').mockRejectedValue({
      status: 503,
      message: 'unavailable',
    });

    const res = await request(app).get('/api/budgets').expect(503);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/unavailable/i);
  });
});
