import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const securityRouter = require('../security.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const securityStatusManager = require('../../../../electron/security/security-status.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/security', securityRouter);
  return app;
}

describe('security routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not expose the retired authentication endpoint', async () => {
    await request(createApp()).post('/api/security/authenticate').send({}).expect(404);
  });

  it('returns the detailed security status', async () => {
    const status = { encryption: { status: 'active' } };
    vi.spyOn(securityStatusManager, 'getSecurityStatus').mockResolvedValue(status);

    const response = await request(createApp()).get('/api/security/status').expect(200);

    expect(response.body).toEqual({ success: true, data: status });
  });

  it('returns the simplified security summary', async () => {
    const summary = { level: 'secure', checks: {}, warnings: [] };
    vi.spyOn(securityStatusManager, 'getSecuritySummary').mockResolvedValue(summary);

    const response = await request(createApp()).get('/api/security/summary').expect(200);

    expect(response.body).toEqual({ success: true, data: summary });
  });

  it.each([
    ['status', 'getSecurityStatus', 'Failed to retrieve security status'],
    ['summary', 'getSecuritySummary', 'Failed to retrieve security summary'],
  ] as const)('sanitizes failures from the %s endpoint', async (endpoint, method, errorMessage) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(securityStatusManager, method).mockRejectedValue(new Error('status unavailable'));

    const response = await request(createApp()).get(`/api/security/${endpoint}`).expect(500);

    expect(response.body).toEqual({
      success: false,
      error: errorMessage,
      message: 'status unavailable',
    });
  });
});
