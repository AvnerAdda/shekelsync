import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onboardingServiceMocks = vi.hoisted(() => ({
  getOnboardingStatus: vi.fn(),
  dismissOnboarding: vi.fn(),
}));

vi.mock('../../services/onboarding.js', () => ({
  ...onboardingServiceMocks,
  default: onboardingServiceMocks,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createOnboardingRouter } = require('../../routes/onboarding.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const onboardingService = require('../../services/onboarding.js');

function buildApp() {
  const app = express();
  app.use('/api/onboarding', createOnboardingRouter());
  return app;
}

describe('Electron /api/onboarding routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns onboarding status', async () => {
    const status = { hasAccounts: true };
    const spy = vi
      .spyOn(onboardingService, 'getOnboardingStatus')
      .mockResolvedValue(status);

    const res = await request(app).get('/api/onboarding/status').expect(200);

    expect(res.body).toEqual(status);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 10000);

  it('dismisses onboarding', async () => {
    const payload = { success: true };
    const spy = vi
      .spyOn(onboardingService, 'dismissOnboarding')
      .mockResolvedValue(payload);

    const res = await request(app).post('/api/onboarding/dismiss').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('handles errors gracefully', async () => {
    vi.spyOn(onboardingService, 'getOnboardingStatus').mockRejectedValue(
      new Error('boom'),
    );

    const res = await request(app).get('/api/onboarding/status').expect(500);

    expect(res.body.error).toMatch(/failed to fetch onboarding status/i);
  });

  it('returns 500 when dismiss onboarding fails', async () => {
    vi.spyOn(onboardingService, 'dismissOnboarding').mockRejectedValue(
      new Error('dismiss failed'),
    );

    const res = await request(app).post('/api/onboarding/dismiss').expect(500);

    expect(res.body).toEqual({
      success: false,
      error: 'Failed to dismiss onboarding',
      message: 'dismiss failed',
    });
  });
});
