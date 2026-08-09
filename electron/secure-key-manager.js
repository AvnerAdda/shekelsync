const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { requireFromApp } = require('./paths');

let keytar;
let keytarResolved = false;
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
const LEGACY_ENCRYPTION_KEY_ACCOUNT = 'master-encryption-key';
const ENCRYPTION_KEY_ACCOUNT_PREFIX = 'master-encryption-key';
const KEY_SIZE_BYTES = 32; // 256 bits for AES-256
const LEGACY_SAFE_STORAGE_FILENAME = '.encryption-key.enc';

function getKeyScope() {
  if (['production', 'development'].includes(globalThis.__SHEKELSYNC_KEY_SCOPE__)) {
    return globalThis.__SHEKELSYNC_KEY_SCOPE__;
  }
  try {
    const { app } = require('electron');
    return app?.isPackaged === false ? 'development' : 'production';
  } catch {
    return 'production';
  }
}

function getEncryptionKeyAccount(scope = getKeyScope()) {
  return `${ENCRYPTION_KEY_ACCOUNT_PREFIX}:${scope}`;
}

// The scoped stores and the legacy safeStorage file all live under this app
// identity (scoped keychain accounts, files in this identity's userData
// directory). Only the shared legacy Keychain account can belong to another
// scope, so it is never identity-local.
function isIdentityLocalOrigin(origin) {
  return origin.startsWith('scoped-') || origin === 'legacy-safe-storage';
}

function getSafeStorageFilename(scope = getKeyScope()) {
  return `.encryption-key.${scope}.enc`;
}

function resolveCandidateValidator(override) {
  if (typeof override === 'function') return override;
  if (typeof globalThis.__SHEKELSYNC_CREDENTIAL_KEY_VALIDATOR__ === 'function') {
    return globalThis.__SHEKELSYNC_CREDENTIAL_KEY_VALIDATOR__;
  }
  return require('./credential-key-validator').validateCredentialKey;
}

/**
 * Get the safeStorage-encrypted key file path.
 * Uses Electron's app.getPath('userData') when available, otherwise falls back.
 */
function getSafeStoragePath(filename = getSafeStorageFilename(), userDataPath) {
  if (typeof userDataPath === 'string' && userDataPath.length > 0) {
    return path.join(userDataPath, filename);
  }
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), filename);
    }
  } catch {
    // Not running in Electron main process
  }
  return null;
}

/**
 * Get Electron's safeStorage module if available and ready.
 */
