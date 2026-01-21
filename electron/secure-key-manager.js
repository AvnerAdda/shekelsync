const crypto = require('crypto');
const { app } = require('electron');
const { resolveAppPath, requireFromApp } = require('./paths');

let keytar;
const keytarDisabled =
  process.env.KEYTAR_DISABLE === 'true' ||
  process.env.DBUS_SESSION_BUS_ADDRESS === 'disabled:';

if (!keytarDisabled) {
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
   * 1. Environment variable (CLARIFY_ENCRYPTION_KEY) - for CI/testing
   * 2. OS keychain (via keytar) - secure production storage
   * 3. Generate new key and store in keychain
   */
  async getKey() {
    // Return cached key if available
    if (this.cachedKey) {
      return this.cachedKey;
    }

    // 1. Check environment variable (for CI/testing)
    const envKey = process.env.CLARIFY_ENCRYPTION_KEY;
    if (envKey) {
      if (!this.validateKey(envKey)) {
        throw new Error('CLARIFY_ENCRYPTION_KEY environment variable is invalid. Must be a 64-character hex string (32 bytes).');
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
      // No keychain available and no env key - this is insecure
      throw new Error(
        'Cannot securely store encryption key. Either:\n' +
        '1. Set CLARIFY_ENCRYPTION_KEY environment variable, or\n' +
        '2. Enable keychain support (install libsecret on Linux)'
      );
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
    return this.keytarAvailable || Boolean(process.env.CLARIFY_ENCRYPTION_KEY);
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
