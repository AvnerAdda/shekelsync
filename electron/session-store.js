const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { resolveAppPath, requireFromApp } = require('./paths');

let keytar;
const keytarDisabledByEnv =
  process.env.KEYTAR_DISABLE === 'true' ||
  process.env.DBUS_SESSION_BUS_ADDRESS === 'disabled:';
const keytarDisabled = keytarDisabledByEnv;

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

const { mkdir, readFile, unlink, writeFile } = fs.promises;

const SERVICE_NAME = 'ShekelSync';
const ACCOUNT_NAME = 'auth-session';

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
  }

  getFilePath() {
    if (this.filePath) {
      return this.filePath;
    }

    const userData = app.getPath('userData');
    const directory = path.join(userData, 'secure-store');
    this.filePath = path.join(directory, 'session.enc');
    return this.filePath;
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

    const encryptedPayload = await this.loadEncryptedPayload();
    if (!encryptedPayload) {
      return null;
    }

    try {
      const json = decrypt(encryptedPayload);
      const parsed = JSON.parse(json);
      this.cache = parsed;
      return parsed;
    } catch (error) {
      console.warn('[SessionStore] Failed to decrypt stored session:', error.message);
      return null;
    }
  }

  async save(session) {
    if (!session) {
      await this.clear();
      return null;
    }

    const serialized = JSON.stringify(session);
    const encrypted = encrypt(serialized);

    if (this.keytarAvailable) {
      try {
        await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, encrypted);
        await this.clearFileStore();
        this.cache = session;
        return session;
      } catch (error) {
        console.warn('[SessionStore] Failed to persist session to keytar, falling back to file:', error.message);
        if (shouldDisableKeytar(error)) {
          this.keytarAvailable = false;
        }
      }
    }

    await this.ensureDirectoryExists();
    await writeFile(this.getFilePath(), encrypted, 'utf8');
    this.cache = session;
    return session;
  }

  async clear() {
    this.cache = null;

    if (this.keytarAvailable) {
      try {
        await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
      } catch (error) {
        console.warn('[SessionStore] Failed to clear keytar entry:', error.message);
        if (shouldDisableKeytar(error)) {
          this.keytarAvailable = false;
        }
      }
    }

    await this.clearFileStore();
    return null;
  }

  async clearFileStore() {
    const file = this.getFilePath();
    try {
      await unlink(file);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[SessionStore] Failed to clear session file:', error.message);
      }
    }
  }

  async loadEncryptedPayload() {
    if (this.keytarAvailable) {
      try {
        const payload = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
        if (payload) {
          return payload;
        }
      } catch (error) {
        console.warn('[SessionStore] Failed to load session from keytar:', error.message);
        if (shouldDisableKeytar(error)) {
          this.keytarAvailable = false;
        }
      }
    }

    const file = this.getFilePath();
    try {
      const encrypted = await readFile(file, 'utf8');

      // If keytar is available but empty, migrate the encrypted payload from disk.
      if (this.keytarAvailable) {
        try {
          await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, encrypted);
          await this.clearFileStore();
        } catch (migrationError) {
          console.warn('[SessionStore] Failed to migrate session from file to keytar:', migrationError.message);
        }
      }

      return encrypted;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[SessionStore] Failed to load session from file:', error.message);
      }
      return null;
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
      this.settingsCache = parsed || {};
      return { ...this.settingsCache };
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') {
        console.warn('[SessionStore] Failed to read auth settings:', error.message);
      }
      this.settingsCache = {};
      return {};
    }
  }

  async updateSettings(settings = {}) {
    const current = await this.getSettings();
    const merged = { ...current, ...settings };

    await this.ensureDirectoryExists();
    await writeFile(this.getSettingsFilePath(), JSON.stringify(merged, null, 2), 'utf8');
    this.settingsCache = merged;
    return merged;
  }
}

module.exports = new SessionStore();
