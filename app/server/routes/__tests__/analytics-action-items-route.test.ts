import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createAnalyticsActionItemsRouter } = require('../../routes/analytics-action-items.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const actionItemsService = require('../../services/analytics/action-items.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics/action-items', createAnalyticsActionItemsRouter());
  return app;
}

describe('Analytics action items routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists action items', async () => {
    const payload = [{ id: 1 }];
    vi.spyOn(actionItemsService, 'getActionItems').mockResolvedValue(payload);

    const res = await request(app).get('/api/analytics/action-items').expect(200);
    expect(res.body).toEqual(payload);
  });

  it('creates an action item', async () => {
    const payload = { id: 2 };
    vi.spyOn(actionItemsService, 'createActionItem').mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/analytics/action-items')
      .send({ title: 'save' })
      .expect(201);
    expect(res.body).toEqual(payload);
  });

  it('updates an action item', async () => {
    const payload = { id: 3, done: true };
    vi.spyOn(actionItemsService, 'updateActionItem').mockResolvedValue(payload);

    const res = await request(app)
      .put('/api/analytics/action-items?itemId=3')
      .send({ done: true })
      .expect(200);

    expect(res.body).toEqual(payload);
  });

  it('deletes an action item', async () => {
    const payload = { success: true };
    vi.spyOn(actionItemsService, 'deleteActionItem').mockResolvedValue(payload);

    const res = await request(app)
      .delete('/api/analytics/action-items?itemId=5')
      .expect(200);
    expect(res.body).toEqual(payload);
  });

  it('surfaces errors with status codes', async () => {
    vi.spyOn(actionItemsService, 'getActionItems').mockRejectedValue(
      Object.assign(new Error('boom'), { statusCode: 503 }),
    );

    const res = await request(app).get('/api/analytics/action-items').expect(503);
    expect(res.body.error).toMatch(/boom/);
  });
});
