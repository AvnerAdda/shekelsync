import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const createSmartActionsRouter = require('../smart-actions.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const smartActionsService = require('../../services/analytics/smart-actions.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/smart-actions', createSmartActionsRouter());
  return app;
}

describe('Smart Actions routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates smart actions', async () => {
    const payload = { success: true, generated: 3 };
    const spy = vi.spyOn(smartActionsService, 'generateSmartActions').mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/smart-actions/generate?months=2')
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ months: '2' }));
  });

  it('fetches smart actions list', async () => {
    const payload = { actions: [{ id: 1, status: 'active', title: 'Test' }] };
    const spy = vi.spyOn(smartActionsService, 'getSmartActions').mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/smart-actions?status=active')
      .expect(200);

    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0].status).toBe('active');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('updates smart action status via convenience endpoints', async () => {
    const payload = { success: true, id: 5, status: 'resolved' };
    const spy = vi
      .spyOn(smartActionsService, 'updateSmartActionStatus')
      .mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/smart-actions/5/resolve')
      .send({ userNote: 'done' })
      .expect(200);

    expect(res.body.status).toBe('resolved');
    expect(spy).toHaveBeenCalledWith(5, 'resolved', 'done');
  });

  it('returns 400 for invalid IDs', async () => {
    await request(app).post('/api/smart-actions/not-a-number/resolve').expect(400);
    await request(app).put('/api/smart-actions/abc/status').send({ status: 'resolved' }).expect(400);
  });

  it('handles service failures for generate and update', async () => {
    vi.spyOn(smartActionsService, 'generateSmartActions').mockRejectedValue(
      Object.assign(new Error('gen fail'), { status: 502 }),
    );
    const genRes = await request(app).post('/api/smart-actions/generate').expect(502);
    expect(genRes.body.error).toMatch(/gen fail|generate/i);

    vi.spyOn(smartActionsService, 'updateSmartActionStatus').mockRejectedValue(
      Object.assign(new Error('update fail'), { statusCode: 503 }),
    );
    const upd = await request(app).put('/api/smart-actions/1/status').send({ status: 'active' }).expect(503);
    expect(upd.body.error).toBeDefined();
  });

  it('validates required status when updating', async () => {
    const res = await request(app).put('/api/smart-actions/1/status').send({}).expect(400);
    expect(res.body.error).toMatch(/Status is required/);
  });
});
