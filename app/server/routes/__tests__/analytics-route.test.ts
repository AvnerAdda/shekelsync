import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared analytics router
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAnalyticsRouter } = require('../../routes/analytics.js');
// Backing services
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dashboardService = require('../../services/analytics/dashboard.js');

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
});
