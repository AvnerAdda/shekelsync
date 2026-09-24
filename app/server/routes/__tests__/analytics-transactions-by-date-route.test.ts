// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAnalyticsRouter } = require('../analytics.js');
const database = require('../../services/database.js');

describe('analytics transaction period route', () => {
  let app: express.Express;
  let query: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    app = express();
    app.use('/api/analytics', createAnalyticsRouter());
    query = vi.spyOn(database, 'query').mockResolvedValue({ rows: [] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['date=2026-09-24', ['2026-09-24', '2026-09-25']],
    ['startDate=2026-09-21&endDate=2026-09-27', ['2026-09-21', '2026-09-28']],
    ['startDate=2026-09-01&endDate=2026-09-30', ['2026-09-01', '2026-10-01']],
  ])('accepts inclusive day, week, or month queries: %s', async (queryString, bounds) => {
    const response = await request(app).get(`/api/analytics/transactions-by-date?${queryString}`).expect(200);

    expect(response.body).toEqual({ transactions: [] });
    expect(query).toHaveBeenCalledWith(expect.any(String), bounds);
  });

  it.each([
    '',
    'startDate=2026-09-21',
    'endDate=2026-09-27',
    'startDate=2026-09-28&endDate=2026-09-21',
    'startDate=2026-09-21&endDate=2026-09-31',
  ])('returns 400 for incomplete, inverted, or invalid period queries: %s', async queryString => {
    const response = await request(app).get(`/api/analytics/transactions-by-date?${queryString}`).expect(400);

    expect(response.body.error).toEqual(expect.any(String));
    expect(query).not.toHaveBeenCalled();
  });
});
