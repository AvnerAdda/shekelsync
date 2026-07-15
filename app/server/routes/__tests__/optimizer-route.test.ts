import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createOptimizerRouter } = require('../../routes/optimizer.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const optimizerService = require('../../services/optimizer.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/optimizer', createOptimizerRouter());
  return app;
}

describe('Shared /api/optimizer routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns optimizer status', async () => {
    const payload = { facts: [], questions: [], recommendations: [] };
    const spy = vi.spyOn(optimizerService, 'getOptimizerStatus').mockResolvedValue(payload);

    const res = await request(app).get('/api/optimizer/status').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('saves optimizer facts', async () => {
    const payload = { facts: [{ factKey: 'start.location', value: 'Tel Aviv' }] };
    const response = { facts: [{ factKey: 'start.location', status: 'confirmed' }] };
    const spy = vi.spyOn(optimizerService, 'saveOptimizerFacts').mockResolvedValue(response);

    const res = await request(app).put('/api/optimizer/facts').send(payload).expect(200);

    expect(res.body).toEqual(response);
    expect(spy).toHaveBeenCalledWith(payload);
  });

  it('generates a plan and prefers trusted OpenAI header', async () => {
    const response = { latestRun: { id: 1 }, recommendations: [] };
    const spy = vi.spyOn(optimizerService, 'generateOptimizerPlan').mockResolvedValue(response);

    await request(app)
      .post('/api/optimizer/generate')
      .set('x-openai-api-key', 'sk-header-key')
      .send({ model: 'gpt-4o-mini', openaiApiKey: 'sk-body-key' })
      .expect(200);

    expect(spy).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      openaiApiKey: 'sk-header-key',
    });
  });

  it('updates recommendation status', async () => {
    const response = { recommendation: { id: 5, status: 'done' } };
    const spy = vi.spyOn(optimizerService, 'updateRecommendationStatus').mockResolvedValue(response);

    const res = await request(app)
      .put('/api/optimizer/recommendations/5/status')
      .send({ status: 'done' })
      .expect(200);

    expect(res.body).toEqual(response);
    expect(spy).toHaveBeenCalledWith('5', { status: 'done' });
  });

  it('surfaces service errors', async () => {
    vi.spyOn(optimizerService, 'generateOptimizerPlan').mockRejectedValue({
      status: 503,
      message: 'AI service not configured',
      code: 'OPENAI_API_KEY_MISSING',
    });

    const res = await request(app).post('/api/optimizer/generate').send({}).expect(503);

    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body.code).toBe('OPENAI_API_KEY_MISSING');
  });

  it('does not expose unexpected database errors', async () => {
    vi.spyOn(optimizerService, 'getOptimizerStatus').mockRejectedValue(
      new Error('SQLITE_CONSTRAINT: internal schema details'),
    );

    const res = await request(app).get('/api/optimizer/status').expect(500);

    expect(res.body.error).toBe('Failed to fetch optimizer status');
    expect(res.body.error).not.toContain('SQLITE');
  });
});
