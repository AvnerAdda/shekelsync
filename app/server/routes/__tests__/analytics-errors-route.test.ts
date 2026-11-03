// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createAnalyticsRouter } = require('../analytics.js');
const service = require('../../services/analytics/unified-category.js');

describe('unified category error responses', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['DATABASE_ERROR', 500, 'Failed to fetch analytics data'],
    ['INVALID_CATEGORY', 400, 'Invalid category parameters'],
    ['INVALID_TYPE', 400, 'Invalid transaction type'],
    ['INVALID_GROUP_BY', 400, 'Invalid grouping option'],
    ['__proto__', 500, 'Failed to fetch analytics data'],
  ])('sanitizes structured %s errors', async (code, status, message) => {
    const privateDetail = '/private/bank.sqlite; SQL and stack trace';
    vi.spyOn(service, 'getUnifiedCategoryAnalytics').mockRejectedValue({
      error: { code, message: privateDetail, details: { stack: privateDetail } },
      stack: privateDetail,
      password: privateDetail,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.use('/api/analytics', createAnalyticsRouter());

    const res = await request(app).get('/api/analytics/unified-category').expect(status);

    expect(res.body).toEqual({
      success: false,
      error: { code: status === 400 ? code : 'DATABASE_ERROR', message },
    });
    expect(JSON.stringify(res.body)).not.toContain(privateDetail);
  });

  it.each([new Error('/private/bank.sqlite'), null])('sanitizes unstructured failures', async (error) => {
    vi.spyOn(service, 'getUnifiedCategoryAnalytics').mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.use('/api/analytics', createAnalyticsRouter());

    const res = await request(app).get('/api/analytics/unified-category').expect(500);

    expect(res.body).toEqual({
      success: false,
      error: { code: 'DATABASE_ERROR', message: 'Failed to fetch analytics data' },
    });
  });
});
