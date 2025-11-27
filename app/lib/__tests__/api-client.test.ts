import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { apiClient } from '../api-client';

describe('api-client', () => {
  const originalFetch = global.fetch;
  const originalElectron = (global as any).window?.electronAPI;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch as any;
    (global as any).window = { electronAPI: originalElectron };
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
});
