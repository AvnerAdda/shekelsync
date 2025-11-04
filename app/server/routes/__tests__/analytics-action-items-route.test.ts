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

describe('Shared analytics action-items routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns action items', async () => {
    const payload = [{ id: 'item-1' }];
    vi.spyOn(actionItemsService, 'getActionItems').mockResolvedValue(payload);

    const res = await request(app).get('/api/analytics/action-items').expect(200);

    expect(res.body).toEqual(payload);
  });

  it('creates an action item', async () => {
    const created = { id: 'item-2' };
    vi.spyOn(actionItemsService, 'createActionItem').mockResolvedValue(created);

    const res = await request(app)
      .post('/api/analytics/action-items')
      .send({ name: 'Follow up' })
      .expect(201);

    expect(res.body).toEqual(created);
  });

  it('updates an action item', async () => {
    const updated = { success: true };
    vi.spyOn(actionItemsService, 'updateActionItem').mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/analytics/action-items?id=item-1')
      .send({ status: 'done' })
      .expect(200);

    expect(res.body).toEqual(updated);
    expect(actionItemsService.updateActionItem).toHaveBeenCalledWith(
      { id: 'item-1' },
      { status: 'done' },
    );
  });

  it('deletes an action item', async () => {
    vi.spyOn(actionItemsService, 'deleteActionItem').mockResolvedValue({ success: true });

    const res = await request(app)
      .delete('/api/analytics/action-items?id=item-1')
      .expect(200);

    expect(res.body).toEqual({ success: true });
  });
});
