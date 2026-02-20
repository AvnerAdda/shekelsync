import express from 'express';
import crypto from 'crypto';
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

function createStripeSignature(secret: string, payload: unknown, timestamp = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload);
  const digest = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

describe('Electron /api/donations routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SUPPORTER_SYNC_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
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
      .send({ source: 'support_modal' })
      .expect(200);

    expect(spy).toHaveBeenCalledWith(
      { source: 'support_modal' },
      {
        accessToken: null,
        userId: null,
        email: null,
        name: null,
      },
    );
    expect(res.body).toEqual({ success: true, data: payload });
  });

  it('processes Stripe webhook and syncs supporter entitlement', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const servicePayload = {
      hasDonated: true,
      tier: 'one_time',
      supportStatus: 'verified',
      canAccessAiAgent: true,
    };
    const spy = vi
      .spyOn(donationsService, 'syncSupporterEntitlement')
      .mockResolvedValue(servicePayload);

    const eventPayload = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: 1770000000,
      data: {
        object: {
          id: 'cs_test_1',
          mode: 'payment',
          payment_status: 'paid',
          amount_total: 1275,
          customer_email: 'member@example.com',
          payment_intent: 'pi_test_1',
          metadata: {
            userId: 'user-22',
          },
        },
      },
    };
    const signature = createStripeSignature(process.env.STRIPE_WEBHOOK_SECRET, eventPayload);

    const res = await request(app)
      .post('/api/donations/stripe/webhook')
      .set('stripe-signature', signature)
      .send(eventPayload)
      .expect(200);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-22',
        email: 'member@example.com',
        status: 'verified',
        amountUsd: 12.75,
        billingCycle: 'one_time',
        provider: 'stripe',
        providerReference: 'pi_test_1',
      }),
      {},
    );
    expect(res.body).toEqual({
      success: true,
      received: true,
      processed: true,
      eventType: 'checkout.session.completed',
      data: servicePayload,
    });
  });

  it('rejects Stripe webhook when signature is invalid', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const spy = vi.spyOn(donationsService, 'syncSupporterEntitlement');
    const eventPayload = {
      id: 'evt_bad',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: 'u-1' }, payment_status: 'paid', amount_total: 500 } },
    };

    const res = await request(app)
      .post('/api/donations/stripe/webhook')
      .set('stripe-signature', `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`)
      .send(eventPayload)
      .expect(400);

    expect(spy).not.toHaveBeenCalled();
    expect(res.body.code).toBe('STRIPE_SIGNATURE_INVALID');
  });

  it('ignores unsupported Stripe event types without syncing entitlements', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    const spy = vi.spyOn(donationsService, 'syncSupporterEntitlement');
    const eventPayload = {
      id: 'evt_ignored',
      type: 'customer.created',
      data: { object: { id: 'cus_1' } },
    };
    const signature = createStripeSignature(process.env.STRIPE_WEBHOOK_SECRET, eventPayload);

    const res = await request(app)
      .post('/api/donations/stripe/webhook')
      .set('stripe-signature', signature)
      .send(eventPayload)
      .expect(200);

    expect(spy).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      success: true,
      received: true,
      ignored: true,
      reason: 'unsupported_event_type:customer.created',
    });
  });

  it('syncs supporter entitlement when sync secret is valid', async () => {
    process.env.SUPPORTER_SYNC_SECRET = 'sync-secret';
    const payload = { hasDonated: true, tier: 'one_time', supportStatus: 'verified' };
    const spy = vi
      .spyOn(donationsService, 'syncSupporterEntitlement')
      .mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/donations/entitlement')
      .set('x-supporter-sync-secret', 'sync-secret')
      .set('x-auth-user-id', 'user-11')
      .send({ userId: 'user-11', email: 'member@example.com', status: 'verified', amountUsd: 10 })
      .expect(200);

    expect(spy).toHaveBeenCalledWith(
      { userId: 'user-11', email: 'member@example.com', status: 'verified', amountUsd: 10 },
      {
        accessToken: null,
        userId: 'user-11',
        email: null,
        name: null,
      },
    );
    expect(res.body).toEqual({ success: true, data: payload });
  });

  it('rejects entitlement sync when secret is missing from env', async () => {
    const spy = vi.spyOn(donationsService, 'syncSupporterEntitlement');

    const res = await request(app)
      .post('/api/donations/entitlement')
      .set('x-supporter-sync-secret', 'sync-secret')
      .send({ status: 'verified', userId: 'u-1' })
      .expect(503);

    expect(spy).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      success: false,
      error: 'SUPPORTER_SYNC_SECRET is not configured',
      code: 'SUPPORT_SYNC_SECRET_MISSING',
    });
  });

  it('rejects entitlement sync when provided secret is invalid', async () => {
    process.env.SUPPORTER_SYNC_SECRET = 'sync-secret';
    const spy = vi.spyOn(donationsService, 'syncSupporterEntitlement');

    const res = await request(app)
      .post('/api/donations/entitlement')
      .set('x-supporter-sync-secret', 'wrong-secret')
      .send({ status: 'verified', userId: 'u-1' })
      .expect(401);

    expect(spy).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      success: false,
      error: 'Support entitlement sync is unauthorized',
      code: 'SUPPORT_SYNC_UNAUTHORIZED',
    });
  });

  it('accepts wrapped payload format for intent compatibility', async () => {
    const payload = { hasDonated: false, tier: 'none', supportStatus: 'pending' };
    const spy = vi
      .spyOn(donationsService, 'createSupportIntent')
      .mockResolvedValue(payload);

    await request(app)
      .post('/api/donations')
      .send({ payload: { source: 'legacy' } })
      .expect(200);

    expect(spy).toHaveBeenCalledWith(
      { source: 'legacy' },
      {
        accessToken: null,
        userId: null,
        email: null,
        name: null,
      },
    );
  });

  it('uses addDonationEvent path when amount payload is sent', async () => {
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
      message: 'source is invalid',
      code: 'VALIDATION_FAILED',
    });

    const res = await request(app)
      .post('/api/donations')
      .send({ source: null })
      .expect(400);

    expect(res.body).toEqual({
      success: false,
      error: 'source is invalid',
      code: 'VALIDATION_FAILED',
    });
  });

  it('surfaces status route errors', async () => {
    vi.spyOn(donationsService, 'getDonationStatus').mockRejectedValue(new Error('status unavailable'));

    const res = await request(app).get('/api/donations/status').expect(500);

    expect(res.body).toEqual({
      success: false,
      error: 'status unavailable',
    });
  });

  it('surfaces intent route errors with status and code', async () => {
    vi.spyOn(donationsService, 'createSupportIntent').mockRejectedValue({
      status: 422,
      message: 'intent invalid',
      code: 'INTENT_INVALID',
    });

    const res = await request(app)
      .post('/api/donations/intent')
      .send({})
      .expect(422);

    expect(res.body).toEqual({
      success: false,
      error: 'intent invalid',
      code: 'INTENT_INVALID',
    });
  });

  it('surfaces reminder route errors', async () => {
    vi.spyOn(donationsService, 'markMonthlyReminderShown').mockRejectedValue({
      message: 'reminder failed',
    });

    const res = await request(app)
      .post('/api/donations/reminder-shown')
      .send({ monthKey: '2026-03' })
      .expect(500);

    expect(res.body).toEqual({
      success: false,
      error: 'reminder failed',
    });
  });
});
