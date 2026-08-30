import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createMoneyReviewRouter } = require('../../routes/money-review.js');

function buildApp(service: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { locale?: string }).locale = 'fr';
    next();
  });
  app.use('/api/money-review', createMoneyReviewRouter({ service }));
  return app;
}

describe('Money Review routes', () => {
  it('returns the unified review queue', async () => {
    const getMoneyReview = vi.fn().mockResolvedValue({
      success: true,
      summary: { open: 1 },
      items: [{ id: 7, title: 'Categorize transactions' }],
    });
    const app = buildApp({ getMoneyReview, updateMoneyReviewItem: vi.fn() });

    const response = await request(app).get('/api/money-review').expect(200);

    expect(response.body.items[0].id).toBe(7);
    expect(getMoneyReview).toHaveBeenCalledOnce();
    expect(getMoneyReview).toHaveBeenCalledWith({ locale: 'fr' });
  });

  it('updates an item lifecycle', async () => {
    const updateMoneyReviewItem = vi.fn().mockResolvedValue({
      success: true,
      item: { id: 7, status: 'snoozed' },
    });
    const app = buildApp({ getMoneyReview: vi.fn(), updateMoneyReviewItem });

    const response = await request(app)
      .put('/api/money-review/items/7/status')
      .send({ status: 'snoozed', snoozePreset: '1_week' })
      .expect(200);

    expect(response.body.item.status).toBe('snoozed');
    expect(updateMoneyReviewItem).toHaveBeenCalledWith('7', {
      status: 'snoozed',
      snoozePreset: '1_week',
    });
  });

  it('sanitizes unexpected service errors', async () => {
    const app = buildApp({
      getMoneyReview: vi.fn().mockRejectedValue(new Error('SQLITE internal details')),
      updateMoneyReviewItem: vi.fn(),
    });

    const response = await request(app).get('/api/money-review').expect(500);

    expect(response.body.error).toBe('Failed to load Money Review');
    expect(response.body.error).not.toContain('SQLITE');
  });
});
