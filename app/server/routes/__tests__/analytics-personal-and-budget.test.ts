import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Routers
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAnalyticsRouter } = require('../../routes/analytics.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createBudgetRouter = require('../../routes/budget-intelligence.js');

// Services
// eslint-disable-next-line @typescript-eslint/no-var-requires
const personalIntelligenceService = require('../../services/analytics/personal-intelligence.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const budgetIntelligenceService = require('../../services/analytics/budget-intelligence.js');

function buildApp() {
  const app = express();
  app.use('/api/analytics', createAnalyticsRouter());
  app.use('/api/budget-intelligence', createBudgetRouter());
  return app;
}

describe('Analytics + Budget Intelligence routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns personal intelligence payload with health score', async () => {
    const payload = {
      overallHealthScore: 92,
      healthBreakdown: { savingsScore: 90, diversityScore: 85, impulseScore: 95, runwayScore: 98 },
      warnings: [],
    };
    const spy = vi
      .spyOn(personalIntelligenceService, 'getPersonalIntelligence')
      .mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/analytics/personal-intelligence?months=3')
      .expect(200);

    expect(res.body.overallHealthScore).toBe(92);
    expect(res.body.healthBreakdown).toMatchObject(payload.healthBreakdown);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ months: '3' }));
  });

  it('returns budget health with populated budgets', async () => {
    const payload = {
      success: true,
      budgets: [
        {
          category_id: 1,
          category_name: 'Groceries',
          budget_limit: 1000,
          current_spent: 600,
          percentage_used: 60,
          days_remaining: 10,
          projected_total: 900,
          daily_limit: 40,
          status: 'on_track',
        },
      ],
      overall_status: 'good',
      summary: { total_budgets: 1, on_track: 1, warning: 0, exceeded: 0, total_budget: 1000, total_spent: 600 },
    };
    const spy = vi
      .spyOn(budgetIntelligenceService, 'getBudgetHealth')
      .mockResolvedValue(payload);

    const res = await request(app).get('/api/budget-intelligence/health').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.budgets).toHaveLength(1);
    expect(res.body.budgets[0].status).toBe('on_track');
    expect(spy).toHaveBeenCalledWith();
  });

  it('returns budget suggestions with active marker', async () => {
    const payload = {
      suggestions: [
        {
          id: 1,
          category_definition_id: 10,
          category_name: 'Transport',
          suggested_limit: 500,
          confidence_score: 0.8,
          based_on_months: 6,
          is_active: true,
          has_active_budget: true,
        },
      ],
    };
    const spy = vi
      .spyOn(budgetIntelligenceService, 'getBudgetSuggestions')
      .mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/budget-intelligence/suggestions?minConfidence=0.5')
      .expect(200);

    expect(res.body.suggestions[0].has_active_budget).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ minConfidence: '0.5' }));
  });
});
