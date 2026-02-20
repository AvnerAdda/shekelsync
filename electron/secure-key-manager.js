const crypto = require('crypto');
const { resolveAppPath, requireFromApp } = require('./paths');

let keytar;
const isLinux = process.platform === 'linux';
const keytarDisabledByEnv =
  process.env.KEYTAR_DISABLE === 'true' ||
  process.env.DBUS_SESSION_BUS_ADDRESS === 'disabled:';
const keytarDisabled = keytarDisabledByEnv;
const allowEnvKey =
  process.env.ALLOW_INSECURE_ENV_KEY === 'true' ||
  process.env.NODE_ENV === 'test' ||
  process.env.VITEST === 'true' ||
  process.env.CI === 'true';
const preferRootKeytar = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
const injectedKeytar = globalThis.__SHEKELSYNC_KEYTAR__;

if (injectedKeytar && !keytarDisabled) {
  keytar = injectedKeytar;
} else if (!keytarDisabled) {
  if (preferRootKeytar) {
    try {
      keytar = require('keytar');
    } catch (rootLoadError) {
      try {
        keytar = requireFromApp('keytar');
      } catch (appLoadError) {
        console.warn('[SecureKeyManager] keytar unavailable, will use environment key only.');
        keytar = null;
      }
    }
  } else {
    try {
      keytar = requireFromApp('keytar');
    } catch (appLoadError) {
      try {
        keytar = require('keytar');
      } catch (rootLoadError) {
        console.warn('[SecureKeyManager] keytar unavailable, will use environment key only.');
        keytar = null;
      }
    }
  }
} else {
  console.warn('[SecureKeyManager] keytar disabled via environment.');
  keytar = null;
}

const SERVICE_NAME = 'ShekelSync';
const ENCRYPTION_KEY_ACCOUNT = 'master-encryption-key';
const KEY_SIZE_BYTES = 32; // 256 bits for AES-256

/**
 * Secure Key Manager
 * Manages the master encryption key using OS keychain (keytar)
 * Never stores keys in plain text config files
 */
class SecureKeyManager {
  constructor() {
    this.cachedKey = null;
    this.keytarAvailable = Boolean(keytar);
  }

  /**
   * Generate a cryptographically secure random key
   */
  generateKey() {
    return crypto.randomBytes(KEY_SIZE_BYTES).toString('hex');
  }

  /**
   * Validate that a key is properly formatted
   */
  validateKey(key) {
    if (!key || typeof key !== 'string') {
      return false;
    }

    const keyBuffer = Buffer.from(key, 'hex');
    return keyBuffer.length === KEY_SIZE_BYTES;
  }

  /**
 * Get the master encryption key from secure storage
 * Priority:
 * 1. Environment variable (SHEKELSYNC_ENCRYPTION_KEY) - only when ALLOW_INSECURE_ENV_KEY=true (tests/CI)
 * 2. OS keychain (via keytar) - secure production storage
 * 3. Generate new key and store in keychain
 */
  async getKey() {
    // Return cached key if available
    if (this.cachedKey) {
      return this.cachedKey;
    }

    // 1. Check environment variable (tests/CI only)
    const envKey = process.env.SHEKELSYNC_ENCRYPTION_KEY;
    if (envKey) {
      const envKeyAllowed = allowEnvKey || isLinux;
      if (!envKeyAllowed) {
        throw new Error(
          'SHEKELSYNC_ENCRYPTION_KEY is set but environment keys are disabled. ' +
          'Remove the env key and enable OS keychain storage.',
        );
      }
      if (!this.validateKey(envKey)) {
        throw new Error('SHEKELSYNC_ENCRYPTION_KEY environment variable is invalid. Must be a 64-character hex string (32 bytes).');
      }
      console.log('[SecureKeyManager] Using encryption key from environment variable');
      this.cachedKey = envKey;
      return envKey;
    }

    // 2. Try to load from OS keychain
    if (this.keytarAvailable) {
      try {
        const storedKey = await keytar.getPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT);
        if (storedKey && this.validateKey(storedKey)) {
          console.log('[SecureKeyManager] Loaded encryption key from OS keychain');
          this.cachedKey = storedKey;
          return storedKey;
        }
      } catch (error) {
        console.warn('[SecureKeyManager] Failed to load key from keychain:', error.message);
      }
    }

    // 3. Generate new key and store in keychain
    console.log('[SecureKeyManager] Generating new master encryption key');
    const newKey = this.generateKey();

    if (this.keytarAvailable) {
      try {
        await keytar.setPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT, newKey);
        console.log('[SecureKeyManager] Stored new encryption key in OS keychain');
      } catch (error) {
        console.error('[SecureKeyManager] CRITICAL: Failed to store encryption key in keychain:', error.message);
        throw new Error('Cannot securely store encryption key. Keychain access required for security.');
      }
    } else {
      const message = isLinux
        ? 'Cannot securely store encryption key. On Linux, set SHEKELSYNC_ENCRYPTION_KEY or enable libsecret and a secret service.'
        : 'Cannot securely store encryption key. Enable OS keychain support (install libsecret on Linux).';
      throw new Error(message);
    }

    this.cachedKey = newKey;
    return newKey;
  }

  /**
   * Rotate the encryption key (for security best practices)
   * Note: This requires re-encrypting all stored credentials
   */
  async rotateKey() {
    const newKey = this.generateKey();

    if (this.keytarAvailable) {
      try {
        await keytar.setPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT, newKey);
        console.log('[SecureKeyManager] Encryption key rotated successfully');
        this.cachedKey = newKey;
        return newKey;
      } catch (error) {
        console.error('[SecureKeyManager] Failed to rotate encryption key:', error.message);
        throw error;
      }
    } else {
      throw new Error('Key rotation requires keychain support');
    }
  }

  /**
   * Delete the encryption key from keychain
   * WARNING: This will make all encrypted data unrecoverable
   */
  async deleteKey() {
    if (this.keytarAvailable) {
      try {
        await keytar.deletePassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT);
        console.log('[SecureKeyManager] Encryption key deleted from keychain');
      } catch (error) {
        console.warn('[SecureKeyManager] Failed to delete key from keychain:', error.message);
      }
    }
    this.cachedKey = null;
  }

  /**
   * Check if secure key storage is available
   */
  isSecureStorageAvailable() {
    const envKeyAllowed = allowEnvKey || isLinux;
    return this.keytarAvailable || (envKeyAllowed && Boolean(process.env.SHEKELSYNC_ENCRYPTION_KEY));
  }

  /**
   * Clear cached key (for testing/security)
   */
  clearCache() {
    this.cachedKey = null;
  }
}

// Export singleton instance
module.exports = new SecureKeyManager();
