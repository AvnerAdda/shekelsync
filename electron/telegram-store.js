const path = require('path');
const fs = require('fs');
const { resolveAppPath } = require('./paths');

let app;
try {
  ({ app } = require('electron'));
} catch {
  app = {
    getPath: () => process.env.SHEKELSYNC_TEST_USER_DATA || process.cwd(),
  };
}

const { encrypt, decrypt } = require(resolveAppPath('lib', 'server', 'encryption.js'));

const { mkdir, readFile, unlink, writeFile } = fs.promises;

class TelegramStore {
  constructor() {
    this.filePath = null;
    this.cache = null;
  }

  getFilePath() {
    if (this.filePath) {
      return this.filePath;
    }

    const userData = app.getPath('userData');
    const directory = path.join(userData, 'secure-store');
    this.filePath = path.join(directory, 'telegram.enc');
    return this.filePath;
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
      return { ...this.cache };
    }

    const file = this.getFilePath();
    try {
      const encrypted = await readFile(file, 'utf8');
      const decrypted = decrypt(encrypted);
      const parsed = JSON.parse(decrypted);
      this.cache = parsed || {};
      return { ...this.cache };
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') {
        console.warn('[TelegramStore] Failed to load telegram secrets:', error.message);
      }
      this.cache = {};
      return {};
    }
  }

  async save(nextState = {}) {
    await this.ensureDirectoryExists();
    const serialized = JSON.stringify(nextState);
    const encrypted = encrypt(serialized);
    await writeFile(this.getFilePath(), encrypted, 'utf8');
    this.cache = { ...nextState };
    return { ...this.cache };
  }

  async update(patch = {}) {
    const current = await this.load();
    const nextState = {
      ...current,
      ...patch,
    };
    return this.save(nextState);
  }

  async clear() {
    this.cache = {};
    try {
      await unlink(this.getFilePath());
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

module.exports = new TelegramStore();
