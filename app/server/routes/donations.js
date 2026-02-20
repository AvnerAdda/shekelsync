const crypto = require('crypto');
const express = require('express');
const donationsService = require('../services/donations.js');

const STRIPE_TOLERANCE_SECONDS = 300;

function createRouteError(message, status = 500, code) {
  const error = new Error(message);
  error.status = status;
  if (code) {
    error.code = code;
  }
  return error;
}

function normalizePayload(body = {}) {
  if (body && typeof body === 'object' && body.payload && typeof body.payload === 'object') {
    return body.payload;
  }
  return body || {};
}

function getHeaderValue(headers, key) {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

function getSupporterContext(req) {
  return {
    accessToken: getHeaderValue(req.headers, 'x-auth-access-token'),
    userId: getHeaderValue(req.headers, 'x-auth-user-id'),
    email: getHeaderValue(req.headers, 'x-auth-user-email'),
    name: getHeaderValue(req.headers, 'x-auth-user-name'),
  };
}

function getStripeMetadata(stripeObject = {}) {
  if (!stripeObject || typeof stripeObject !== 'object') {
    return {};
  }

  const candidates = [
    stripeObject.metadata,
    stripeObject.subscription_details?.metadata,
    stripeObject.customer_details?.metadata,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  return {};
}

function resolveStripeSupportStatus(eventType, stripeObject = {}) {
  const normalizedType = typeof eventType === 'string' ? eventType.trim().toLowerCase() : '';
  if (!normalizedType) {
    return null;
  }

  if (normalizedType === 'checkout.session.completed') {
    const paymentStatus = typeof stripeObject.payment_status === 'string'
      ? stripeObject.payment_status.trim().toLowerCase()
      : '';
    return paymentStatus === 'paid' || paymentStatus === 'no_payment_required' ? 'verified' : 'pending';
  }
  if (normalizedType === 'checkout.session.expired') {
    return 'rejected';
  }
  if (normalizedType === 'invoice.paid' || normalizedType === 'invoice.payment_succeeded') {
    return 'verified';
  }
  if (normalizedType === 'invoice.payment_failed' || normalizedType === 'payment_intent.payment_failed') {
    return 'pending';
  }
  if (normalizedType === 'payment_intent.succeeded') {
    return 'verified';
  }
  if (normalizedType === 'charge.refunded' || normalizedType === 'charge.dispute.funds_withdrawn') {
    return 'rejected';
  }
  if (normalizedType === 'customer.subscription.deleted') {
    return 'rejected';
  }
  if (normalizedType === 'customer.subscription.created' || normalizedType === 'customer.subscription.updated') {
    const subscriptionStatus = typeof stripeObject.status === 'string'
      ? stripeObject.status.trim().toLowerCase()
      : '';
    if (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') {
      return 'verified';
    }
    if (subscriptionStatus === 'past_due' || subscriptionStatus === 'unpaid' || subscriptionStatus === 'incomplete') {
      return 'pending';
    }
    if (subscriptionStatus === 'canceled' || subscriptionStatus === 'paused' || subscriptionStatus === 'incomplete_expired') {
      return 'rejected';
    }
    return 'pending';
  }

  return null;
}

function resolveStripeAmountUsd(stripeObject = {}) {
  const directAmountCents = [
    stripeObject.amount_total,
    stripeObject.amount_paid,
    stripeObject.amount_due,
    stripeObject.amount_received,
  ]
    .map((rawValue) => Number(rawValue))
    .find((value) => Number.isFinite(value) && value >= 0);

  if (Number.isFinite(directAmountCents)) {
    return Math.round((directAmountCents / 100) * 100) / 100;
  }

  const metadata = getStripeMetadata(stripeObject);
  const metadataAmount = Number(metadata.amountUsd || metadata.amount_usd || metadata.amount);
  if (Number.isFinite(metadataAmount) && metadataAmount >= 0) {
    return Math.round(metadataAmount * 100) / 100;
  }

  return 0;
}

function resolveStripeBillingCycle(stripeObject = {}) {
  if (typeof stripeObject.mode === 'string') {
    const mode = stripeObject.mode.trim().toLowerCase();
    if (mode === 'payment') {
      return 'one_time';
    }
    if (mode === 'subscription') {
      return 'monthly';
    }
  }

  const metadata = getStripeMetadata(stripeObject);
  const metadataCycle = typeof metadata.billingCycle === 'string'
    ? metadata.billingCycle.trim().toLowerCase()
    : typeof metadata.billing_cycle === 'string'
      ? metadata.billing_cycle.trim().toLowerCase()
      : '';
  if (metadataCycle === 'monthly' || metadataCycle === 'one_time' || metadataCycle === 'lifetime') {
    return metadataCycle;
  }

  const recurringInterval = stripeObject?.items?.data?.[0]?.price?.recurring?.interval
    || stripeObject?.lines?.data?.[0]?.price?.recurring?.interval;
  if (typeof recurringInterval === 'string' && recurringInterval.trim().toLowerCase() === 'month') {
    return 'monthly';
  }

  return 'one_time';
}

function getRawBodyBuffer(req) {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody;
  }
  if (typeof req.rawBody === 'string') {
    return Buffer.from(req.rawBody, 'utf8');
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8');
  }
  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body), 'utf8');
  }
  return Buffer.from('', 'utf8');
}

