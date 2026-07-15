import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const requireModule = createRequire(import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const licenseServicePath = path.join(testDirectory, '..', 'license-service.js');
const publicAccessPolicyPath = path.join(testDirectory, '..', 'public-access-policy.js');

function loadLicenseService() {
  const dbManager = {
    mode: 'sqlite',
    query: vi.fn(() => {
      throw new Error('Public access checks must not query the license database');
    }),
  };
  const supabase = {
    getSupabaseClient: vi.fn(() => {
      throw new Error('Public access checks must not create a Supabase client');
    }),
    isSupabaseConfigured: vi.fn(() => {
      throw new Error('Public access checks must not inspect Supabase configuration');
    }),
  };

  const localRequire = (request) => {
    if (request === 'crypto' || request === 'os') return requireModule(request);
    if (request === 'electron') return { app: { getVersion: vi.fn(() => '0.0.0-test') } };
    if (request === 'uuid') return { v4: vi.fn(() => 'public-access-test-id') };
    if (request === './database') return { dbManager };
    if (request === './supabase-client') return supabase;
    if (request === './public-access-policy') return requireModule(publicAccessPolicyPath);
    if (request === './logger') {
      return {
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      };
    }

    throw new Error(`Unexpected license-service dependency: ${request}`);
  };

  const source = readFileSync(licenseServicePath, 'utf8');
  const compile = runInThisContext(
    `(function (exports, require, module, __filename, __dirname) { ${source}\n})`,
    { filename: licenseServicePath },
  );
  const moduleRecord = { exports: {} };
  compile(
    moduleRecord.exports,
    localRequire,
    moduleRecord,
    licenseServicePath,
    path.dirname(licenseServicePath),
  );

  return {
    service: moduleRecord.exports,
    dbManager,
    supabase,
  };
}

describe('public access policy', () => {
  it('allows all formerly license-gated features without registration', async () => {
    const imported = await import('../public-access-policy.js');
    const accessPolicy = imported.default || imported;

    expect(accessPolicy.getPublicAccessStatus()).toMatchObject({
      registered: true,
      licenseType: 'pro',
      isReadOnly: false,
      canWrite: true,
    });
    expect(accessPolicy.isPublicWriteAllowed()).toBe(true);

    const firstStatus = accessPolicy.getPublicAccessStatus();
    firstStatus.canWrite = false;
    expect(accessPolicy.getPublicAccessStatus().canWrite).toBe(true);
  });

  it('keeps legacy license IPC helpers public without database or cloud validation', async () => {
    const { service, dbManager, supabase } = loadLicenseService();

    await expect(service.checkLicenseStatus()).resolves.toEqual({
      registered: true,
      licenseType: 'pro',
      isReadOnly: false,
      canWrite: true,
      offlineMode: false,
      syncedToCloud: true,
    });
    await expect(service.isWriteOperationAllowed()).resolves.toBe(true);
    await expect(service.validateOnline()).resolves.toEqual({
      success: true,
      status: {
        registered: true,
        licenseType: 'pro',
        isReadOnly: false,
        canWrite: true,
        offlineMode: false,
        syncedToCloud: true,
      },
    });

    expect(dbManager.query).not.toHaveBeenCalled();
    expect(supabase.getSupabaseClient).not.toHaveBeenCalled();
    expect(supabase.isSupabaseConfigured).not.toHaveBeenCalled();
  });

  it('keeps the legacy server middleware as a write-through shim', async () => {
    const imported = await import('../../app/server/middleware/license-guard.js');
    const guard = imported.default || imported;
    const next = vi.fn();
    const response = {
      status: vi.fn(() => {
        throw new Error('The public access guard must not send a response');
      }),
    };

    guard.licenseGuardMiddleware(
      { method: 'POST', path: '/api/transactions' },
      response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
    expect(guard.isProtectedRoute('/api/transactions')).toBe(false);
    await expect(guard.getLicenseStatus()).resolves.toEqual({ isReadOnly: false });
  });
});