function getSafeStorage(override) {
  try {
    const safeStorage = override || globalThis.__SHEKELSYNC_SAFE_STORAGE__ || require('electron').safeStorage;
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
    this.pendingKeyPromise = null;
    this.initialized = false;
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
    return typeof key === 'string' && /^[0-9a-f]{64}$/i.test(key);
  }

  /**
   * Try to read the encryption key from the safeStorage-encrypted file.
   * Returns whether a file existed but couldn't be used, distinctly from
   * "nothing was ever stored" - the former means real key material is
   * being lost, not that this is a fresh install.
   */
  _readFromSafeStorage(filename = getSafeStorageFilename(), safeStorageOverride, userDataPath) {
    const safeStorage = getSafeStorage(safeStorageOverride);
    const filePath = getSafeStoragePath(filename, userDataPath);
    if (!filePath) {
      return { key: null, existedButUnusable: false };
    }

    try {
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return { key: null, existedButUnusable: false };
        }
        throw error;
      }
      if (!stat.isFile()) {
        console.warn('[SecureKeyManager] safeStorage path is not a regular file');
        return { key: null, existedButUnusable: true };
      }
      if (!safeStorage) {
        return { key: null, existedButUnusable: true };
      }
      const encrypted = fs.readFileSync(filePath);
      const decrypted = safeStorage.decryptString(encrypted);
      if (this.validateKey(decrypted)) {
        return { key: decrypted, existedButUnusable: false };
      }
      console.warn('[SecureKeyManager] safeStorage file contained invalid key');
      return { key: null, existedButUnusable: true };
    } catch (error) {
      console.warn('[SecureKeyManager] Failed to read from safeStorage file:', error.message);
      return { key: null, existedButUnusable: true };
    }
  }

  /**
   * Write the encryption key to the safeStorage-encrypted file.
   */
  _writeToSafeStorage(key, filename = getSafeStorageFilename(), safeStorageOverride, userDataPath) {
    const safeStorage = getSafeStorage(safeStorageOverride);
    const filePath = getSafeStoragePath(filename, userDataPath);
    if (!safeStorage || !filePath) {
      return false;
    }

    let temporaryPath;
    let descriptor;
    try {
      const encrypted = safeStorage.encryptString(key);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, encrypted);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, filePath);
      temporaryPath = undefined;
      let directoryDescriptor;
      try {
        directoryDescriptor = fs.openSync(path.dirname(filePath), 'r');
        fs.fsyncSync(directoryDescriptor);
      } catch (error) {
        console.warn('[SecureKeyManager] Could not fsync safeStorage directory:', error.message);
      } finally {
        if (directoryDescriptor !== undefined) {
          try {
            fs.closeSync(directoryDescriptor);
          } catch {
            // The key file has already been atomically installed.
          }
        }
      }
      console.log('[SecureKeyManager] Stored encryption key in safeStorage file');
      return true;
    } catch (error) {
      console.warn('[SecureKeyManager] Failed to write safeStorage file:', error.message);
    } finally {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Best-effort cleanup of the temporary file descriptor.
        }
      }
      if (temporaryPath) {
        try {
          fs.unlinkSync(temporaryPath);
        } catch {
          // Best-effort cleanup of an incomplete temporary file.
        }
      }
    }
    return false;
  }

  async _readFromKeychain(account) {
    if (!this.keytarAvailable) {
      return { key: null, existedButUnusable: false, readFailed: false };
    }

    try {
      const storedKey = await resolveKeytar().getPassword(SERVICE_NAME, account);
      if (!storedKey) {
        return { key: null, existedButUnusable: false, readFailed: false };
      }
      if (!this.validateKey(storedKey)) {
        console.warn('[SecureKeyManager] Keychain item exists but is not a valid key');
        return { key: null, existedButUnusable: true, readFailed: false };
      }
      return { key: storedKey, existedButUnusable: false, readFailed: false };
    } catch (error) {
      console.warn('[SecureKeyManager] Failed to load key from keychain:', error.message);
      return { key: null, existedButUnusable: false, readFailed: true };
    }
  }

  async _validateCandidate(key, override) {
    try {
      const result = await resolveCandidateValidator(override)(key);
      if (result && typeof result.status === 'string') return result;
    } catch {
      // Validation failure is handled as unavailable and must never authorize a write.
    }
    return { status: 'unavailable' };
  }

  async _persistScopedKey(key, { primary, scopedSafe, account, filename, safeStorage, userDataPath }) {
    let storedInKeychain = primary?.key === key;
    let storedInSafeStorage = scopedSafe?.key === key;

    if (
      !storedInKeychain &&
      this.keytarAvailable &&
      !primary?.readFailed &&
      !primary?.existedButUnusable
    ) {
      try {
        await resolveKeytar().setPassword(SERVICE_NAME, account, key);
        console.log('[SecureKeyManager] Stored encryption key in scoped OS keychain account');
        storedInKeychain = true;
      } catch (error) {
        console.error('[SecureKeyManager] Failed to store scoped key in keychain:', error.message);
      }
    }

    if (!storedInSafeStorage && !scopedSafe?.existedButUnusable) {
      storedInSafeStorage = this._writeToSafeStorage(key, filename, safeStorage, userDataPath);
    }

    if (!storedInKeychain && !storedInSafeStorage) {
      throw new Error('Cannot securely store encryption key in scoped keychain or safeStorage.');
    }
  }

  /**
 * Get the master encryption key from secure storage. Production and
 * development use separate scoped stores. The former shared account/file are
 * read-only migration candidates and are never overwritten.
 */
  async getKey(options = {}) {
    if (this.initialized && this.cachedKey) {
      return this.cachedKey;
    }
    if (!this.pendingKeyPromise) {
      this.pendingKeyPromise = this._resolveKey(options)
        .then((key) => {
          this.initialized = true;
          return key;
        })
        .finally(() => {
          this.pendingKeyPromise = null;
        });
    }
    return this.pendingKeyPromise;
  }

  isInitialized() {
    return this.initialized && this.validateKey(this.cachedKey);
  }

  async _resolveKey(options = {}) {
    if (this.cachedKey) {
      return this.cachedKey;
    }

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
      const validation = await this._validateCandidate(envKey, options.validateCandidate);
      const candidateBoundConfig =
        validation.status === 'config_match' && validation.configStatus === 'candidate';
      if (!['match', 'empty', 'fresh'].includes(validation.status) && !candidateBoundConfig) {
        throw new Error(
          'The environment encryption key does not match existing credential data. Refusing to continue.',
        );
      }
      const envScope = getKeyScope();
      const scopedKeychain = await this._readFromKeychain(getEncryptionKeyAccount(envScope));
      const scopedFile = this._readFromSafeStorage(
        getSafeStorageFilename(envScope),
        options.safeStorage,
        options.userDataPath,
      );
      if (
        scopedKeychain.readFailed ||
        scopedKeychain.existedButUnusable ||
        scopedFile.existedButUnusable
      ) {
        throw new Error('Scoped key material is unreadable; refusing environment-key override.');
      }
      const conflictingScopedKey = [scopedKeychain.key, scopedFile.key]
        .filter(Boolean)
        .find((key) => key !== envKey);
      if (conflictingScopedKey) {
        throw new Error('The environment encryption key conflicts with existing scoped key material.');
      }
      console.log('[SecureKeyManager] Using encryption key from environment variable');
      this.cachedKey = envKey;
      return envKey;
    }

    const scope = getKeyScope();
    const account = getEncryptionKeyAccount(scope);
    const filename = getSafeStorageFilename(scope);
    const primary = await this._readFromKeychain(account);
    const scopedSafe = this._readFromSafeStorage(
      filename,
      options.safeStorage,
      options.userDataPath,
    );
    const scopedEntries = [
      { key: primary.key, origin: 'scoped-keychain' },
      { key: scopedSafe.key, origin: 'scoped-safe-storage' },
    ];

    const evaluateEntries = async (entries) => {
      const candidates = [];
      for (const entry of entries) {
        if (!entry.key) continue;
        const existing = candidates.find((candidate) => candidate.key === entry.key);
        if (existing) existing.origins.push(entry.origin);
        else candidates.push({ key: entry.key, origins: [entry.origin] });
      }
      for (const candidate of candidates) {
        candidate.validation = await this._validateCandidate(
          candidate.key,
          options.validateCandidate,
        );
      }
      return candidates;
    };

    const persistAndReturn = async (candidate, message) => {
      await this._persistScopedKey(candidate.key, {
        primary,
        scopedSafe,
        account,
        filename,
        safeStorage: options.safeStorage,
        userDataPath: options.userDataPath,
      });
      console.log(message);
      this.cachedKey = candidate.key;
      return candidate.key;
    };

    const selectOwnedCandidate = async (evaluated) => {
      const matches = evaluated.filter((candidate) => candidate.validation.status === 'match');
      if (matches.length > 1) {
        throw new Error('Multiple encryption keys authenticate different protected data. Refusing all writes.');
      }
      if (matches.length === 1) {
        return persistAndReturn(
          matches[0],
          '[SecureKeyManager] Loaded a database-verified encryption key',
        );
      }

      const emptyCandidates = evaluated.filter((candidate) => candidate.validation.status === 'empty');
      if (emptyCandidates.length > 1) {
        throw new Error(
          'Scoped encryption stores disagree and there is no encrypted credential data to identify the correct key. ' +
          'Refusing to overwrite either copy.',
        );
      }
      if (emptyCandidates.length === 1) {
        const identityLocalEmpty = emptyCandidates[0].origins.some(isIdentityLocalOrigin);
        if (identityLocalEmpty && evaluated.length === 1) {
          console.log('[SecureKeyManager] Loaded existing identity-local key read-only for empty credential store');
          this.cachedKey = emptyCandidates[0].key;
          return emptyCandidates[0].key;
        }
      }

      const resumableFresh = evaluated.filter((candidate) =>
        candidate.validation.status === 'fresh' &&
        candidate.origins.some(isIdentityLocalOrigin));
      if (resumableFresh.length > 1 || (resumableFresh.length === 1 && evaluated.length > 1)) {
        throw new Error('Encryption stores disagree during interrupted first-run recovery. Refusing all writes.');
      }
      if (resumableFresh.length === 1) {
        console.log('[SecureKeyManager] Resuming first-run initialization with existing identity-local key');
        this.cachedKey = resumableFresh[0].key;
        return resumableFresh[0].key;
      }

      // An external (Postgres) store cannot be checked before configuration is
      // loaded. An already-scoped key may be used, but it cannot authorize any
      // migration or repair write. A legacy safeStorage key additionally needs
      // the config to decrypt under it (candidate-bound), because unlike the
      // scoped stores nothing else vouches for that file's key.
      const configMatches = evaluated.filter((candidate) =>
        candidate.validation.status === 'config_match' &&
        (candidate.origins.some((origin) => origin.startsWith('scoped-')) ||
          (candidate.origins.includes('legacy-safe-storage') &&
            candidate.validation.configStatus === 'candidate')));
      if (configMatches.length > 1) {
        throw new Error('Scoped encryption stores disagree for the configured external database.');
      }
      if (configMatches.length === 1) {
        console.log('[SecureKeyManager] Loaded existing identity-local key for external database configuration');
        this.cachedKey = configMatches[0].key;
        return configMatches[0].key;
      }
      return null;
    };

    let ownedEntries = scopedEntries;
    let evaluatedOwned = await evaluateEntries(ownedEntries);
    let selected = await selectOwnedCandidate(evaluatedOwned);
    if (selected) return selected;

    const scopedMaterialUnusable =
      primary.readFailed ||
      primary.existedButUnusable ||
      scopedSafe.existedButUnusable;
    if (scopedMaterialUnusable) {
      throw new Error(
        'Existing scoped encryption key material could not be read. ' +
        'Refusing legacy migration and all replacement writes.',
      );
    }
    if (evaluatedOwned.length > 0) {
      throw new Error(
        'Existing scoped encryption keys do not authenticate the configured protected data. ' +
        'Refusing to replace them from a legacy store.',
      );
    }

    // The former safeStorage file lives inside this app identity's userData
    // directory, so it is safe to inspect before touching the shared legacy
    // Keychain account (which may prompt and may belong to the other scope).
    const legacySafe = this._readFromSafeStorage(
      LEGACY_SAFE_STORAGE_FILENAME,
      options.safeStorage,
      options.userDataPath,
    );
    ownedEntries = [
      ...scopedEntries,
      { key: legacySafe.key, origin: 'legacy-safe-storage' },
    ];
    evaluatedOwned = await evaluateEntries(ownedEntries);
    selected = await selectOwnedCandidate(evaluatedOwned);
    if (selected) return selected;

    if (evaluatedOwned.length > 0) {
      throw new Error(
        'An identity-local legacy key exists but cannot be safely assigned to this store. ' +
        'Refusing to generate or persist a different scoped key.',
      );
    }

    const identityLocalMaterialUnusable = legacySafe.existedButUnusable;

    // Probe the actual configured store before deciding whether this is a
    // genuine first run. Merely missing a database is not an empty store.
    const newKey = this.generateKey();
    const newKeyValidation = await this._validateCandidate(newKey, options.validateCandidate);

    let legacyKeychain = { key: null, existedButUnusable: false, readFailed: false };
    const shouldReadSharedLegacy =
      newKeyValidation.status !== 'fresh' ||
      evaluatedOwned.length > 0 ||
      identityLocalMaterialUnusable;
    if (shouldReadSharedLegacy) {
      legacyKeychain = await this._readFromKeychain(LEGACY_ENCRYPTION_KEY_ACCOUNT);
      if (legacyKeychain.key) {
        const legacyEvaluation = {
          key: legacyKeychain.key,
          origins: ['legacy-keychain'],
          validation: await this._validateCandidate(
            legacyKeychain.key,
            options.validateCandidate,
          ),
        };
        if (legacyEvaluation.validation.status === 'match') {
          return persistAndReturn(
            legacyEvaluation,
            '[SecureKeyManager] Migrated database-verified legacy Keychain key',
          );
        }
        // Mirror the environment-key rule: a config that decrypts only under
        // this candidate binds the key to this store's external database, so
        // the key may be used read-only even though the shared legacy account
        // cannot authorize scoped writes.
        if (
          legacyEvaluation.validation.status === 'config_match' &&
          legacyEvaluation.validation.configStatus === 'candidate'
        ) {
          console.log('[SecureKeyManager] Loaded legacy Keychain key read-only for candidate-bound external database configuration');
          this.cachedKey = legacyKeychain.key;
          return legacyKeychain.key;
        }
      }
    }

    if (identityLocalMaterialUnusable || legacyKeychain.readFailed || legacyKeychain.existedButUnusable) {
      throw new Error(
        'Existing encryption key material could not be read. ' +
        'Refusing to generate a replacement key.',
      );
    }

    // A shared legacy key is ambiguous for an empty store: it may belong to
    // development or production. Only authenticated credential data may
    // authorize importing it.
    if (legacyKeychain.key) {
      throw new Error(
        'A shared legacy encryption key exists, but no encrypted credential data identifies its owner. ' +
        'Refusing to import it or generate a replacement.',
      );
    }

    if (!['empty', 'fresh'].includes(newKeyValidation.status)) {
      throw new Error(
        'Stored encryption keys do not authenticate all existing credential data, configuration, or database location. ' +
        'Refusing to overwrite key material or generate a replacement.',
      );
    }

    console.log('[SecureKeyManager] Generating new scoped master encryption key');
    await this._persistScopedKey(newKey, {
      primary,
      scopedSafe,
      account,
      filename,
      safeStorage: options.safeStorage,
      userDataPath: options.userDataPath,
    });
    this.cachedKey = newKey;
    return newKey;
  }

  /**
   * Rotate the encryption key (for security best practices)
   * Note: This requires re-encrypting all stored credentials
   */
  async rotateKey() {
    throw new Error(
      'Key rotation is disabled until credential and config re-encryption can be completed transactionally.',
    );
  }

  /**
   * Delete the encryption key from keychain
   * WARNING: This will make all encrypted data unrecoverable
   */
  async deleteKey() {
    const account = getEncryptionKeyAccount();
    if (this.keytarAvailable) {
      try {
        await resolveKeytar().deletePassword(SERVICE_NAME, account);
        console.log('[SecureKeyManager] Scoped encryption key deleted from keychain');
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
    this.initialized = false;
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
    this.initialized = false;
  }
}

// Export singleton instance
module.exports = new SecureKeyManager();
