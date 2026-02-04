/**
 * Security Tests for Secure Key Manager
 * Tests encryption key storage and management
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';

// Mock keytar
const mockKeytar = {
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
};

vi.mock('keytar', () => ({
  default: mockKeytar,
  ...mockKeytar,
}));

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-app'),
  },
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
    delete process.env.CLARIFY_ENCRYPTION_KEY;
    delete process.env.KEYTAR_DISABLE;
    delete process.env.ALLOW_INSECURE_ENV_KEY;
    globalThis.__SHEKELSYNC_KEYTAR__ = mockKeytar;

    // Reset module cache to get fresh instance
    vi.resetModules();

    // Dynamically import the module
    const module = await import('../secure-key-manager.js');
    secureKeyManager = module.default || module;
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
      process.env.CLARIFY_ENCRYPTION_KEY = envKey;
      process.env.ALLOW_INSECURE_ENV_KEY = 'true';

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key = await secureKeyManager.getKey();

      expect(key).toBe(envKey);
      expect(mockKeytar.getPassword).not.toHaveBeenCalled();
    });

    test('should cache key from environment', async () => {
      const envKey = crypto.randomBytes(32).toString('hex');
      process.env.CLARIFY_ENCRYPTION_KEY = envKey;
      process.env.ALLOW_INSECURE_ENV_KEY = 'true';

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key1 = await secureKeyManager.getKey();
      const key2 = await secureKeyManager.getKey();

      expect(key1).toBe(envKey);
      expect(key2).toBe(envKey);
      expect(mockKeytar.getPassword).not.toHaveBeenCalled();
    });

    test('should reject invalid environment key', async () => {
      process.env.CLARIFY_ENCRYPTION_KEY = 'invalid-key';
      process.env.ALLOW_INSECURE_ENV_KEY = 'true';

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      await expect(secureKeyManager.getKey()).rejects.toThrow(
        'CLARIFY_ENCRYPTION_KEY environment variable is invalid'
      );
    });
  });

  describe('Key Retrieval - Keychain', () => {
    test('should load key from keychain if available', async () => {
      const storedKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockResolvedValue(storedKey);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key = await secureKeyManager.getKey();

      expect(key).toBe(storedKey);
      expect(mockKeytar.getPassword).toHaveBeenCalledWith('ShekelSync', 'master-encryption-key');
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
        'master-encryption-key',
        key
      );
    });

    test('should cache key after loading from keychain', async () => {
      const storedKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockResolvedValue(storedKey);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      const key1 = await secureKeyManager.getKey();
      const key2 = await secureKeyManager.getKey();

      expect(key1).toBe(storedKey);
      expect(key2).toBe(storedKey);
      expect(mockKeytar.getPassword).toHaveBeenCalledTimes(1); // Only called once
    });
  });

  describe('Key Retrieval - Errors', () => {
    test('should throw error if keychain fails and no env key', async () => {
      mockKeytar.getPassword.mockRejectedValue(new Error('Keychain error'));
      mockKeytar.setPassword.mockRejectedValue(new Error('Keychain error'));

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      await expect(secureKeyManager.getKey()).rejects.toThrow(
        'Cannot securely store encryption key'
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
  });

  describe('Key Rotation', () => {
    test('should generate new key and store in keychain', async () => {
      const oldKey = crypto.randomBytes(32).toString('hex');
      mockKeytar.getPassword.mockResolvedValue(oldKey);
      mockKeytar.setPassword.mockResolvedValue(undefined);

      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;
      await secureKeyManager.getKey(); // Load old key

      const newKey = await secureKeyManager.rotateKey();

      expect(newKey).not.toBe(oldKey);
      expect(secureKeyManager.validateKey(newKey)).toBe(true);
      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'ShekelSync',
        'master-encryption-key',
        newKey
      );
    });

    test('should fail rotation if keychain not available', async () => {
      process.env.KEYTAR_DISABLE = 'true';
      vi.resetModules();
      const module = await import('../secure-key-manager.js');
      secureKeyManager = module.default || module;

      await expect(secureKeyManager.rotateKey()).rejects.toThrow(
        'Key rotation requires keychain support'
      );
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
        'master-encryption-key'
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
      process.env.CLARIFY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
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
