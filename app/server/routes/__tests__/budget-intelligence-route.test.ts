import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createBudgetIntelligenceRouter = require('../../routes/budget-intelligence.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const budgetIntelligenceService = require('../../services/analytics/budget-intelligence.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/budget-intelligence', createBudgetIntelligenceRouter());
  return app;
}

describe('Budget intelligence routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates budget suggestions', async () => {
    const payload = { suggestions: [] };
    vi.spyOn(budgetIntelligenceService, 'generateBudgetSuggestions').mockResolvedValue(payload);

    const res = await request(app).post('/api/budget-intelligence/generate').expect(200);
    expect(res.body).toEqual(payload);
  });

  it('returns suggestions', async () => {
    const payload = [{ id: 1 }];
    vi.spyOn(budgetIntelligenceService, 'getBudgetSuggestions').mockResolvedValue(payload);

    const res = await request(app).get('/api/budget-intelligence/suggestions').expect(200);
    expect(res.body).toEqual(payload);
  });

  it('activates suggestion and validates id', async () => {
    const payload = { success: true };
    vi.spyOn(budgetIntelligenceService, 'activateBudgetSuggestion').mockResolvedValue(payload);

    const res = await request(app).post('/api/budget-intelligence/suggestions/10/activate').expect(200);
    expect(res.body).toEqual(payload);
  });

  it('returns 400 for invalid activation id', async () => {
    const res = await request(app).post('/api/budget-intelligence/suggestions/not-a-number/activate').expect(400);
    expect(res.body.error).toMatch(/Invalid suggestion ID/);
  });

  it('returns trajectory and health', async () => {
    vi.spyOn(budgetIntelligenceService, 'getBudgetTrajectory').mockResolvedValue({ points: [] });
    vi.spyOn(budgetIntelligenceService, 'getBudgetHealth').mockResolvedValue({ score: 90 });

    const trajectory = await request(app).get('/api/budget-intelligence/trajectory?budgetId=1').expect(200);
    expect(trajectory.body).toEqual({ points: [] });

    const health = await request(app).get('/api/budget-intelligence/health').expect(200);
    expect(health.body).toEqual({ score: 90 });
  });

  it('handles service errors', async () => {
    vi.spyOn(budgetIntelligenceService, 'getBudgetSuggestions').mockRejectedValue(
      Object.assign(new Error('fail'), { status: 502 }),
    );

    const res = await request(app).get('/api/budget-intelligence/suggestions').expect(502);
    expect(res.body.success).toBe(false);
  });
});
