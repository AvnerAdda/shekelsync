const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveAppPath, requireFromApp } = require('./paths');

let keytar;
let keytarResolved = false;
const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';
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

// Lazy-load keytar on first use to avoid blocking module load with native keychain IPC
function resolveKeytar() {
  if (keytarResolved) return keytar;
  keytarResolved = true;

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
  return keytar;
}

const SERVICE_NAME = 'ShekelSync';
const ENCRYPTION_KEY_ACCOUNT = 'master-encryption-key';
const KEY_SIZE_BYTES = 32; // 256 bits for AES-256
const SAFE_STORAGE_FILENAME = '.encryption-key.enc';

/**
 * Get the safeStorage-encrypted key file path.
 * Uses Electron's app.getPath('userData') when available, otherwise falls back.
 */
function getSafeStoragePath() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), SAFE_STORAGE_FILENAME);
    }
  } catch {
    // Not running in Electron main process
  }
  return null;
}

/**
 * Get Electron's safeStorage module if available and ready.
 */
function getSafeStorage() {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      return safeStorage;
    }
  } catch {
    // Not running in Electron main process
  }
  return null;
}

/**
 * Secure Key Manager
 * Manages the master encryption key using OS keychain (keytar) with
 * Electron safeStorage as a fallback on macOS where keytar may fail.
 * Never stores keys in plain text config files.
 */
class SecureKeyManager {
  constructor() {
    this.cachedKey = null;
  }

  get keytarAvailable() {
    return Boolean(resolveKeytar());
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
   * Try to read the encryption key from the safeStorage-encrypted file.
   */
  _readFromSafeStorage() {
    const safeStorage = getSafeStorage();
    const filePath = getSafeStoragePath();
    if (!safeStorage || !filePath) {
      return null;
    }

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const encrypted = fs.readFileSync(filePath);
      const decrypted = safeStorage.decryptString(encrypted);
      if (this.validateKey(decrypted)) {
        return decrypted;
      }
      console.warn('[SecureKeyManager] safeStorage file contained invalid key');
    } catch (error) {
      console.warn('[SecureKeyManager] Failed to read from safeStorage file:', error.message);
    }
    return null;
  }

  /**
   * Write the encryption key to the safeStorage-encrypted file.
   */
  _writeToSafeStorage(key) {
    const safeStorage = getSafeStorage();
    const filePath = getSafeStoragePath();
    if (!safeStorage || !filePath) {
      return false;
    }

    try {
      const encrypted = safeStorage.encryptString(key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
      console.log('[SecureKeyManager] Stored encryption key in safeStorage file');
      return true;
    } catch (error) {
      console.warn('[SecureKeyManager] Failed to write safeStorage file:', error.message);
    }
    return false;
  }

  /**
 * Get the master encryption key from secure storage
 * Priority:
 * 1. Environment variable (SHEKELSYNC_ENCRYPTION_KEY) - only when ALLOW_INSECURE_ENV_KEY=true (tests/CI)
 * 2. OS keychain (via keytar) - secure production storage
 * 3. Electron safeStorage file - fallback when keytar read fails (macOS)
 * 4. Generate new key and store in both keychain + safeStorage
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
    let keytarReadFailed = false;
    if (this.keytarAvailable) {
      try {
        const storedKey = await resolveKeytar().getPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT);
        if (storedKey && this.validateKey(storedKey)) {
          console.log('[SecureKeyManager] Loaded encryption key from OS keychain');
          this.cachedKey = storedKey;
          // Ensure safeStorage backup exists
          this._writeToSafeStorage(storedKey);
          return storedKey;
        }
      } catch (error) {
        keytarReadFailed = true;
        console.warn('[SecureKeyManager] Failed to load key from keychain:', error.message);
      }
    }

    // 3. Try safeStorage fallback (protects against keytar read failures on macOS)
    const safeStorageKey = this._readFromSafeStorage();
    if (safeStorageKey) {
      console.log('[SecureKeyManager] Loaded encryption key from safeStorage fallback');
      this.cachedKey = safeStorageKey;
      // Try to re-sync to keytar so future reads may work
      if (keytarReadFailed && this.keytarAvailable) {
        try {
          await resolveKeytar().setPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT, safeStorageKey);
          console.log('[SecureKeyManager] Re-synced key back to keychain');
        } catch {
          // Non-critical, safeStorage is the reliable copy
        }
      }
      return safeStorageKey;
    }

    // 4. Generate new key and store in both keychain + safeStorage
    console.log('[SecureKeyManager] Generating new master encryption key');
    const newKey = this.generateKey();

    if (this.keytarAvailable) {
      try {
        await resolveKeytar().setPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT, newKey);
        console.log('[SecureKeyManager] Stored new encryption key in OS keychain');
      } catch (error) {
        console.error('[SecureKeyManager] CRITICAL: Failed to store encryption key in keychain:', error.message);
        // If safeStorage is available, we can still continue
        if (!getSafeStorage()) {
          throw new Error('Cannot securely store encryption key. Keychain access required for security.');
        }
      }
    } else if (!getSafeStorage()) {
      const message = isLinux
        ? 'Cannot securely store encryption key. On Linux, set SHEKELSYNC_ENCRYPTION_KEY or enable libsecret and a secret service.'
        : 'Cannot securely store encryption key. Enable OS keychain support (install libsecret on Linux).';
      throw new Error(message);
    }

    // Always try to write safeStorage backup
    this._writeToSafeStorage(newKey);

    this.cachedKey = newKey;
    return newKey;
  }

  /**
   * Rotate the encryption key (for security best practices)
   * Note: This requires re-encrypting all stored credentials
   */
  async rotateKey() {
    const newKey = this.generateKey();

    let stored = false;
    if (this.keytarAvailable) {
      try {
        await resolveKeytar().setPassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT, newKey);
        console.log('[SecureKeyManager] Encryption key rotated in keychain');
        stored = true;
      } catch (error) {
        console.error('[SecureKeyManager] Failed to rotate encryption key in keychain:', error.message);
      }
    }

    if (this._writeToSafeStorage(newKey)) {
      stored = true;
    }

    if (!stored) {
      throw new Error('Key rotation failed: could not store in keychain or safeStorage');
    }

    this.cachedKey = newKey;
    return newKey;
  }

  /**
   * Delete the encryption key from keychain
   * WARNING: This will make all encrypted data unrecoverable
   */
  async deleteKey() {
    if (this.keytarAvailable) {
      try {
        await resolveKeytar().deletePassword(SERVICE_NAME, ENCRYPTION_KEY_ACCOUNT);
        console.log('[SecureKeyManager] Encryption key deleted from keychain');
      } catch (error) {
        console.warn('[SecureKeyManager] Failed to delete key from keychain:', error.message);
      }
    }

    // Also remove safeStorage file
    const filePath = getSafeStoragePath();
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
        console.log('[SecureKeyManager] Encryption key file removed');
      } catch {
        // File may not exist
      }
    }

    this.cachedKey = null;
  }

  /**
   * Check if secure key storage is available
   */
  isSecureStorageAvailable() {
    const envKeyAllowed = allowEnvKey || isLinux;
    return this.keytarAvailable || Boolean(getSafeStorage()) || (envKeyAllowed && Boolean(process.env.SHEKELSYNC_ENCRYPTION_KEY));
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
