import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getAuthorizationHeader, getSession } from '@/lib/session-store';
import { apiClient } from '../api-client';

vi.mock('@/lib/session-store', () => ({
  getAuthorizationHeader: vi.fn(),
  getSession: vi.fn(),
}));

describe('api-client', () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as any).window;
  const originalDocument = (global as any).document;
  const getAuthorizationHeaderMock = vi.mocked(getAuthorizationHeader);
  const getSessionMock = vi.mocked(getSession);
  const jsonResponse = (body: unknown, status = 200, statusText = 'OK') => ({
    status,
    statusText,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    getAuthorizationHeaderMock.mockResolvedValue({});
    getSessionMock.mockResolvedValue(null);
    (global as any).document = undefined;
  });

  afterEach(() => {
    global.fetch = originalFetch as any;
    (global as any).window = originalWindow;
    (global as any).document = originalDocument;
  });

  it('uses electron bridge when available', async () => {
    const requestMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      data: { foo: 'bar' },
    });
    (global as any).window = {
      electronAPI: {
        api: { request: requestMock },
      },
    };

    const res = await apiClient.post('/api/test', { hello: 'world' }, { headers: { 'X-T': '1' } });

    expect(requestMock).toHaveBeenCalledWith('POST', '/api/test', { hello: 'world' }, { 'X-T': '1' });
    expect(res).toEqual(
      expect.objectContaining({ ok: true, data: { foo: 'bar' }, status: 200 }),
    );
  });

  it('falls back to fetch and parses json response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      statusText: 'Created',
      ok: true,
      text: async () => JSON.stringify({ created: true }),
    });
    global.fetch = fetchMock as any;
    // remove electron bridge
    (global as any).window = {};

    const res = await apiClient.put('/api/resource', { id: 1 });

    expect(fetchMock).toHaveBeenCalledWith('/api/resource', expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: 1 }),
    }));
    expect(res.data).toEqual({ created: true });
    expect(res.ok).toBe(true);
  });

  it('returns raw text when json parsing fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      statusText: 'Error',
      ok: false,
      text: async () => 'plain-text-error',
    });
    global.fetch = fetchMock as any;
    (global as any).window = {};

    const res = await apiClient.get('/api/fail');

    expect(res.data).toBe('plain-text-error');
    expect(res.ok).toBe(false);
  });

  it('appends query params for GET requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as any;
    (global as any).window = {};

    await apiClient.get('/api/transactions/search', {
      params: { query: 'chips', limit: 20 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/transactions/search?query=chips&limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('supports sending raw bodies without JSON stringification', async () => {
    const requestMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      data: null,
    });
    (global as any).window = {
      electronAPI: {
        api: { request: requestMock },
      },
    };

    const payload = 'raw-blob';
    await apiClient.patch('/api/raw', payload, { rawBody: true });

    expect(requestMock).toHaveBeenCalledWith('PATCH', '/api/raw', payload, {});
  });

  it('adds authorization headers when provided by session store', async () => {
    getAuthorizationHeaderMock.mockResolvedValue({ Authorization: 'Bearer token-123' });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as any;
    (global as any).window = {};

    await apiClient.post('/api/secure', { ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/secure',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      }),
    );
  });

  it('does not override authorization header set by the caller', async () => {
    getAuthorizationHeaderMock.mockResolvedValue({ Authorization: 'Bearer token-123' });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as any;
    (global as any).window = {};

    await apiClient.post('/api/secure', { ok: true }, { headers: { Authorization: 'Token custom' } });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/secure',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Token custom' }),
      }),
    );
  });

  it('sets Accept-Language based on stored locale when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as any;
    (global as any).window = {
      localStorage: {
        getItem: vi.fn().mockReturnValue('fr-FR'),
      },
    };
    (global as any).document = {};

    await apiClient.get('/api/locale');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/locale',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Accept-Language': 'fr' }),
      }),
    );
  });

  it('keeps Accept-Language when explicitly set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as any;
    (global as any).window = {
      localStorage: {
        getItem: vi.fn().mockReturnValue('fr-FR'),
      },
    };
    (global as any).document = {};

    await apiClient.get('/api/locale', { headers: { 'Accept-Language': 'he' } });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/locale',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Accept-Language': 'he' }),
      }),
    );
  });

  it('merges query params with existing query and hash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as any;
    (global as any).window = {};

    await apiClient.get('/api/items?sort=asc#top', {
      params: {
        query: 'chips',
        limit: 20,
        empty: null,
        skip: undefined,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items?sort=asc&query=chips&limit=20#top',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not send a body for GET requests even when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as any;
    (global as any).window = {};

    await apiClient.get('/api/no-body', { body: { ok: true } } as any);

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options?.body).toBeUndefined();
  });

  it('sends raw bodies through fetch without JSON stringification', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as any;
    (global as any).window = {};

    await apiClient.post('/api/raw', 'plain-body', { rawBody: true });

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options?.body).toBe('plain-body');
  });

  it('coalesces concurrent forecast requests into a single network call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ forecastId: 'coalesced' }));
    global.fetch = fetchMock as any;
    (global as any).window = {};

    const [first, second] = await Promise.all([
      apiClient.get('/api/forecast/daily?days=90'),
      apiClient.get('/api/forecast/daily?days=90'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.data).toEqual({ forecastId: 'coalesced' });
    expect(second.data).toEqual({ forecastId: 'coalesced' });
  });

  it('serves forecast responses from short-lived cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ forecastId: 'cached' }));
    global.fetch = fetchMock as any;
    (global as any).window = {};

    const first = await apiClient.get('/api/forecast/daily?days=91');
    const second = await apiClient.get('/api/forecast/daily?days=91');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.data).toEqual({ forecastId: 'cached' });
    expect(second.data).toEqual({ forecastId: 'cached' });
  });

  it('bypasses forecast cache with noCache and refreshes cache for later reads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ forecastId: 'stale' }))
      .mockResolvedValueOnce(jsonResponse({ forecastId: 'fresh' }));
    global.fetch = fetchMock as any;
    (global as any).window = {};

    const initial = await apiClient.get('/api/forecast/daily?days=92');
    const forced = await apiClient.get('/api/forecast/daily?days=92&noCache=1');
    const cachedAfterForced = await apiClient.get('/api/forecast/daily?days=92');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(initial.data).toEqual({ forecastId: 'stale' });
    expect(forced.data).toEqual({ forecastId: 'fresh' });
    expect(cachedAfterForced.data).toEqual({ forecastId: 'fresh' });
  });
});
