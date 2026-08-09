const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');
const { resolveAppPath, requireFromApp } = require('./paths');

let keytar;
const keytarDisabledByEnv =
  process.env.KEYTAR_DISABLE === 'true' ||
  process.env.DBUS_SESSION_BUS_ADDRESS === 'disabled:';
const keytarDisabled = keytarDisabledByEnv;
const legacyKeychainIsAuthoritative = process.platform === 'darwin';

if (!keytarDisabled) {
  try {
    // Try to load keytar from either the app bundle or root node_modules.
    keytar = requireFromApp('keytar');
  } catch (appLoadError) {
    try {
      keytar = require('keytar');
    } catch (rootLoadError) {
      console.warn('[SessionStore] keytar unavailable, falling back to encrypted file store.');
      keytar = null;
    }
  }
} else {
  console.warn('[SessionStore] keytar disabled via environment, using file store.');
  keytar = null;
}

const { encrypt, decrypt } = require(resolveAppPath('lib', 'server', 'encryption.js'));

const { mkdir, open, readFile, rename, unlink, writeFile } = fs.promises;

const SERVICE_NAME = 'ShekelSync';
const LEGACY_ACCOUNT_NAME = 'auth-session';
const ACCOUNT_NAME_PREFIX = 'auth-session';
const SESSION_TOMBSTONE_FIELD = '__shekelsyncSessionCleared';

function getSessionScope() {
  return app?.isPackaged === false ? 'development' : 'production';
}

function getAccountName() {
  return `${ACCOUNT_NAME_PREFIX}:${getSessionScope()}`;
}

function shouldDisableKeytar(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes('could not connect') ||
    message.includes('no such file or directory') ||
    message.includes('org.freedesktop.secrets') ||
    message.includes('secret service')
  );
}

class SessionStore {
  constructor() {
    this.filePath = null;
    this.cache = null;
    this.keytarAvailable = Boolean(keytar);
    this.settingsFilePath = null;
    this.settingsCache = null;
    this.legacyMarkerPath = null;
    this.authorityMarkerPath = null;
    this.scopedKeytarReadFailed = false;
  }

  getFilePath() {
    if (this.filePath) {
      return this.filePath;
    }

    const userData = app.getPath('userData');
    const directory = path.join(userData, 'secure-store');
    this.filePath = path.join(directory, `session.${getSessionScope()}.enc`);
    return this.filePath;
  }

  getLegacyFilePath() {
    const userData = app.getPath('userData');
    return path.join(userData, 'secure-store', 'session.enc');
  }

  getSettingsFilePath() {
    if (this.settingsFilePath) {
      return this.settingsFilePath;
    }

    const userData = app.getPath('userData');
    const directory = path.join(userData, 'secure-store');
    this.settingsFilePath = path.join(directory, 'settings.json');
    return this.settingsFilePath;
  }

  getLegacyMarkerPath() {
    if (this.legacyMarkerPath) return this.legacyMarkerPath;
    const userData = app.getPath('userData');
    this.legacyMarkerPath = path.join(userData, 'secure-store', '.legacy-session-ignored');
    return this.legacyMarkerPath;
  }

  getAuthorityMarkerPath() {
    if (this.authorityMarkerPath) return this.authorityMarkerPath;
    const userData = app.getPath('userData');
    this.authorityMarkerPath = path.join(userData, 'secure-store', '.session-file-authoritative');
    return this.authorityMarkerPath;
  }

  async persistScopedFile(payload) {
    await this.ensureDirectoryExists();
    // Write the durable precedence marker first. A crash between these writes
    // fails closed instead of resurrecting an older Keychain session.
    await this.atomicWrite(this.getAuthorityMarkerPath(), '1');
    await this.atomicWrite(this.getFilePath(), payload);
  }

  async promoteScopedKeychainPayload(payload) {
    await this.ensureDirectoryExists();
    // The validated Keychain value remains authoritative until the file is in
    // place. Install the file first so a failed promotion remains retryable;
    // an interrupted marker write is repaired after validating the file on the
    // next load.
    await this.atomicWrite(this.getFilePath(), payload);
    await this.atomicWrite(this.getAuthorityMarkerPath(), '1');
  }

