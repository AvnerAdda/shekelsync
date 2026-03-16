import { describe, expect, it, vi } from 'vitest';

import { proxyApiRequest } from '../api-request-proxy.js';

describe('api request proxy', () => {
  it('waits for embedded API readiness before proxying requests', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: vi.fn().mockResolvedValue('{"success":true}'),
    });

    const state = {
      apiPort: null,
      apiToken: 'secret-token',
      skipEmbeddedApi: false,
    };

    const waitForEmbeddedApi = vi.fn().mockImplementation(async () => {
      state.apiPort = 43111;
    });

    const response = await proxyApiRequest({
      method: 'GET',
      endpoint: '/api/onboarding/status',
      fetchImpl,
      getState: () => state,
      waitForEmbeddedApi,
    });

    expect(waitForEmbeddedApi).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:43111/api/onboarding/status',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
    expect(response).toEqual({
      status: 200,
      statusText: 'OK',
      ok: true,
      data: { success: true },
    });
  });

  it('returns 503 when embedded API startup finishes without a port', async () => {
    const fetchImpl = vi.fn();

    const response = await proxyApiRequest({
      method: 'GET',
      endpoint: '/api/onboarding/status',
      fetchImpl,
      getState: () => ({
        apiPort: null,
        apiToken: null,
        skipEmbeddedApi: false,
      }),
      waitForEmbeddedApi: vi.fn().mockResolvedValue(undefined),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(response.ok).toBe(false);
    expect(response.data).toMatchObject({
      error: 'Embedded API unavailable',
    });
  });

  it('falls back to the external dev server only when embedded API is explicitly skipped', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: vi.fn().mockResolvedValue('plain-text'),
    });

    const response = await proxyApiRequest({
      method: 'GET',
      endpoint: '/api/ping',
      fetchImpl,
      getState: () => ({
        apiPort: null,
        apiToken: 'ignored-token',
        skipEmbeddedApi: true,
      }),
      waitForEmbeddedApi: vi.fn(),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/ping',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
    expect(response.data).toBe('plain-text');
  });
});
