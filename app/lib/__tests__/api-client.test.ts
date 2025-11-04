import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../api-client';
import * as sessionStore from '@/lib/session-store';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();

  if (originalFetch) {
    globalThis.fetch = originalFetch.bind(globalThis);
  } else {
    // @ts-expect-error - cleanup stub
    delete globalThis.fetch;
  }
  // Clean up injected electron API
  // @ts-expect-error - cleanup for tests
  delete window.electronAPI;
});

describe('apiClient', () => {
  it('falls back to window.fetch when electron API is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ message: 'success' })),
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await apiClient.post('/api/test', { foo: 'bar' });

    expect(fetchMock).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ foo: 'bar' }),
    }));
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ message: 'success' });
  });

  it('uses electron IPC when available', async () => {
    const requestMock = vi.fn().mockResolvedValue({
      status: 201,
      statusText: 'Created',
      ok: true,
      data: { id: 123 },
    });

    window.electronAPI = {
      api: {
        request: requestMock,
      },
    };

    const response = await apiClient.put('/api/resource/123', { name: 'Test' });

    expect(requestMock).toHaveBeenCalledWith(
      'PUT',
      '/api/resource/123',
      { name: 'Test' },
      {},
    );
    expect(response.status).toBe(201);
    expect(response.data).toEqual({ id: 123 });
  });
});

describe('sessionStore', () => {
  it('produces Authorization header when an access token is cached locally', async () => {
    window.localStorage.setItem('clarify.auth.session', JSON.stringify({
      accessToken: 'test-token',
      tokenType: 'Bearer',
    }));

    const headers = await sessionStore.getAuthorizationHeader();
    expect(headers).toEqual({ Authorization: 'Bearer test-token' });
  });
});