  async atomicWrite(filePath, contents) {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    let fileHandle;
    let directoryHandle;
    let installed = false;

    try {
      await writeFile(temporaryPath, contents, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      fileHandle = await open(temporaryPath, 'r');
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = null;

      await rename(temporaryPath, filePath);
      installed = true;

      try {
        directoryHandle = await open(directory, 'r');
        await directoryHandle.sync();
      } catch (error) {
        const unsupportedOnWindows =
          process.platform === 'win32' && ['EACCES', 'EISDIR', 'EPERM'].includes(error?.code);
        if (!unsupportedOnWindows) throw error;
      } finally {
        if (directoryHandle) {
          await directoryHandle.close();
          directoryHandle = null;
        }
      }
    } finally {
      if (fileHandle) {
        try {
          await fileHandle.close();
        } catch {
          // Preserve the original durable-write failure.
        }
      }
      if (!installed) {
        try {
          await unlink(temporaryPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            console.warn('[SessionStore] Failed to clean up temporary session file:', error.message);
          }
        }
      }
    }
  }

  async isScopedFileAuthoritative() {
    try {
      await readFile(this.getAuthorityMarkerPath(), 'utf8');
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return false;
    }
  }

  hasLocalInstallEvidence() {
    const userData = app.getPath('userData');
    const candidates = [
      'config.enc',
      'shekelsync.sqlite',
      'clarify.sqlite',
      '.encryption-key.enc',
    ].map((filename) => path.join(userData, filename));
    candidates.push(this.getLegacyFilePath());

    for (const candidate of candidates) {
      try {
        fs.statSync(candidate);
        return true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return false;
  }

  async isLegacyIgnored() {
    try {
      await readFile(this.getLegacyMarkerPath(), 'utf8');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async markLegacyIgnored() {
    await this.ensureDirectoryExists();
    await this.atomicWrite(this.getLegacyMarkerPath(), '1');
  }

  async ensureDirectoryExists() {
    const directory = path.dirname(this.getFilePath());
    try {
      await mkdir(directory, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async load() {
    if (this.cache) {
      return this.cache;
    }

    const storedPayload = await this.loadEncryptedPayload();
    if (!storedPayload) {
      return null;
    }

    let parsed;
    try {
      const json = decrypt(storedPayload.payload);
      parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Stored session is not a JSON object');
      }
    } catch (error) {
      console.warn('[SessionStore] Failed to decrypt stored session:', error.message);
      const recoveryError = new Error(
        'The stored auth session could not be decrypted. Refusing to treat it as a logged-out session.',
      );
      recoveryError.code = 'session_decrypt_failed';
      recoveryError.cause = error;
      throw recoveryError;
    }

    try {
      await this.migrateValidatedPayload(storedPayload);
    } catch (error) {
      const migrationError = new Error(
        'The validated auth session could not be migrated to authoritative scoped storage.',
      );
      migrationError.code = 'session_migration_failed';
      migrationError.cause = error;
      throw migrationError;
    }

    if (parsed[SESSION_TOMBSTONE_FIELD] === true) {
      this.cache = null;
      return null;
    }
    this.cache = parsed;
    return parsed;
  }

  async save(session) {
    if (!session) {
      await this.clear();
      return null;
    }

    const serialized = JSON.stringify(session);
    const encrypted = encrypt(serialized);

    // The scoped encrypted file is the authoritative copy. Persist it first so
    // a stale Keychain value can never win after a partial save.
    await this.persistScopedFile(encrypted);

    if (this.keytarAvailable) {
      try {
        await keytar.setPassword(SERVICE_NAME, getAccountName(), encrypted);
      } catch (error) {
        console.warn('[SessionStore] Failed to mirror session to keytar:', error.message);
        if (shouldDisableKeytar(error)) {
          this.keytarAvailable = false;
        }
      }
    }

    this.cache = session;
    return session;
  }

  async clear() {
    this.cache = null;
    const tombstone = encrypt(JSON.stringify({ [SESSION_TOMBSTONE_FIELD]: true }));

    await this.persistScopedFile(tombstone);

    if (this.keytarAvailable) {
      try {
        await keytar.setPassword(SERVICE_NAME, getAccountName(), tombstone);
      } catch (error) {
        console.warn('[SessionStore] Failed to persist session tombstone to keytar:', error.message);
        if (shouldDisableKeytar(error)) {
          this.keytarAvailable = false;
        }
      }
    }

    try {
      await this.markLegacyIgnored();
    } catch (error) {
      console.warn('[SessionStore] Failed to mark legacy session ignored:', error.message);
    }
    return null;
  }

  async loadEncryptedPayload() {
    this.scopedKeytarReadFailed = false;

    // A scoped fallback file exists only when a prior Keychain write was
    // unavailable. It is therefore newer and authoritative over a stale
    // Keychain value, including logout tombstones.
    const file = this.getFilePath();
    try {
      const encrypted = await readFile(file, 'utf8');
      const origin = (await this.isScopedFileAuthoritative())
        ? 'scoped-file'
        : 'scoped-file-unmarked';
      return { payload: encrypted, origin };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const recoveryError = new Error(
          'The scoped auth session file is unreadable. Refusing Keychain or legacy fallback.',
        );
        recoveryError.code = 'session_store_unreadable';
        recoveryError.cause = error;
        throw recoveryError;
      }
    }

    if (await this.isScopedFileAuthoritative()) {
      const error = new Error(
        'The authoritative scoped session file is missing or unreadable. Refusing stale Keychain fallback.',
      );
      error.code = 'session_store_missing';
      throw error;
    }

    if (this.keytarAvailable) {
      try {
        const payload = await keytar.getPassword(SERVICE_NAME, getAccountName());
        if (payload) {
          return { payload, origin: 'scoped-keychain' };
        }
      } catch (error) {
        this.scopedKeytarReadFailed = true;
        console.warn('[SessionStore] Failed to load session from keytar:', error.message);
        const recoveryError = new Error(
          'The scoped auth session could not be read from Keychain. Refusing legacy fallback.',
        );
        recoveryError.code = 'session_keychain_read_failed';
        recoveryError.cause = error;
        throw recoveryError;
      }
    }

    if (getSessionScope() !== 'production' || (await this.isLegacyIgnored())) {
      return null;
    }

    if (!this.hasLocalInstallEvidence()) return null;

    // Historically the legacy Keychain item was primary and session.enc was
    // only its fallback. Successful Keychain saves could leave a stale file,
    // so a readable legacy Keychain payload must win when both exist.
    let legacyKeychainAbsenceConfirmed = false;
    if (this.keytarAvailable) {
      try {
        const payload = await keytar.getPassword(SERVICE_NAME, LEGACY_ACCOUNT_NAME);
        if (payload) return { payload, origin: 'legacy-keychain' };
        legacyKeychainAbsenceConfirmed = true;
      } catch (error) {
        console.warn('[SessionStore] Failed to load legacy session from keytar:', error.message);
        const recoveryError = new Error(
          'The legacy auth session could not be read from Keychain. Refusing stale file fallback.',
        );
        recoveryError.code = 'legacy_session_keychain_read_failed';
        recoveryError.cause = error;
        throw recoveryError;
      }
    }

    if (
      legacyKeychainIsAuthoritative &&
      !legacyKeychainAbsenceConfirmed &&
      !keytarDisabledByEnv
    ) {
      const recoveryError = new Error(
        'The legacy Keychain backend is unavailable on macOS. Refusing to infer that the legacy session is absent.',
      );
      recoveryError.code = 'legacy_session_keychain_unavailable';
      throw recoveryError;
    }

    try {
      const encrypted = await readFile(this.getLegacyFilePath(), 'utf8');
      return { payload: encrypted, origin: 'legacy-file' };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      const recoveryError = new Error(
        'The legacy auth session file is unreadable. Refusing to treat it as absent.',
      );
      recoveryError.code = 'legacy_session_store_unreadable';
      recoveryError.cause = error;
      throw recoveryError;
    }
  }

  async migrateValidatedPayload(storedPayload) {
    if (storedPayload.origin === 'scoped-keychain') {
      await this.promoteScopedKeychainPayload(storedPayload.payload);
      return;
    }

    if (storedPayload.origin === 'scoped-file-unmarked') {
      await this.ensureDirectoryExists();
      await this.atomicWrite(this.getAuthorityMarkerPath(), '1');
      return;
    }

    if (storedPayload.origin === 'scoped-file') return;
    if (storedPayload.origin.startsWith('legacy-')) {
      await this.persistScopedFile(storedPayload.payload);
      if (this.keytarAvailable && !this.scopedKeytarReadFailed) {
        try {
          await keytar.setPassword(SERVICE_NAME, getAccountName(), storedPayload.payload);
        } catch (error) {
          if (shouldDisableKeytar(error)) this.keytarAvailable = false;
          throw error;
        }
      }
      await this.markLegacyIgnored();
    }
  }

  async getSession() {
    return this.load();
  }

  async storeSession(session) {
    const saved = await this.save(session);
    return saved;
  }

  async clearSession() {
    await this.clear();
  }

  async getSettings() {
    if (this.settingsCache) {
      return { ...this.settingsCache };
    }

    const file = this.getSettingsFilePath();
    try {
      const contents = await readFile(file, 'utf8');
      const parsed = JSON.parse(contents);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Stored auth settings are not a JSON object');
      }
      this.settingsCache = parsed;
      return { ...this.settingsCache };
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.settingsCache = {};
        return {};
      }
      const recoveryError = new Error(
        'Existing auth settings could not be read. Refusing to overwrite them with defaults.',
      );
      recoveryError.code = 'auth_settings_unreadable';
      recoveryError.cause = error;
      throw recoveryError;
    }
  }

  async updateSettings(settings = {}) {
    const current = await this.getSettings();
    const merged = { ...current, ...settings };

    await this.ensureDirectoryExists();
    await this.atomicWrite(this.getSettingsFilePath(), JSON.stringify(merged, null, 2));
    this.settingsCache = merged;
    return merged;
  }
}

module.exports = new SessionStore();
