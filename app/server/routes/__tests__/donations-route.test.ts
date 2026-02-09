import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createDonationsRouter } = require('../../routes/donations.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const donationsService = require('../../services/donations.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/donations', createDonationsRouter());
  return app;
}

describe('Electron /api/donations routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns donation status payload', async () => {
    const payload = { hasDonated: false, tier: 'none', supportStatus: 'none' };
    const spy = vi
      .spyOn(donationsService, 'getDonationStatus')
      .mockResolvedValue(payload);

    const res = await request(app).get('/api/donations/status').expect(200);

    expect(res.body).toEqual({ success: true, data: payload });
    expect(spy).toHaveBeenCalledWith({
      accessToken: null,
      userId: null,
      email: null,
      name: null,
    });
  });

  it('records a support intent from request body', async () => {
    const payload = { hasDonated: false, tier: 'none', supportStatus: 'pending' };
    const spy = vi
      .spyOn(donationsService, 'createSupportIntent')
      .mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/donations/intent')
      .send({ planKey: 'bronze' })
      .expect(200);

    expect(spy).toHaveBeenCalledWith(
      { planKey: 'bronze' },
      {
        accessToken: null,
        userId: null,
        email: null,
        name: null,
      },
    );
    expect(res.body).toEqual({ success: true, data: payload });
  });

  it('accepts wrapped payload format for intent compatibility', async () => {
    const payload = { hasDonated: false, tier: 'none', supportStatus: 'pending' };
    const spy = vi
      .spyOn(donationsService, 'createSupportIntent')
      .mockResolvedValue(payload);

    await request(app)
      .post('/api/donations')
      .send({ payload: { planKey: 'silver' } })
      .expect(200);

    expect(spy).toHaveBeenCalledWith(
      { planKey: 'silver' },
      {
        accessToken: null,
        userId: null,
        email: null,
        name: null,
      },
    );
  });

  it('uses legacy addDonationEvent path when amount payload is sent', async () => {
    const payload = { hasDonated: true, tier: 'one_time', supportStatus: 'verified' };
    const spy = vi
      .spyOn(donationsService, 'addDonationEvent')
      .mockResolvedValue(payload);

    await request(app)
      .post('/api/donations')
      .send({ amount: 25, note: 'legacy' })
      .expect(200);

    expect(spy).toHaveBeenCalledWith(
      { amount: 25, note: 'legacy' },
      {
        accessToken: null,
        userId: null,
        email: null,
        name: null,
      },
    );
  });

  it('marks reminder as shown', async () => {
    const payload = { reminderShownThisMonth: true, shouldShowMonthlyReminder: false };
    const spy = vi
      .spyOn(donationsService, 'markMonthlyReminderShown')
      .mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/donations/reminder-shown')
      .send({ monthKey: '2026-02' })
      .expect(200);

    expect(spy).toHaveBeenCalledWith(
      { monthKey: '2026-02' },
      {
        accessToken: null,
        userId: null,
        email: null,
        name: null,
      },
    );
    expect(res.body).toEqual({ success: true, data: payload });
  });

  it('surfaces service errors with status code', async () => {
    vi.spyOn(donationsService, 'createSupportIntent').mockRejectedValue({
      status: 400,
      message: 'planKey is required',
      code: 'VALIDATION_FAILED',
    });

    const res = await request(app)
      .post('/api/donations')
      .send({ planKey: null })
      .expect(400);

    expect(res.body).toEqual({
      success: false,
      error: 'planKey is required',
      code: 'VALIDATION_FAILED',
    });
  });
});
