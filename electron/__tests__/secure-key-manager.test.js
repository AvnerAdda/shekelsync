/**
 * Security Tests for Secure Key Manager
 * Tests encryption key storage and management
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';

const testUserDataPath = '/tmp/shekelsync-secure-key-manager-test';

function encryptCredential(value, keyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
}

function encryptLegacyConfig(config) {
  const iv = crypto.randomBytes(16);
  const legacyKey = crypto.scryptSync('electron-app-key', 'salt', 32);
  try {
    const cipher = crypto.createCipheriv('aes-256-ctr', legacyKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(config), 'utf8'),
      cipher.final(),
    ]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  } finally {
    legacyKey.fill(0);
  }
}

// Mock keytar
const mockKeytar = {
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
};

const mockApp = {
  getPath: vi.fn(() => testUserDataPath),
  isPackaged: true,
};

const mockSafeStorage = {
  isEncryptionAvailable: vi.fn(() => false),
  decryptString: vi.fn(),
  encryptString: vi.fn(),
};

vi.mock('keytar', () => ({
  default: mockKeytar,
  ...mockKeytar,
}));

// Mock electron app
vi.mock('electron', () => ({
  app: mockApp,
  safeStorage: mockSafeStorage,
}));

// Mock paths module
vi.mock('../paths', () => ({
  resolveAppPath: vi.fn((path) => path),
  requireFromApp: vi.fn((module) => {
    if (module === 'keytar') return mockKeytar;
    throw new Error(`Module not found: ${module}`);
  }),
}));

describe('SecureKeyManager', () => {
  let secureKeyManager;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    mockKeytar.getPassword.mockReset();
    mockKeytar.setPassword.mockReset();
    mockKeytar.deletePassword.mockReset();
    delete process.env.SHEKELSYNC_ENCRYPTION_KEY;
    delete process.env.KEYTAR_DISABLE;
    delete process.env.ALLOW_INSECURE_ENV_KEY;
    globalThis.__SHEKELSYNC_CREDENTIAL_KEY_VALIDATOR__ = vi.fn(() => ({ status: 'fresh' }));
    delete globalThis.__SHEKELSYNC_KEY_SCOPE__;
    delete globalThis.__SHEKELSYNC_SAFE_STORAGE__;
    globalThis.__SHEKELSYNC_KEYTAR__ = mockKeytar;
    mockApp.isPackaged = true;
    mockApp.getPath.mockReset();
    mockApp.getPath.mockReturnValue(testUserDataPath);
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    mockSafeStorage.decryptString.mockReset();
    mockSafeStorage.encryptString.mockReset();

    // Reset module cache to get fresh instance
    vi.resetModules();

    // Dynamically import the module
    const module = await import('../secure-key-manager.js');
    secureKeyManager = module.default || module;
  });

  afterEach(() => {
    fs.rmSync(testUserDataPath, { recursive: true, force: true });
    delete globalThis.__SHEKELSYNC_CREDENTIAL_KEY_VALIDATOR__;
    delete globalThis.__SHEKELSYNC_KEY_SCOPE__;
    delete globalThis.__SHEKELSYNC_SAFE_STORAGE__;
  });

  describe('Key Generation', () => {
    test('should generate a valid 256-bit key', async () => {
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key = secureKeyManager.generateKey();

      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBe(64); // 32 bytes = 64 hex characters

      // Verify it's valid hex
      expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);

      // Verify it converts to 32 bytes
      const buffer = Buffer.from(key, 'hex');
      expect(buffer.length).toBe(32);
    });

    test('should generate unique keys each time', async () => {
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key1 = secureKeyManager.generateKey();
      const key2 = secureKeyManager.generateKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('Key Validation', () => {
    beforeEach(async () => {
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
    });

    test('should validate correct key format', () => {
      const validKey = crypto.randomBytes(32).toString('hex');
      expect(secureKeyManager.validateKey(validKey)).toBe(true);
    });

    test('should reject invalid key length', () => {
      const shortKey = crypto.randomBytes(16).toString('hex'); // 16 bytes
      expect(secureKeyManager.validateKey(shortKey)).toBe(false);
    });

    test('should reject non-hex keys', () => {
      const invalidKey = 'not-a-hex-string-but-64-characters-long-xxxxxxxxxxxxxxxxxxxxxx';
      expect(secureKeyManager.validateKey(invalidKey)).toBe(false);
      expect(secureKeyManager.validateKey(`${'a'.repeat(64)}junk`)).toBe(false);
    });

    test('should reject null/undefined keys', () => {
      expect(secureKeyManager.validateKey(null)).toBe(false);
      expect(secureKeyManager.validateKey(undefined)).toBe(false);
    });

    test('should reject non-string keys', () => {
      expect(secureKeyManager.validateKey(12345)).toBe(false);
      expect(secureKeyManager.validateKey({})).toBe(false);
    });
  });

  describe('Key Retrieval - Environment Variable', () => {
    test('should use environment variable if set', async () => {
      const envKey = crypto.randomBytes(32).toString('hex');
      process.env.SHEKELSYNC_ENCRYPTION_KEY = envKey;
      process.env.ALLOW_INSECURE_ENV_KEY = 'true';

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key = await secureKeyManager.getKey();

      expect(key).toBe(envKey);
      expect(mockKeytar.getPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
      );
      expect(secureKeyManager.isInitialized()).toBe(true);
    });

    test('uses the Linux development environment fallback without retrying disabled keytar', async () => {
      const envKey = crypto.randomBytes(32).toString('hex');
      process.env.SHEKELSYNC_ENCRYPTION_KEY = envKey;
      process.env.ALLOW_INSECURE_ENV_KEY = 'true';
      process.env.KEYTAR_DISABLE = 'true';

      vi.resetModules();
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      await expect(secureKeyManager.getKey()).resolves.toBe(envKey);
      expect(mockKeytar.getPassword).not.toHaveBeenCalled();
      expect(secureKeyManager.isInitialized()).toBe(true);
    });

    test('should cache key from environment', async () => {
      const envKey = crypto.randomBytes(32).toString('hex');
      process.env.SHEKELSYNC_ENCRYPTION_KEY = envKey;
      process.env.ALLOW_INSECURE_ENV_KEY = 'true';

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key1 = await secureKeyManager.getKey();
      const key2 = await secureKeyManager.getKey();

      expect(key1).toBe(envKey);
      expect(key2).toBe(envKey);
      expect(mockKeytar.getPassword).toHaveBeenCalledTimes(1);
    });

    test('should reject invalid environment key', async () => {
      process.env.SHEKELSYNC_ENCRYPTION_KEY = 'invalid-key';
      process.env.ALLOW_INSECURE_ENV_KEY = 'true';

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      await expect(secureKeyManager.getKey()).rejects.toThrow(
        'SHEKELSYNC_ENCRYPTION_KEY environment variable is invalid'
      );
      expect(secureKeyManager.isInitialized()).toBe(false);
    });

    test('rejects an environment key that conflicts with existing scoped material', async () => {
      const envKey = crypto.randomBytes(32).toString('hex');
      const scopedKey = crypto.randomBytes(32).toString('hex');
      process.env.SHEKELSYNC_ENCRYPTION_KEY = envKey;
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key:production' ? scopedKey : null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'fresh' }),
      })).rejects.toThrow('conflicts with existing scoped key material');

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(secureKeyManager.isInitialized()).toBe(false);
    });

    test.each(['mismatch', 'missing', 'unavailable', 'ambiguous', 'partial', 'config_mismatch'])(
      'rejects an environment key when credential validation is %s',
      async (status) => {
        process.env.SHEKELSYNC_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
        mockKeytar.getPassword.mockResolvedValue(null);

        await expect(secureKeyManager.getKey({
          validateCandidate: () => ({ status }),
        })).rejects.toThrow('does not match existing credential data');

        expect(mockKeytar.setPassword).not.toHaveBeenCalled();
        expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
      },
    );

    test('rejects candidate-unbound external config evidence', async () => {
      process.env.SHEKELSYNC_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'config_match', configStatus: 'base64' }),
      })).rejects.toThrow('does not match existing credential data');
      expect(secureKeyManager.isInitialized()).toBe(false);
    });

    test('accepts candidate-readable external config only after checking scoped stores', async () => {
      const envKey = crypto.randomBytes(32).toString('hex');
      process.env.SHEKELSYNC_ENCRYPTION_KEY = envKey;
      mockKeytar.getPassword.mockResolvedValue(null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'config_match', configStatus: 'candidate' }),
      })).resolves.toBe(envKey);

      expect(mockKeytar.getPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
      );
      expect(secureKeyManager.isInitialized()).toBe(true);
    });

    test('clearing the cache clears the explicit initialization state', async () => {
      process.env.SHEKELSYNC_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockResolvedValue(null);

      await secureKeyManager.getKey();
      expect(secureKeyManager.isInitialized()).toBe(true);

      secureKeyManager.clearCache();
      expect(secureKeyManager.isInitialized()).toBe(false);
    });
  });

  describe('Key Retrieval - Keychain', () => {
    test('should load key from keychain if available', async () => {
      const storedKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key:production' ? storedKey : null);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key = await secureKeyManager.getKey();

      expect(key).toBe(storedKey);
      expect(mockKeytar.getPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
      );
    });

    test('should generate and store new key if keychain is empty', async () => {
      mockKeytar.getPassword.mockResolvedValue(null);
      mockKeytar.setPassword.mockResolvedValue(undefined);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key = await secureKeyManager.getKey();

      expect(key).toBeDefined();
      expect(secureKeyManager.validateKey(key)).toBe(true);
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
        key
      );
    });

    test('should cache key after loading from keychain', async () => {
      const storedKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key:production' ? storedKey : null);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key1 = await secureKeyManager.getKey();
      const key2 = await secureKeyManager.getKey();

      expect(key1).toBe(storedKey);
      expect(key2).toBe(storedKey);
      expect(mockKeytar.getPassword).toHaveBeenCalledTimes(1); // Scoped only; legacy stays untouched
    });

    test('uses a separate development keychain account for unpackaged Electron', async () => {
      globalThis.__SHEKELSYNC_KEY_SCOPE__ = 'development';
      mockKeytar.getPassword.mockResolvedValue(null);

      const key = await secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'empty' }),
      });

      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:development',
        key,
      );
      expect(mockKeytar.setPassword).not.toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key',
        expect.anything(),
      );
    });

    test('migrates a legacy key only after it authenticates all credential data', async () => {
      const legacyKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key' ? legacyKey : null);
      const validateCandidate = vi.fn((candidate) => ({
        status: candidate === legacyKey ? 'match' : 'mismatch',
      }));

      const key = await secureKeyManager.getKey({ validateCandidate });

      expect(key).toBe(legacyKey);
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
        legacyKey,
      );
      expect(mockKeytar.setPassword).not.toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key',
        expect.anything(),
      );
      expect(validateCandidate.mock.invocationCallOrder[0])
        .toBeLessThan(mockKeytar.setPassword.mock.invocationCallOrder[0]);
    });

    test('migrates through a legacy-key config only after authenticating its custom database', async () => {
      const legacyKey = crypto.randomBytes(32).toString('hex');
      const customDatabasePath = path.join(testUserDataPath, 'custom.sqlite');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(customDatabasePath, 'sqlite-placeholder');
      fs.writeFileSync(
        path.join(testUserDataPath, 'config.enc'),
        encryptLegacyConfig({ database: { mode: 'sqlite', path: customDatabasePath } }),
      );

      const openedPaths = [];
      class FakeDatabase {
        constructor(databasePath, options) {
          openedPaths.push({ databasePath, options });
        }

        pragma() {}

        prepare(sql) {
          if (sql.includes('sqlite_master')) return { get: () => ({ present: 1 }) };
          return {
            all: () => [{
              username: encryptCredential('user', legacyKey),
              password: encryptCredential('secret', legacyKey),
              id_number: null,
              identification_code: null,
            }],
          };
        }

        close() {}
      }

      const validatorModule = await import('../credential-key-validator.js');
      const { validateCredentialKey } = validatorModule.default || validatorModule;
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key' ? legacyKey : null);

      await expect(secureKeyManager.getKey({
        validateCandidate: (candidate) => validateCredentialKey(candidate, {
          userDataPath: testUserDataPath,
          databaseCtor: FakeDatabase,
        }),
      })).resolves.toBe(legacyKey);

      expect(openedPaths.length).toBeGreaterThanOrEqual(2);
      expect(openedPaths.every(({ databasePath }) => databasePath === customDatabasePath)).toBe(true);
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
        legacyKey,
      );
    });

    test('does not persist a legacy key that fails credential authentication', async () => {
      const legacyKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key' ? legacyKey : null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'mismatch' }),
      })).rejects.toThrow('shared legacy encryption key exists');

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
    });

    test('uses an identity-local legacy key read-only for an empty credential store', async () => {
      const legacySafeKey = crypto.randomBytes(32).toString('hex');
      const legacyPath = path.join(testUserDataPath, '.encryption-key.enc');
      const scopedPath = path.join(testUserDataPath, '.encryption-key.production.enc');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(legacyPath, 'legacy-wrapper');
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(legacySafeKey);
      mockSafeStorage.encryptString.mockReturnValue(Buffer.from('scoped-wrapper'));
      mockKeytar.getPassword.mockResolvedValue(null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'empty' }),
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      })).resolves.toBe(legacySafeKey);

      // Read-only adoption: nothing may be persisted until credential data
      // authenticates the key on a later run.
      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
      expect(mockKeytar.getPassword).not.toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key',
      );
      expect(fs.readFileSync(legacyPath, 'utf8')).toBe('legacy-wrapper');
      expect(fs.existsSync(scopedPath)).toBe(false);
    });

    test('resumes an interrupted first run from an identity-local legacy key', async () => {
      const legacySafeKey = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(path.join(testUserDataPath, '.encryption-key.enc'), 'legacy-wrapper');
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(legacySafeKey);
      mockKeytar.getPassword.mockResolvedValue(null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'fresh' }),
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      })).resolves.toBe(legacySafeKey);

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    });

    test('uses an identity-local legacy key read-only for a candidate-bound external configuration', async () => {
      const legacySafeKey = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(path.join(testUserDataPath, '.encryption-key.enc'), 'legacy-wrapper');
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(legacySafeKey);
      mockKeytar.getPassword.mockResolvedValue(null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'config_match', configStatus: 'candidate' }),
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      })).resolves.toBe(legacySafeKey);

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    });

    test('refuses an identity-local legacy key whose external config does not decrypt under it', async () => {
      const legacySafeKey = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(path.join(testUserDataPath, '.encryption-key.enc'), 'legacy-wrapper');
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(legacySafeKey);
      mockKeytar.getPassword.mockResolvedValue(null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'config_match', configStatus: 'legacy' }),
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      })).rejects.toThrow('identity-local legacy key');

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    });

    test('still refuses an identity-local legacy key that fails credential authentication', async () => {
      const legacySafeKey = crypto.randomBytes(32).toString('hex');
      const legacyPath = path.join(testUserDataPath, '.encryption-key.enc');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(legacyPath, 'legacy-wrapper');
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(legacySafeKey);
      mockKeytar.getPassword.mockResolvedValue(null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'mismatch' }),
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      })).rejects.toThrow('identity-local legacy key');

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(fs.readFileSync(legacyPath, 'utf8')).toBe('legacy-wrapper');
      expect(fs.existsSync(path.join(testUserDataPath, '.encryption-key.production.enc'))).toBe(false);
    });

    test('uses a legacy Keychain key read-only for a candidate-bound external configuration', async () => {
      const legacyKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key' ? legacyKey : null);

      await expect(secureKeyManager.getKey({
        validateCandidate: (candidate) => (candidate === legacyKey
          ? { status: 'config_match', configStatus: 'candidate' }
          : { status: 'config_mismatch', configStatus: 'mismatch' }),
      })).resolves.toBe(legacyKey);

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    });

    test('repairs the scoped keychain only after a scoped safeStorage key is verified', async () => {
      const wrongKey = crypto.randomBytes(32).toString('hex');
      const safeKey = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(path.join(testUserDataPath, '.encryption-key.production.enc'), 'safe-wrapper');
      globalThis.__SHEKELSYNC_SAFE_STORAGE__ = mockSafeStorage;
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(safeKey);
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key:production' ? wrongKey : null);
      const validateCandidate = vi.fn((candidate) => ({
        status: candidate === safeKey ? 'match' : 'mismatch',
      }));

      const key = await secureKeyManager.getKey({
        validateCandidate,
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      });

      expect(key).toBe(safeKey);
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
        safeKey,
      );
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
      const lastValidationOrder = Math.max(...validateCandidate.mock.invocationCallOrder);
      expect(lastValidationOrder).toBeLessThan(mockKeytar.setPassword.mock.invocationCallOrder[0]);
    });

    test('refreshes a stale scoped safeStorage copy only after keychain validation', async () => {
      const keychainKey = crypto.randomBytes(32).toString('hex');
      const staleKey = crypto.randomBytes(32).toString('hex');
      const safePath = path.join(testUserDataPath, '.encryption-key.production.enc');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(safePath, 'stale-wrapper');
      globalThis.__SHEKELSYNC_SAFE_STORAGE__ = mockSafeStorage;
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(staleKey);
      mockSafeStorage.encryptString.mockReturnValue(Buffer.from('verified-wrapper'));
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key:production' ? keychainKey : null);
      const validateCandidate = vi.fn((candidate) => ({
        status: candidate === keychainKey ? 'match' : 'mismatch',
      }));

      await secureKeyManager.getKey({
        validateCandidate,
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      });

      expect(fs.readFileSync(safePath, 'utf8')).toBe('verified-wrapper');
      expect(validateCandidate.mock.invocationCallOrder[0])
        .toBeLessThan(mockSafeStorage.encryptString.mock.invocationCallOrder[0]);
    });

    test('does not consult legacy stores after a scoped key authenticates', async () => {
      const scopedKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key:production' ? scopedKey : null);

      expect(await secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'match' }),
      })).toBe(scopedKey);

      expect(mockKeytar.getPassword).toHaveBeenCalledTimes(1);
      expect(mockKeytar.getPassword).not.toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key',
      );
    });

    test('uses a verified scoped safeStorage key without overwriting a failed keychain read', async () => {
      const safeKey = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(path.join(testUserDataPath, '.encryption-key.production.enc'), 'safe-wrapper');
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(safeKey);
      mockKeytar.getPassword.mockRejectedValue(new Error('access denied'));

      expect(await secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'match' }),
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      })).toBe(safeKey);
      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
    });

    test('migrates a database-verified identity-local legacy file without reading shared keychain', async () => {
      const legacyKey = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(path.join(testUserDataPath, '.encryption-key.enc'), 'legacy-wrapper');
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockSafeStorage.decryptString.mockReturnValue(legacyKey);
      mockSafeStorage.encryptString.mockReturnValue(Buffer.from('scoped-wrapper'));
      mockKeytar.getPassword.mockResolvedValue(null);

      expect(await secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'match' }),
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      })).toBe(legacyKey);
      expect(mockKeytar.getPassword).toHaveBeenCalledTimes(1);
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
        legacyKey,
      );
    });

    test('never lets a legacy key replace existing scoped material', async () => {
      const scopedKey = crypto.randomBytes(32).toString('hex');
      const legacyKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockImplementation(async (_service, account) => {
        if (account === 'master-encryption-key:production') return scopedKey;
        if (account === 'master-encryption-key') return legacyKey;
        return null;
      });

      await expect(secureKeyManager.getKey({
        validateCandidate: (candidate) => ({
          status: candidate === legacyKey ? 'match' : 'mismatch',
        }),
      })).rejects.toThrow('Refusing to replace them from a legacy store');

      expect(mockKeytar.getPassword).toHaveBeenCalledTimes(1);
      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
    });

    test('uses a unique scoped key read-only for an empty store', async () => {
      const scopedKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockImplementation(async (_service, account) =>
        account === 'master-encryption-key:production' ? scopedKey : null);

      expect(await secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'empty' }),
      })).toBe(scopedKey);
      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    });

    test('serializes concurrent first-run key creation', async () => {
      mockKeytar.getPassword.mockResolvedValue(null);
      mockKeytar.setPassword.mockResolvedValue(undefined);

      const [first, second] = await Promise.all([
        secureKeyManager.getKey(),
        secureKeyManager.getKey(),
      ]);

      expect(first).toBe(second);
      expect(mockKeytar.getPassword).toHaveBeenCalledTimes(1);
      expect(mockKeytar.setPassword).toHaveBeenCalledTimes(1);
    });

    test('does not write or generate through a missing configured database', async () => {
      mockKeytar.getPassword.mockResolvedValue(null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'missing' }),
      })).rejects.toThrow('Refusing to overwrite key material');
      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    });

    test('does not generate a key after an interrupted authoritative-session file write', async () => {
      const secureStorePath = path.join(testUserDataPath, 'secure-store');
      fs.mkdirSync(secureStorePath, { recursive: true });
      fs.writeFileSync(
        path.join(secureStorePath, '.session-file-authoritative'),
        '1',
        { mode: 0o600 },
      );
      mockKeytar.getPassword.mockResolvedValue(null);
      mockKeytar.setPassword.mockResolvedValue(undefined);
      const validatorModule = await import('../credential-key-validator.js');
      const { validateCredentialKey } = validatorModule.default || validatorModule;

      await expect(secureKeyManager.getKey({
        validateCandidate: (candidate) => validateCredentialKey(candidate, {
          userDataPath: testUserDataPath,
        }),
      })).rejects.toThrow('Refusing to overwrite key material');

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
      expect(fs.existsSync(
        path.join(testUserDataPath, '.encryption-key.production.enc'),
      )).toBe(false);
    });

    test('makes no key writes when both default databases make ownership ambiguous', async () => {
      fs.mkdirSync(testUserDataPath, { recursive: true });
      fs.writeFileSync(path.join(testUserDataPath, 'shekelsync.sqlite'), 'preferred');
      fs.writeFileSync(path.join(testUserDataPath, 'clarify.sqlite'), 'legacy');
      mockKeytar.getPassword.mockResolvedValue(null);
      const validatorModule = await import('../credential-key-validator.js');
      const { validateCredentialKey } = validatorModule.default || validatorModule;

      await expect(secureKeyManager.getKey({
        validateCandidate: (candidate) => validateCredentialKey(candidate, {
          userDataPath: testUserDataPath,
        }),
      })).rejects.toThrow('Refusing to overwrite key material');

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(testUserDataPath, '.encryption-key.production.enc'))).toBe(false);
    });
  });

  describe('Key Retrieval - Errors', () => {
    test('should throw error if keychain fails and no env key', async () => {
      mockKeytar.getPassword.mockRejectedValue(new Error('Keychain error'));
      mockKeytar.setPassword.mockRejectedValue(new Error('Keychain error'));

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      // A keychain read failure looks like prior key material that's now
      // unreadable, so this must refuse to silently generate a replacement
      // key rather than fall through to "Cannot securely store...".
      await expect(secureKeyManager.getKey()).rejects.toThrow(
        'Refusing legacy migration and all replacement writes'
      );
    });

    test('should throw error if keychain disabled and no env key', async () => {
      process.env.KEYTAR_DISABLE = 'true';

      // Reload module with keytar disabled
      vi.resetModules();
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      await expect(secureKeyManager.getKey()).rejects.toThrow(
        'Cannot securely store encryption key'
      );
    });

    test('should refuse to generate a replacement key when keychain item is invalid rather than absent', async () => {
      // Something is stored under this account, but it's not a valid 32-byte hex key -
      // this must never be treated the same as "nothing stored yet".
      mockKeytar.getPassword.mockResolvedValue('not-a-valid-key');

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      await expect(secureKeyManager.getKey()).rejects.toThrow(
        'Refusing legacy migration and all replacement writes'
      );
      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
    });

    test('should refuse replacement when the scoped safeStorage path is not a readable file', async () => {
      const safePath = path.join(testUserDataPath, '.encryption-key.production.enc');
      fs.mkdirSync(safePath, { recursive: true });
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
      mockKeytar.getPassword.mockResolvedValue(null);

      await expect(secureKeyManager.getKey({
        validateCandidate: () => ({ status: 'fresh' }),
        safeStorage: mockSafeStorage,
        userDataPath: testUserDataPath,
      })).rejects.toThrow('Refusing legacy migration and all replacement writes');

      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
      expect(mockSafeStorage.encryptString).not.toHaveBeenCalled();
    });

    test('should still generate a new key on a genuine fresh install (no keytar or safeStorage data at all)', async () => {
      mockKeytar.getPassword.mockResolvedValue(null);
      mockKeytar.setPassword.mockResolvedValue(undefined);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      const key = await secureKeyManager.getKey();

      expect(secureKeyManager.validateKey(key)).toBe(true);
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production',
        key,
      );
      expect(mockKeytar.getPassword).toHaveBeenCalledTimes(1);
      expect(mockKeytar.getPassword).not.toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key',
      );
    });
  });

  describe('Key Rotation', () => {
    test('should refuse rotation until data can be re-encrypted transactionally', async () => {
      await expect(secureKeyManager.rotateKey()).rejects.toThrow('rotation is disabled');
      expect(mockKeytar.setPassword).not.toHaveBeenCalled();
    });
  });

  describe('Key Deletion', () => {
    test('should delete key from keychain', async () => {
      mockKeytar.deletePassword.mockResolvedValue(undefined);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      await secureKeyManager.deleteKey();

      expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key:production'
      );
    });

    test('should clear cached key', async () => {
      const storedKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockResolvedValue(storedKey);
      mockKeytar.deletePassword.mockResolvedValue(undefined);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      await secureKeyManager.getKey(); // Load and cache
      await secureKeyManager.deleteKey();

      secureKeyManager.clearCache();
      expect(secureKeyManager.cachedKey).toBeNull();
    });
  });

  describe('Security Storage Availability', () => {
    test('should report available when keychain works', async () => {
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      expect(secureKeyManager.isSecureStorageAvailable()).toBe(true);
    });

    test('should report available when env key is set', async () => {
      process.env.SHEKELSYNC_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
      process.env.ALLOW_INSECURE_ENV_KEY = 'true';
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      expect(secureKeyManager.isSecureStorageAvailable()).toBe(true);
    });

    test('should report unavailable when keychain disabled and no env key', async () => {
      process.env.KEYTAR_DISABLE = 'true';
      vi.resetModules();
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      expect(secureKeyManager.isSecureStorageAvailable()).toBe(false);
    });
  });
});
