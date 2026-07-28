/**
 * Tests for SecurityStatusManager, focused on the credential-encryption
 * consistency check: verifying the active key can actually decrypt what's
 * already stored, not just that key retrieval didn't throw.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// secure-key-manager.js is exercised for real (not mocked) in the one test
// that calls the full getSecurityStatus() - forcing it down its documented
// env-key fast path (see electron/secure-key-manager.js) keeps that
// deterministic and avoids a real OS keychain round-trip in tests.
//
// security-logger, biometric-auth, and the credentials service are all
// injected via the globalThis.__SHEKELSYNC_*__ override convention already
// used by electron/api-security.js, rather than vi.mock - CJS sibling
// requires under electron/ aren't reliably intercepted by vi.mock in this
// project's vitest/CJS-interop setup.
const mockLogSecurityStatusCheck = vi.fn();
const mockGetAvailabilityDetails = vi.fn();

describe('SecurityStatusManager', () => {
  let securityStatusManager;
  let mockListCredentials;

  beforeEach(async () => {
    vi.clearAllMocks();

    process.env.SHEKELSYNC_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.ALLOW_INSECURE_ENV_KEY = 'true';
    mockGetAvailabilityDetails.mockResolvedValue({
      available: false,
      type: null,
      reason: 'Biometric authentication not available',
    });

    mockListCredentials = vi.fn().mockResolvedValue([]);
    globalThis.__SHEKELSYNC_CREDENTIALS_SERVICE__ = { listCredentials: mockListCredentials };
    globalThis.__SHEKELSYNC_SECURITY_LOGGER__ = { logSecurityStatusCheck: mockLogSecurityStatusCheck };
    globalThis.__SHEKELSYNC_BIOMETRIC_AUTH__ = { getAvailabilityDetails: mockGetAvailabilityDetails };

    vi.resetModules();
    const module = await import('../security/security-status.js');
    securityStatusManager = module.default || module;
  });

  afterEach(() => {
    delete globalThis.__SHEKELSYNC_CREDENTIALS_SERVICE__;
    delete globalThis.__SHEKELSYNC_SECURITY_LOGGER__;
    delete globalThis.__SHEKELSYNC_BIOMETRIC_AUTH__;
    delete process.env.SHEKELSYNC_ENCRYPTION_KEY;
    delete process.env.ALLOW_INSECURE_ENV_KEY;
  });

  describe('getCredentialEncryptionStatus', () => {
    test('reports checked with zero counts when there are no saved credentials', async () => {
      mockListCredentials.mockResolvedValue([]);

      const result = await securityStatusManager.getCredentialEncryptionStatus();

      expect(result).toEqual({
        checked: true,
        totalCount: 0,
        failedCount: 0,
        failedCredentials: [],
      });
    });

    test('reports which credentials failed without exposing any decrypted values', async () => {
      mockListCredentials.mockResolvedValue([
        {
          id: 3,
          vendor: 'max',
          nickname: 'MAX Avner',
          username: null,
          password: null,
          decryptFailed: true,
          decryptFailedFields: ['username', 'password'],
        },
        {
          id: 4,
          vendor: 'max',
          nickname: 'MAX Lois',
          username: 'dec(user)',
          password: 'dec(pass)',
        },
      ]);

      const result = await securityStatusManager.getCredentialEncryptionStatus();

      expect(result.checked).toBe(true);
      expect(result.totalCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.failedCredentials).toEqual([{ id: 3, vendor: 'max', nickname: 'MAX Avner' }]);
      expect(result.failedCredentials[0]).not.toHaveProperty('username');
      expect(result.failedCredentials[0]).not.toHaveProperty('password');
    });

    test('reports checked:false without throwing when the credentials service errors', async () => {
      mockListCredentials.mockRejectedValue(new Error('db unavailable'));

      const result = await securityStatusManager.getCredentialEncryptionStatus();

      expect(result.checked).toBe(false);
      expect(result.failedCount).toBe(0);
      expect(result.error).toBe('db unavailable');
    });
  });

  describe('getSecurityStatus integration', () => {
    test('includes credentialEncryption in the aggregated status and logs it', async () => {
      mockListCredentials.mockResolvedValue([
        { id: 1, vendor: 'discount', nickname: 'Discount', decryptFailed: true, decryptFailedFields: ['password'] },
      ]);

      const status = await securityStatusManager.getSecurityStatus();

      expect(status.credentialEncryption.checked).toBe(true);
      expect(status.credentialEncryption.failedCount).toBe(1);
      expect(mockLogSecurityStatusCheck).toHaveBeenCalledWith(status);
    });
  });

  describe('calculateSecurityLevel', () => {
    const baseStatus = () => ({
      encryption: { status: 'active' },
      keychain: { status: 'connected' },
      authentication: { isActive: true },
      biometric: { available: true },
      platform: { os: 'darwin' },
      credentialEncryption: { checked: true, totalCount: 1, failedCount: 0, failedCredentials: [] },
    });

    test('is secure when every check passes, including credential decryption', () => {
      expect(securityStatusManager.calculateSecurityLevel(baseStatus())).toBe('secure');
    });

    test('drops to warning when a saved credential fails to decrypt but everything else is fine', () => {
      const status = baseStatus();
      status.credentialEncryption = {
        checked: true,
        totalCount: 2,
        failedCount: 1,
        failedCredentials: [{ id: 3, vendor: 'max', nickname: 'MAX Avner' }],
      };

      expect(securityStatusManager.calculateSecurityLevel(status)).toBe('warning');
    });

    test('does not penalize security level when the check itself could not run', () => {
      const status = baseStatus();
      status.credentialEncryption = { checked: false, totalCount: 0, failedCount: 0, failedCredentials: [] };

      expect(securityStatusManager.calculateSecurityLevel(status)).toBe('secure');
    });
  });

  describe('generateWarnings', () => {
    const baseStatus = () => ({
      encryption: { status: 'active' },
      keychain: { status: 'connected' },
      authentication: { isActive: true, requiresReauth: false },
      biometric: { available: true },
      platform: { os: 'darwin' },
    });

    test('adds a high-severity warning naming the affected accounts', () => {
      const status = {
        ...baseStatus(),
        credentialEncryption: {
          checked: true,
          totalCount: 2,
          failedCount: 1,
          failedCredentials: [{ id: 3, vendor: 'max', nickname: 'MAX Avner' }],
        },
      };

      const warnings = securityStatusManager.generateWarnings(status);
      const credentialWarning = warnings.find((warning) => warning.type === 'credential_encryption');

      expect(credentialWarning).toBeDefined();
      expect(credentialWarning.severity).toBe('high');
      expect(credentialWarning.message).toContain('MAX Avner');
      expect(credentialWarning.message).toContain('1 of 2');
    });

    test('adds no credential_encryption warning when nothing failed', () => {
      const status = {
        ...baseStatus(),
        credentialEncryption: { checked: true, totalCount: 2, failedCount: 0, failedCredentials: [] },
      };

      const warnings = securityStatusManager.generateWarnings(status);

      expect(warnings.find((warning) => warning.type === 'credential_encryption')).toBeUndefined();
    });

    test('adds no credential_encryption warning when the check could not run', () => {
      const status = {
        ...baseStatus(),
        credentialEncryption: { checked: false, totalCount: 0, failedCount: 0, failedCredentials: [] },
      };

      const warnings = securityStatusManager.generateWarnings(status);

      expect(warnings.find((warning) => warning.type === 'credential_encryption')).toBeUndefined();
    });
  });
});
