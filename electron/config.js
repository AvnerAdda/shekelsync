const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');

class ConfigManager {
  constructor() {
    this.configPath = this.getConfigPath();
    this.encryptionKey = this.getEncryptionKey();
  }

  getConfigPath() {
    // Store config in user data directory
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'config.enc');
  }

  getEncryptionKey() {
    // Use the same encryption key from the environment
    const envKey = process.env.CLARIFY_ENCRYPTION_KEY;
    if (envKey) {
      return Buffer.from(envKey, 'hex');
    }

    // Fallback: generate a key (not recommended for production)
    console.warn('No encryption key found in environment, using fallback');
    return crypto.scryptSync('electron-app-key', 'salt', 32);
  }

  encrypt(text) {
    try {
      // Simple but functional encryption for development
      const algorithm = 'aes-256-ctr';
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(algorithm, this.encryptionKey);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
      console.warn('Encryption failed, using base64 fallback:', error.message);
      // Fallback: just base64 encode for development
      return Buffer.from(text).toString('base64');
    }
  }

  decrypt(encryptedText) {
    try {
      // Check if it's the simple base64 fallback
      if (!encryptedText.includes(':')) {
        return Buffer.from(encryptedText, 'base64').toString('utf8');
      }

      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted format');
      }

      const [ivHex, encrypted] = parts;
      const algorithm = 'aes-256-ctr';
      const decipher = crypto.createDecipher(algorithm, this.encryptionKey);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.warn('Decryption failed, trying base64 fallback:', error.message);
      try {
        return Buffer.from(encryptedText, 'base64').toString('utf8');
      } catch (fallbackError) {
        throw new Error('Failed to decrypt data');
      }
    }
  }

  async saveConfig(config) {
    try {
      const configString = JSON.stringify(config, null, 2);
      const encryptedConfig = this.encrypt(configString);

      // Ensure the directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, encryptedConfig, 'utf8');
      console.log('Configuration saved successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to save config:', error);
      return { success: false, error: error.message };
    }
  }

  async loadConfig() {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.log('No config file found, using environment variables');
        return this.getDefaultConfig();
      }

      const encryptedConfig = fs.readFileSync(this.configPath, 'utf8');
      const configString = this.decrypt(encryptedConfig);
      const config = JSON.parse(configString);

      console.log('Configuration loaded successfully');
      return config;
    } catch (error) {
      console.error('Failed to load config:', error);
      console.log('Falling back to environment variables');
      return this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    return {
      database: {
        user: process.env.CLARIFY_DB_USER || 'clarify',
        host: process.env.CLARIFY_DB_HOST || 'localhost',
        database: process.env.CLARIFY_DB_NAME || 'my_clarify',
        password: process.env.CLARIFY_DB_PASSWORD || 'clarify_pass',
        port: parseInt(process.env.CLARIFY_DB_PORT) || 5432
      },
      app: {
        name: 'ShekelSync',
        version: '0.1.0',
        environment: process.env.NODE_ENV || 'development'
      },
      encryption: {
        key: process.env.CLARIFY_ENCRYPTION_KEY
      }
    };
  }

  async initializeConfig() {
    try {
      // Load existing config or create default
      const config = await this.loadConfig();

      // Save default config if it doesn't exist
      if (!fs.existsSync(this.configPath)) {
        await this.saveConfig(config);
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