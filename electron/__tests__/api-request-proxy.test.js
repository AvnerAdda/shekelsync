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

  it('returns a timeout response when a dashboard GET never settles', async () => {
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const response = await proxyApiRequest({
      method: 'GET',
      endpoint: '/api/analytics/dashboard',
      fetchImpl,
      getState: () => ({
        apiPort: 43111,
        apiToken: 'secret-token',
        skipEmbeddedApi: false,
      }),
      waitForEmbeddedApi: vi.fn(),
      apiGetTimeoutMs: 5,
    });

    expect(response).toMatchObject({
      status: 504,
      statusText: 'Gateway Timeout',
      ok: false,
    });
  });

  it('retries once when the embedded API token rotates at the expiry boundary', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        text: vi.fn().mockResolvedValue('{"error":"expired"}'),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        ok: true,
        text: vi.fn().mockResolvedValue('{"success":true}'),
      });
    let stateReadCount = 0;

    const response = await proxyApiRequest({
      method: 'GET',
      endpoint: '/api/analytics/dashboard',
      fetchImpl,
      getState: () => {
        stateReadCount += 1;
        return {
          apiPort: 43111,
          apiToken: stateReadCount === 1 ? 'expiring-token' : 'replacement-token',
          skipEmbeddedApi: false,
        };
      },
      waitForEmbeddedApi: vi.fn(),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer expiring-token');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer replacement-token');
    expect(response).toMatchObject({ status: 200, ok: true, data: { success: true } });
  });
});
