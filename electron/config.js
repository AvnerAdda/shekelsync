const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const app = globalThis.__SHEKELSYNC_ELECTRON_APP__ || require('electron').app;
const { atomicWriteFileSync } = require('./durable-file');

class ConfigManager {
  constructor() {
    this.configPath = this.getConfigPath();
    this.needsReencrypt = false;
    this.loadFailed = false;
  }

  getConfigPath() {
    // Store config in user data directory
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'config.enc');
  }

  getEncryptionKey() {
    // Use the same encryption key from the environment (set by secure key manager)
    const envKey = process.env.SHEKELSYNC_ENCRYPTION_KEY;
    if (envKey) {
      return Buffer.from(envKey, 'hex');
    }

    throw new Error('SHEKELSYNC_ENCRYPTION_KEY must be set before encrypting config.');
  }

  encrypt(text) {
    try {
      const algorithm = 'aes-256-ctr';
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(algorithm, this.getEncryptionKey(), iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
      console.error('Encryption failed:', error.message);
      throw error;
    }
  }

  decrypt(encryptedText) {
    if (!encryptedText.includes(':')) {
      return Buffer.from(encryptedText, 'base64').toString('utf8');
    }
    const parts = encryptedText.split(':');
    if (parts.length !== 2) throw new Error('Invalid encrypted format');
    const [ivHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-ctr',
      this.getEncryptionKey(),
      Buffer.from(ivHex, 'hex'),
    );
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  }

  decryptAndParse(encryptedText) {
    const parse = (plaintext) => {
      const config = JSON.parse(plaintext);
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('Configuration must be a JSON object');
      }
      return config;
    };

    if (!encryptedText.includes(':')) {
      return parse(Buffer.from(encryptedText, 'base64').toString('utf8'));
    }

    try {
      return parse(this.decrypt(encryptedText));
    } catch (currentError) {
      try {
        const [ivHex, encrypted] = encryptedText.split(':');
        if (!ivHex || !encrypted) throw new Error('Invalid legacy encrypted format');
        const legacyKey = crypto.scryptSync('electron-app-key', 'salt', 32);
        const decipher = crypto.createDecipheriv(
          'aes-256-ctr',
          legacyKey,
          Buffer.from(ivHex, 'hex'),
        );
        const plaintext = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
        const config = parse(plaintext);
        this.needsReencrypt = true;
        console.warn('Config decrypted with legacy key; will re-encrypt with OS keychain.');
        return config;
      } catch (legacyError) {
        console.warn('Configuration decryption failed:', legacyError.message);
        throw new Error('Failed to decrypt configuration');
      }
    }
  }

  async saveConfig(config) {
    try {
      if (this.loadFailed && fs.existsSync(this.configPath)) {
        throw new Error(
          'Existing configuration could not be decrypted. Refusing to overwrite it without an explicit reset.',
        );
      }
      const configString = JSON.stringify(config, null, 2);
      const encryptedConfig = this.encrypt(configString);

      // Ensure the directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      atomicWriteFileSync(this.configPath, encryptedConfig);
      console.log('Configuration saved successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to save config:', error);
      return { success: false, error: error.message };
    }
  }

  async loadConfig() {
    try {
      console.log('Loading config from:', this.configPath);
      if (!fs.existsSync(this.configPath)) {
        console.log('No config file found, using environment variables');
        this.loadFailed = false;
        return this.getDefaultConfig();
      }

      const stat = fs.statSync(this.configPath);
      if (stat.isDirectory()) {
        console.warn(`Config path ${this.configPath} is a directory. Ignoring and using defaults.`);
        this.loadFailed = true;
        return this.getDefaultConfig();
      }

      const encryptedConfig = fs.readFileSync(this.configPath, 'utf8');
      const config = this.decryptAndParse(encryptedConfig);
      this.loadFailed = false;

      if (this.needsReencrypt) {
        const result = await this.saveConfig(config);
        if (result.success) {
          this.needsReencrypt = false;
          console.log('Configuration re-encrypted with OS keychain.');
        } else {
          // The config decrypted fine; only the durable rewrite failed. Keep
          // the legacy file authoritative and retry on the next save instead
          // of routing the user into decrypt-failure recovery.
          console.warn(`Re-encryption failed; keeping legacy config and retrying on next save: ${result.error}`);
        }
      }

      console.log('Configuration loaded successfully');
      return config;
    } catch (error) {
      console.error('Failed to load config:', error);
      // A wrong encryption key commonly produces invalid JSON here. Preserve
      // the original file and block implicit saves so recovery material is not
      // destroyed by a fallback-to-defaults startup.
      this.loadFailed = fs.existsSync(this.configPath);
      if (this.loadFailed) {
        console.warn('Configuration is unreadable; preserving it and blocking implicit overwrite.');
      }
      console.log('Falling back to environment variables');
      return this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    // SQLite-only configuration for Electron desktop app
    const preferredSqlitePath = path.join(app.getPath('userData'), 'shekelsync.sqlite');
    const legacySqlitePath = path.join(app.getPath('userData'), 'clarify.sqlite');
    const fallbackSqlitePath = fs.existsSync(preferredSqlitePath)
      ? preferredSqlitePath
      : fs.existsSync(legacySqlitePath)
        ? legacySqlitePath
        : preferredSqlitePath;
    const defaultSqlitePath = process.env.SQLITE_DB_PATH || fallbackSqlitePath;

    return {
      database: {
        mode: 'sqlite',
        path: defaultSqlitePath
      },
      app: {
        name: 'ShekelSync',
        version: '0.1.0',
        environment: process.env.NODE_ENV || 'development'
      }
    };
  }

  async initializeConfig() {
    try {
      // Load existing config or create default
      const config = await this.loadConfig();
      if (this.loadFailed && fs.existsSync(this.configPath)) {
        throw new Error(
          'Existing configuration could not be decrypted. Recovery is required before startup can continue.',
        );
      }

      // Save default config if it doesn't exist
      if (!fs.existsSync(this.configPath)) {
        const result = await this.saveConfig(config);
        if (!result.success) throw new Error(result.error);
      }

      return config;
    } catch (error) {
      console.error('Failed to initialize config:', error);
      throw error;
    }
  }

  async updateConfig(updates) {
    try {
      const currentConfig = await this.loadConfig();
      const updatedConfig = this.deepMerge(currentConfig, updates);

      const result = await this.saveConfig(updatedConfig);
      if (result.success) {
        return updatedConfig;
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to update config:', error);
      throw error;
    }
  }

  deepMerge(target, source) {
    const output = Object.assign({}, target);
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target))
            Object.assign(output, { [key]: source[key] });
          else
            output[key] = this.deepMerge(target[key], source[key]);
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  isObject(item) {
    return (item && typeof item === "object" && !Array.isArray(item));
  }

  // Method to reset config (useful for testing or recovery)
  async resetConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        fs.unlinkSync(this.configPath);
        console.log('Configuration reset successfully');
      }
      this.loadFailed = false;
      return await this.initializeConfig();
    } catch (error) {
      console.error('Failed to reset config:', error);
      throw error;
    }
  }
}

// Create a singleton instance
const configManager = new ConfigManager();

module.exports = {
  ConfigManager,
  configManager
};
