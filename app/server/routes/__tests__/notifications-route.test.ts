import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createNotificationsRouter } = require('../../routes/notifications.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notificationsService = require('../../services/notifications.js');

function buildApp() {
  const app = express();
  app.use('/api/notifications', createNotificationsRouter());
  return app;
}

describe('Electron /api/notifications routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns notifications payload', async () => {
    const payload = { alerts: [], meta: { total: 0 } };
    const spy = vi
      .spyOn(notificationsService, 'getNotifications')
      .mockResolvedValue(payload);

    const res = await request(app).get('/api/notifications?limit=5').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ limit: '5' });
  });

  it('handles service errors with status code', async () => {
    vi.spyOn(notificationsService, 'getNotifications').mockRejectedValue({
      status: 422,
      message: 'invalid filters',
    });

    const res = await request(app).get('/api/notifications').expect(422);

    expect(res.body.error).toMatch(/invalid filters/i);
  });
});
