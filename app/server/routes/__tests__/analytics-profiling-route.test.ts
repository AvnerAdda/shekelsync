import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAnalyticsProfilingRouter } = require('../../routes/analytics-profiling.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const profilingService = require('../../services/analytics/profiling.js');

function buildApp(locale = 'en') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.locale = locale;
    next();
  });
  app.use('/api/analytics', createAnalyticsProfilingRouter());
  return app;
}

describe('Shared /api/analytics profiling routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp('fr');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns profiling status', async () => {
    const statusPayload = {
      missingFields: [],
      isStale: false,
      staleReasons: [],
      assessment: null,
    };
    const spy = vi.spyOn(profilingService, 'getProfilingStatus').mockResolvedValue(statusPayload);

    const res = await request(app).get('/api/analytics/profiling').expect(200);

    expect(res.body).toEqual(statusPayload);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('generates profiling using the resolved locale', async () => {
    const payload = {
      openaiApiKey: 'sk-test-key',
      force: true,
    };
    const responsePayload = {
      missingFields: [],
      isStale: false,
      staleReasons: [],
      assessment: { score: 60 },
    };
    const spy = vi
      .spyOn(profilingService, 'generateProfilingAssessment')
      .mockResolvedValue(responsePayload);

    const res = await request(app)
      .post('/api/analytics/profiling/generate')
      .send(payload)
      .expect(200);

    expect(res.body).toEqual(responsePayload);
    expect(spy).toHaveBeenCalledWith(payload, { locale: 'fr' });
  });

  it('surfaces validation errors and missing fields from generation', async () => {
    vi.spyOn(profilingService, 'generateProfilingAssessment').mockRejectedValue({
      status: 400,
      message: 'Complete the required profile fields before generating profiling',
      missingFields: ['location', 'monthly_income'],
    });

    const res = await request(app)
      .post('/api/analytics/profiling/generate')
      .send({ openaiApiKey: 'sk-test-key' })
      .expect(400);

    expect(res.body).toEqual({
      error: 'Complete the required profile fields before generating profiling',
      missingFields: ['location', 'monthly_income'],
    });
  });

  it('falls back to request locale resolution and includes service error codes', async () => {
    app = express();
    app.use(express.json());
    app.use('/api/analytics', createAnalyticsProfilingRouter());

    vi.spyOn(profilingService, 'generateProfilingAssessment').mockRejectedValue({
      status: 422,
      message: 'Profiling prompt failed validation',
      code: 'PROFILE_PROMPT_INVALID',
    });

    const res = await request(app)
      .post('/api/analytics/profiling/generate')
      .set('x-locale', 'en-US')
      .send({ openaiApiKey: 'sk-test-key' })
      .expect(422);

    expect(res.body).toEqual({
      error: 'Profiling prompt failed validation',
      code: 'PROFILE_PROMPT_INVALID',
    });
    expect(profilingService.generateProfilingAssessment).toHaveBeenCalledWith(
      { openaiApiKey: 'sk-test-key' },
      { locale: 'en' },
    );
  });

  it('returns 500 for profiling status failures', async () => {
    vi.spyOn(profilingService, 'getProfilingStatus').mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/analytics/profiling').expect(500);

    expect(res.body).toEqual({
      error: 'boom',
    });
  });
});
