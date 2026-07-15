import { afterEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const database = require('../../services/database.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  clearCache,
  EXEMPT_WRITE_ROUTES,
  getLicenseStatus,
  isProtectedRoute,
  licenseGuardMiddleware,
  WRITE_METHODS,
} = require('../license-guard.js');

function mockLicense(license: Record<string, unknown>) {
  const release = vi.fn();
  const query = vi.fn().mockResolvedValue({ rows: [license] });
  vi.spyOn(database, 'getClient').mockResolvedValue({ query, release });
  return { query, release };
}

function createResponse() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { json, status };
}

describe('license guard middleware', () => {
  afterEach(() => {
    clearCache();
    vi.restoreAllMocks();
  });

  it.each([
    '/api/optimizer/generate',
    '/api/smart-actions/4/status',
    '/api/categories/hierarchy',
    '/api/patterns',
    '/api/analytics/quests/generate',
    '/api/analytics/subscriptions/4',
    '/api/spending-categories/initialize',
    '/api/category-variability/4',
    '/api/onboarding/dismiss',
    '/api/guide-tips/dismiss',
    '/api/migrate',
    '/api/future-write-route',
  ])('protects mutating API path %s by default', (path) => {
    expect(isProtectedRoute(path)).toBe(true);
  });

  it.each([
    '/api/donations',
    '/api/donations/intent?source=read-only',
    '/API/CHAT',
    '/api/chat/stream',
    '/api/chat/conversations/4',
    '/api/security/authenticate',
  ])('keeps the intentional write exemption %s available', (path) => {
    expect(isProtectedRoute(path)).toBe(false);
  });

  it.each([
    '/api/donations-admin',
    '/api/chat-export',
    '/api/security/authenticate-extra',
  ])('does not exempt a lookalike path %s', (path) => {
    expect(isProtectedRoute(path)).toBe(true);
  });

  it('ignores non-API and missing paths', () => {
    expect(isProtectedRoute('/health')).toBe(false);
    expect(isProtectedRoute('')).toBe(false);
    expect(isProtectedRoute(null)).toBe(false);
  });

  it('documents only the narrow intentional exemptions', () => {
    expect(EXEMPT_WRITE_ROUTES).toEqual([
      '/api/donations',
      '/api/chat',
      '/api/security/authenticate',
    ]);
    expect(WRITE_METHODS).toEqual(['POST', 'PUT', 'DELETE', 'PATCH']);
  });

  it('uses originalUrl and blocks expired licenses', async () => {
    const { release } = mockLicense({
      id: 1,
      license_type: 'expired',
      trial_start_date: new Date().toISOString(),
    });
    const { json, status } = createResponse();
    const next = vi.fn();

    await licenseGuardMiddleware({
      method: 'POST',
      path: '/hierarchy',
      originalUrl: '/api/categories/hierarchy?source=settings',
    }, { status }, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'LICENSE_READ_ONLY' }));
    expect(next).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('allows %s requests without checking a license', async (method) => {
    const getClient = vi.spyOn(database, 'getClient');
    const next = vi.fn();

    await licenseGuardMiddleware({
      method,
      path: '/api/categories/hierarchy',
      originalUrl: '/api/categories/hierarchy',
    }, createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getClient).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', '/api/donations/intent'],
    ['POST', '/api/chat/stream'],
    ['DELETE', '/api/chat/conversations/4'],
    ['POST', '/api/security/authenticate'],
  ])('allows exempt %s %s without checking a license', async (method, originalUrl) => {
    const getClient = vi.spyOn(database, 'getClient');
    const next = vi.fn();

    await licenseGuardMiddleware({ method, path: originalUrl, originalUrl }, createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getClient).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('allows licensed %s requests', async (method) => {
    const { release } = mockLicense({
      id: 1,
      license_type: 'pro',
      trial_start_date: new Date().toISOString(),
    });
    const next = vi.fn();

    await licenseGuardMiddleware({
      method,
      path: '/api/future-write-route',
    }, createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    clearCache();
  });

  it('treats a missing license as read-only and caches the result', async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const getClient = vi.spyOn(database, 'getClient').mockResolvedValue({ query, release });

    await expect(getLicenseStatus()).resolves.toEqual({
      isReadOnly: true,
      reason: 'No license registered',
    });
    await expect(getLicenseStatus()).resolves.toEqual({
      isReadOnly: true,
      reason: 'No license registered',
    });

    expect(getClient).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'valid trial',
      license: {
        id: 1,
        license_type: 'trial',
        trial_start_date: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
        offline_grace_start: null,
      },
      expected: { isReadOnly: false },
    },
    {
      name: 'expired trial',
      license: {
        id: 1,
        license_type: 'trial',
        trial_start_date: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString(),
        offline_grace_start: null,
      },
      expected: { isReadOnly: true, reason: 'Trial period expired' },
    },
    {
      name: 'expired offline grace',
      license: {
        id: 1,
        license_type: 'trial',
        trial_start_date: new Date().toISOString(),
        offline_grace_start: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString(),
      },
      expected: { isReadOnly: true, reason: 'Offline grace period expired' },
    },
  ])('evaluates a $name license', async ({ license, expected }) => {
    const { release } = mockLicense(license);

    await expect(getLicenseStatus()).resolves.toEqual(expected);
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails open when the license database is unavailable', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(database, 'getClient').mockRejectedValue(new Error('database unavailable'));

    await expect(getLicenseStatus()).resolves.toEqual({ isReadOnly: false });
    expect(warning).toHaveBeenCalledWith(
      '[LicenseGuard] Failed to check license status:',
      'database unavailable',
    );
  });
});
