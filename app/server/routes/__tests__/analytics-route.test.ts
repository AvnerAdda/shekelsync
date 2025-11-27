import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared analytics router
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAnalyticsRouter } = require('../../routes/analytics.js');
// Backing services
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dashboardService = require('../../services/analytics/dashboard.js');
const breakdownService = require('../../services/analytics/breakdown.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const waterfallService = require('../../services/analytics/waterfall.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const categoryOpportunitiesService = require('../../services/analytics/category-opportunities.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const unifiedCategoryService = require('../../services/analytics/unified-category.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const personalIntelligenceService = require('../../services/analytics/personal-intelligence.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const recurringAnalysisService = require('../../services/analytics/recurring-analysis.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const healthScoreService = require('../../services/analytics/health-score-roadmap.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const actionabilitySettingsService = require('../../services/analytics/actionability-settings.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const categoryDetailsService = require('../../services/analytics/category-details.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const categorySpendingService = require('../../services/analytics/category-spending-summary.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const recurringManagementService = require('../../services/analytics/recurring-management.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const transactionsByDateService = require('../../services/analytics/transactions-by-date.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const investmentsAnalyticsService = require('../../services/analytics/investments.js');

function buildApp() {
  const app = express();
  app.use('/api/analytics', createAnalyticsRouter());
  return app;
}

describe('Electron /api/analytics routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns dashboard analytics payload', async () => {
    const payload = {
      summary: { income: 1000, expenses: 500 },
      history: [],
    };
    const spy = vi
      .spyOn(dashboardService, 'getDashboardAnalytics')
      .mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/analytics/dashboard?aggregation=daily')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ aggregation: 'daily' }),
    );
  });

  it('returns 500 when dashboard analytics fail', async () => {
    vi.spyOn(dashboardService, 'getDashboardAnalytics').mockRejectedValue(
      new Error('boom'),
    );

    const res = await request(app).get('/api/analytics/dashboard').expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/failed/i);
  });

  it('returns breakdown analytics payload with trend fields', async () => {
    const payload = {
      breakdowns: {
        byCategory: [
          {
            parentId: 1,
            category: 'Dining',
            total: 100,
            previousTotal: 80,
            history: [{ month: '2025-01', total: 80 }],
            count: 2,
            subcategories: [],
          },
        ],
        byVendor: [
          {
            vendor: 'Cafe XYZ',
            total: 60,
            previousTotal: 40,
            history: [{ month: '2025-01', total: 40 }],
            count: 2,
          },
        ],
        byMonth: [],
      },
      summary: { total: 100, count: 2, average: 50 },
      dateRange: {
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-01-31T00:00:00.000Z',
      },
      transactions: [],
    };
    const spy = vi.spyOn(breakdownService, 'getBreakdownAnalytics').mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/analytics/breakdown?type=expense&months=1')
      .expect(200);

    expect(res.body.breakdowns.byVendor[0].previousTotal).toBe(40);
    expect(res.body.breakdowns.byCategory[0].history).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'expense', months: '1' }));
  });

  it('handles breakdown analytics errors', async () => {
    vi.spyOn(breakdownService, 'getBreakdownAnalytics').mockRejectedValue(
      Object.assign(new Error('bad request'), { status: 422 }),
    );

    const res = await request(app).get('/api/analytics/breakdown').expect(422);
    expect(res.body.error).toMatch(/failed/i);
  });

  it('returns 400 for unified-category validation errors', async () => {
    vi.spyOn(unifiedCategoryService, 'getUnifiedCategoryAnalytics').mockRejectedValue({
      success: false,
      error: { code: 'INVALID_CATEGORY', message: 'invalid' },
    });

    const res = await request(app).get('/api/analytics/unified-category').expect(400);
    expect(res.body.error.code).toBe('INVALID_CATEGORY');
  });

  it('returns 500 for unified-category database errors', async () => {
    vi.spyOn(unifiedCategoryService, 'getUnifiedCategoryAnalytics').mockRejectedValue({
      success: false,
      error: { code: 'DATABASE_ERROR', message: 'db down' },
    });

    const res = await request(app).get('/api/analytics/unified-category').expect(500);
    expect(res.body.error.code).toBe('DATABASE_ERROR');
  });

  it('returns waterfall analytics payload', async () => {
    const payload = {
      summary: { totalIncome: 1000, totalExpenses: 500, netInvestments: 100 },
      waterfallData: [],
    };
    const spy = vi.spyOn(waterfallService, 'getWaterfallAnalytics').mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/analytics/waterfall-flow?months=6')
      .expect(200);

    expect(res.body.summary.netInvestments).toBe(100);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ months: '6' }));
  });

  it('handles category opportunities errors with status code', async () => {
    vi.spyOn(categoryOpportunitiesService, 'getCategoryOpportunities').mockRejectedValue(
      Object.assign(new Error('bad'), { status: 503 }),
    );

    const res = await request(app).get('/api/analytics/category-opportunities').expect(503);
    expect(res.body.error).toMatch(/failed/i);
  });

  it('returns personal intelligence and recurring analysis payloads', async () => {
    vi.spyOn(personalIntelligenceService, 'getPersonalIntelligence').mockResolvedValue({ insights: [] });
    vi.spyOn(recurringAnalysisService, 'getRecurringAnalysis').mockResolvedValue({ recurring: [] });

    const personal = await request(app).get('/api/analytics/personal-intelligence').expect(200);
    expect(personal.body).toEqual({ insights: [] });

    const recurring = await request(app).get('/api/analytics/recurring-analysis').expect(200);
    expect(recurring.body).toEqual({ recurring: [] });
  });

  it('returns health score roadmap and category details/spending', async () => {
    vi.spyOn(healthScoreService, 'getHealthScoreRoadmap').mockResolvedValue({ roadmap: [] });
    vi.spyOn(categoryDetailsService, 'getCategoryDetails').mockResolvedValue({ details: [] });
    vi.spyOn(categorySpendingService, 'getCategorySpendingSummary').mockResolvedValue({ spending: [] });

    const health = await request(app).get('/api/analytics/health-score-roadmap').expect(200);
    expect(health.body).toEqual({ roadmap: [] });

    const details = await request(app).get('/api/analytics/category-details').expect(200);
    expect(details.body).toEqual({ details: [] });

    const summary = await request(app).get('/api/analytics/category-spending-summary').expect(200);
    expect(summary.body).toEqual({ spending: [] });
  });

  it('surfaces errors for actionability and recurring endpoints', async () => {
    vi.spyOn(actionabilitySettingsService, 'listSettings').mockRejectedValue(
      Object.assign(new Error('fail'), { status: 418 }),
    );
    vi.spyOn(recurringManagementService, 'updateRecurringStatus').mockRejectedValue(
      Object.assign(new Error('bad'), { status: 500 }),
    );

    const list = await request(app).get('/api/analytics/actionability-settings').expect(418);
    expect(list.body.error).toMatch(/fail/);

    const recur = await request(app).post('/api/analytics/recurring-management').send({}).expect(500);
    expect(recur.body.error).toBeDefined();
  });

  it('manages actionability settings lifecycle', async () => {
    vi.spyOn(actionabilitySettingsService, 'listSettings').mockResolvedValue([{ id: 1 }]);
    vi.spyOn(actionabilitySettingsService, 'bulkUpsertSettings').mockResolvedValue({ updated: 2 });
    vi.spyOn(actionabilitySettingsService, 'updateSetting').mockResolvedValue({ id: 1, value: true });
    vi.spyOn(actionabilitySettingsService, 'resetSettings').mockResolvedValue({ reset: true });

    const list = await request(app).get('/api/analytics/actionability-settings').expect(200);
    expect(list.body).toEqual([{ id: 1 }]);

    const bulk = await request(app).post('/api/analytics/actionability-settings').send({}).expect(200);
    expect(bulk.body).toEqual({ updated: 2 });

    const update = await request(app).put('/api/analytics/actionability-settings').send({ id: 1 }).expect(200);
    expect(update.body).toEqual({ id: 1, value: true });

    const reset = await request(app).delete('/api/analytics/actionability-settings').expect(200);
    expect(reset.body).toEqual({ reset: true });
  });

  it('updates recurring management and lists transactions by date', async () => {
    vi.spyOn(recurringManagementService, 'updateRecurringStatus').mockResolvedValue({ success: true });
    vi.spyOn(transactionsByDateService, 'listTransactionsByDate').mockResolvedValue({ items: [] });

    const recur = await request(app).post('/api/analytics/recurring-management').send({ id: 1 }).expect(200);
    expect(recur.body).toEqual({ success: true });

    const txns = await request(app).get('/api/analytics/transactions-by-date?start=2025-01-01').expect(200);
    expect(txns.body).toEqual({ items: [] });
  });

  it('returns investments analytics and handles errors with 500', async () => {
    vi.spyOn(investmentsAnalyticsService, 'getInvestmentsAnalytics').mockResolvedValue({ holdings: [] });

    const res = await request(app).get('/api/analytics/investments').expect(200);
    expect(res.body).toEqual({ holdings: [] });

    vi.spyOn(investmentsAnalyticsService, 'getInvestmentsAnalytics').mockRejectedValue(new Error('fail'));
    const errRes = await request(app).get('/api/analytics/investments').expect(500);
    expect(errRes.body.error).toMatch(/Failed to fetch investment analytics/);
  });
});
