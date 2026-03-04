import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createOnboardingRouter } = require('../../routes/onboarding.js');

const onboardingServiceMocks = {
  getOnboardingStatus: vi.fn(),
  dismissOnboarding: vi.fn(),
};

function buildApp() {
  const app = express();
  app.use('/api/onboarding', createOnboardingRouter({
    services: {
      onboardingService: onboardingServiceMocks,
    },
  }));
  return app;
}

describe('Electron /api/onboarding routes', () => {
  let app: express.Express;

  beforeEach(() => {
    onboardingServiceMocks.getOnboardingStatus.mockReset();
    onboardingServiceMocks.dismissOnboarding.mockReset();
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns onboarding status', async () => {
    const status = { hasAccounts: true };
    const spy = onboardingServiceMocks.getOnboardingStatus.mockResolvedValue(status);

    const res = await request(app).get('/api/onboarding/status').expect(200);

    expect(res.body).toEqual(status);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 10000);

  it('dismisses onboarding', async () => {
    const payload = { success: true };
    const spy = onboardingServiceMocks.dismissOnboarding.mockResolvedValue(payload);

    const res = await request(app).post('/api/onboarding/dismiss').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('handles errors gracefully', async () => {
    onboardingServiceMocks.getOnboardingStatus.mockRejectedValue(
      new Error('boom'),
    );

    const res = await request(app).get('/api/onboarding/status').expect(500);

    expect(res.body.error).toMatch(/failed to fetch onboarding status/i);
  });

  it('returns 500 when dismiss onboarding fails', async () => {
    onboardingServiceMocks.dismissOnboarding.mockRejectedValue(
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
