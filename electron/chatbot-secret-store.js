const path = require('path');
const fs = require('fs');
const { resolveAppPath } = require('./paths');
const { atomicWriteFile } = require('./durable-file');

let app;
try {
  ({ app } = require('electron'));
} catch {
  app = {
    getPath: () => process.env.SHEKELSYNC_TEST_USER_DATA || process.cwd(),
  };
}

const { encrypt, decrypt } = require(resolveAppPath('lib', 'server', 'encryption.js'));
const { mkdir, readFile, unlink } = fs.promises;

class ChatbotSecretStore {
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
    this.filePath = path.join(directory, 'chatbot-secrets.enc');
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

    try {
      const encrypted = await readFile(this.getFilePath(), 'utf8');
      const decrypted = decrypt(encrypted);
      const parsed = JSON.parse(decrypted);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Stored chatbot secrets are not a JSON object');
      }
      this.cache = parsed;
      return { ...this.cache };
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.cache = {};
        return {};
      }

      console.warn('[ChatbotSecretStore] Failed to load chatbot secrets:', error.message);
      const recoveryError = new Error(
        'Existing chatbot secrets could not be read or decrypted. Refusing to treat them as absent.',
      );
      recoveryError.code = 'chatbot_secret_store_unreadable';
      recoveryError.cause = error;
      throw recoveryError;
    }
  }

  async save(nextState = {}) {
    await this.ensureDirectoryExists();
    const serialized = JSON.stringify(nextState);
    const encrypted = encrypt(serialized);
    await atomicWriteFile(this.getFilePath(), encrypted);
    this.cache = { ...nextState };
    return { ...this.cache };
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

module.exports = new ChatbotSecretStore();