function parseStripeSignatureHeader(signatureHeader) {
  if (typeof signatureHeader !== 'string' || signatureHeader.trim().length === 0) {
    return null;
  }

  const segments = signatureHeader
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  let timestamp = null;
  const signatures = [];

  segments.forEach((segment) => {
    const [key, value] = segment.split('=');
    if (!key || !value) {
      return;
    }
    if (key === 't') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        timestamp = parsed;
      }
      return;
    }
    if (key === 'v1') {
      signatures.push(value);
    }
  });

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}

function safeTimingCompareHex(expectedHex, candidateHex) {
  if (typeof expectedHex !== 'string' || typeof candidateHex !== 'string') {
    return false;
  }

  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const candidate = Buffer.from(candidateHex, 'hex');
    if (expected.length === 0 || candidate.length === 0 || expected.length !== candidate.length) {
      return false;
    }
    return crypto.timingSafeEqual(expected, candidate);
  } catch {
    return false;
  }
}

function verifyStripeSignature(rawBodyBuffer, signatureHeader, webhookSecret) {
  if (!(rawBodyBuffer instanceof Buffer) || rawBodyBuffer.length === 0) {
    throw createRouteError('Stripe webhook payload is empty', 400, 'STRIPE_PAYLOAD_INVALID');
  }
  if (typeof webhookSecret !== 'string' || webhookSecret.trim().length === 0) {
    throw createRouteError('STRIPE_WEBHOOK_SECRET is not configured', 503, 'STRIPE_WEBHOOK_SECRET_MISSING');
  }
  if (typeof signatureHeader !== 'string' || signatureHeader.trim().length === 0) {
    throw createRouteError('Missing Stripe-Signature header', 400, 'STRIPE_SIGNATURE_MISSING');
  }

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) {
    throw createRouteError('Invalid Stripe-Signature header format', 400, 'STRIPE_SIGNATURE_INVALID');
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (ageSeconds > STRIPE_TOLERANCE_SECONDS) {
    throw createRouteError('Stripe signature timestamp is outside the allowed tolerance window', 400, 'STRIPE_SIGNATURE_EXPIRED');
  }

  const signedPayload = `${parsed.timestamp}.${rawBodyBuffer.toString('utf8')}`;
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret.trim())
    .update(signedPayload, 'utf8')
    .digest('hex');

  const isValid = parsed.signatures.some((candidate) => safeTimingCompareHex(expectedSignature, candidate));
  if (!isValid) {
    throw createRouteError('Stripe signature verification failed', 400, 'STRIPE_SIGNATURE_INVALID');
  }
}

function parseStripeEventPayload(req, rawBodyBuffer) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  try {
    const rawJson = rawBodyBuffer.toString('utf8');
    return JSON.parse(rawJson);
  } catch {
    throw createRouteError('Stripe webhook payload must be valid JSON', 400, 'STRIPE_PAYLOAD_INVALID');
  }
}

function getStripeReferenceId(event = {}, stripeObject = {}) {
  const candidates = [
    stripeObject.subscription,
    stripeObject.payment_intent,
    stripeObject.invoice,
    stripeObject.charge,
    stripeObject.id,
    event.id,
  ];

  const firstValid = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return firstValid ? firstValid.trim() : null;
}

