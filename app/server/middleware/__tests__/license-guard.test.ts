import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  clearCache,
  EXEMPT_WRITE_ROUTES,
  getLicenseStatus,
  isProtectedRoute,
  licenseGuardMiddleware,
  PROTECTED_ROUTES,
  WRITE_METHODS,
} = require('../license-guard.js');

describe('public-access license guard compatibility shim', () => {
  it('does not classify any route as license-protected', () => {
    for (const path of [
      '/api',
      '/api/optimizer/generate',
      '/api/transactions',
      '/API/CREDENTIALS?source=settings',
      '/health',
      '',
      null,
    ]) {
      expect(isProtectedRoute(path)).toBe(false);
    }

    expect(PROTECTED_ROUTES).toEqual([]);
    expect(EXEMPT_WRITE_ROUTES).toEqual([]);
    expect(WRITE_METHODS).toEqual([]);
  });

  it('always reports writable public access without consulting a license', async () => {
    clearCache();
    await expect(getLicenseStatus()).resolves.toEqual({ isReadOnly: false });
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'passes %s requests through without sending a response',
    (method) => {
      const nextResult = Symbol('next-result');
      const next = vi.fn(() => nextResult);
      const response = {
        status: vi.fn(() => {
          throw new Error('The public-access guard must not send a response');
        }),
      };

      const result = licenseGuardMiddleware(
        { method, originalUrl: '/api/optimizer/generate' },
        response,
        next,
      );

      expect(result).toBe(nextResult);
      expect(next).toHaveBeenCalledOnce();
      expect(response.status).not.toHaveBeenCalled();
    },
  );
});