function buildSupportSyncPayloadFromStripeEvent(event = {}) {
  const eventType = typeof event.type === 'string' ? event.type : '';
  const stripeObject = event?.data?.object && typeof event.data.object === 'object'
    ? event.data.object
    : null;

  if (!eventType || !stripeObject) {
    throw createRouteError('Stripe webhook payload is missing event type or data.object', 400, 'STRIPE_PAYLOAD_INVALID');
  }

  const supportStatus = resolveStripeSupportStatus(eventType, stripeObject);
  if (!supportStatus) {
    return {
      shouldSync: false,
      ignoreReason: `unsupported_event_type:${eventType}`,
    };
  }

  const metadata = getStripeMetadata(stripeObject);

  const userId = typeof metadata.userId === 'string'
    ? metadata.userId.trim()
    : typeof metadata.user_id === 'string'
      ? metadata.user_id.trim()
      : typeof metadata.supporterUserId === 'string'
        ? metadata.supporterUserId.trim()
        : null;
  const email = typeof stripeObject.customer_email === 'string'
    ? stripeObject.customer_email.trim()
    : typeof stripeObject.customer_details?.email === 'string'
      ? stripeObject.customer_details.email.trim()
      : typeof metadata.email === 'string'
        ? metadata.email.trim()
        : null;

  if (!userId && !email) {
    return {
      shouldSync: false,
      ignoreReason: 'missing_identity',
    };
  }

  const eventCreatedAt = Number.isFinite(Number(event.created))
    ? new Date(Number(event.created) * 1000).toISOString()
    : undefined;

  return {
    shouldSync: true,
    payload: {
      userId: userId || undefined,
      email: email || undefined,
      status: supportStatus,
      amountUsd: resolveStripeAmountUsd(stripeObject),
      billingCycle: resolveStripeBillingCycle(stripeObject),
      provider: 'stripe',
      providerReference: getStripeReferenceId(event, stripeObject),
      source: `stripe_webhook:${eventType}`.slice(0, 64),
      note: typeof event.id === 'string' ? `stripe_event:${event.id}` : undefined,
      verifiedAt: supportStatus === 'verified' ? eventCreatedAt : undefined,
    },
  };
}

function getSupportSyncSecretFromRequest(req) {
  const directSecret = getHeaderValue(req.headers, 'x-supporter-sync-secret');
  if (directSecret) {
    return directSecret.trim();
  }

  const authorization = getHeaderValue(req.headers, 'authorization');
  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }

  return null;
}

function assertSupporterSyncAuthorized(req) {
  const configuredSecret = typeof process.env.SUPPORTER_SYNC_SECRET === 'string'
    ? process.env.SUPPORTER_SYNC_SECRET.trim()
    : '';

  if (!configuredSecret) {
    const error = new Error('SUPPORTER_SYNC_SECRET is not configured');
    error.status = 503;
    error.code = 'SUPPORT_SYNC_SECRET_MISSING';
    throw error;
  }

  const providedSecret = getSupportSyncSecretFromRequest(req);
  if (!providedSecret || providedSecret !== configuredSecret) {
    const error = new Error('Support entitlement sync is unauthorized');
    error.status = 401;
    error.code = 'SUPPORT_SYNC_UNAUTHORIZED';
    throw error;
  }
}

function createDonationsRouter() {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    try {
      const status = await donationsService.getDonationStatus(getSupporterContext(req));
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation status error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to fetch donation status',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  router.post('/intent', async (req, res) => {
    try {
      const payload = normalizePayload(req.body);
      const status = await donationsService.createSupportIntent(payload, getSupporterContext(req));
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation intent error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to record support intent',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  router.post('/stripe/webhook', async (req, res) => {
    try {
      const webhookSecret = typeof process.env.STRIPE_WEBHOOK_SECRET === 'string'
        ? process.env.STRIPE_WEBHOOK_SECRET.trim()
        : '';
      const signatureHeader = getHeaderValue(req.headers, 'stripe-signature');
      const rawBodyBuffer = getRawBodyBuffer(req);

      verifyStripeSignature(rawBodyBuffer, signatureHeader, webhookSecret);
      const event = parseStripeEventPayload(req, rawBodyBuffer);
      const syncPayload = buildSupportSyncPayloadFromStripeEvent(event);

      if (!syncPayload.shouldSync) {
        return res.json({
          success: true,
          received: true,
          ignored: true,
          reason: syncPayload.ignoreReason,
        });
      }

      const status = await donationsService.syncSupporterEntitlement(syncPayload.payload, {});
      return res.json({
        success: true,
        received: true,
        processed: true,
        eventType: event.type,
        data: status,
      });
    } catch (error) {
      console.error('Stripe donation webhook error:', error);
      return res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to process Stripe webhook',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  router.post('/entitlement', async (req, res) => {
    try {
      assertSupporterSyncAuthorized(req);
      const payload = normalizePayload(req.body);
      const status = await donationsService.syncSupporterEntitlement(payload, getSupporterContext(req));
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation entitlement sync error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to sync supporter entitlement',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const payload = normalizePayload(req.body);
      const status = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'amount')
        ? await donationsService.addDonationEvent(payload, getSupporterContext(req))
        : await donationsService.createSupportIntent(payload, getSupporterContext(req));
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation create error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to record donation',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  router.post('/reminder-shown', async (req, res) => {
    try {
      const payload = normalizePayload(req.body);
      const status = await donationsService.markMonthlyReminderShown(payload, getSupporterContext(req));
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Donation reminder update error:', error);
      res.status(error?.status || 500).json({
        success: false,
        error: error?.message || 'Failed to update monthly reminder status',
        ...(error?.code ? { code: error.code } : {}),
      });
    }
  });

  return router;
}

module.exports = { createDonationsRouter };
