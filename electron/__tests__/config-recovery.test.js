import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const testDirectory = '/tmp/shekelsync-config-recovery-test';

function encryptConfig(config, keyHex) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(config), 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

describe('configuration recovery safety', () => {
  let originalKey;

  beforeEach(() => {
    originalKey = process.env.SHEKELSYNC_ENCRYPTION_KEY;
    fs.rmSync(testDirectory, { recursive: true, force: true });
    fs.mkdirSync(testDirectory, { recursive: true });
    globalThis.__SHEKELSYNC_ELECTRON_APP__ = {
      getPath: vi.fn(() => testDirectory),
    };
    vi.resetModules();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SHEKELSYNC_ENCRYPTION_KEY;
    else process.env.SHEKELSYNC_ENCRYPTION_KEY = originalKey;
    delete globalThis.__SHEKELSYNC_ELECTRON_APP__;
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  it('preserves an unreadable encrypted config and blocks implicit overwrite', async () => {
    const originalEncryptionKey = '1'.repeat(64);
    process.env.SHEKELSYNC_ENCRYPTION_KEY = '2'.repeat(64);
    const configPath = path.join(testDirectory, 'config.enc');
    const originalFile = encryptConfig({ database: { mode: 'sqlite' } }, originalEncryptionKey);
    fs.writeFileSync(configPath, originalFile, { mode: 0o600 });

    const module = await import('../config.js');
    const { ConfigManager } = module.default || module;
    const manager = new ConfigManager();

    const fallback = await manager.loadConfig();

    expect(fallback.database.mode).toBe('sqlite');
    expect(manager.loadFailed).toBe(true);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(originalFile);

    await expect(manager.updateConfig({ app: { name: 'changed' } }))
      .rejects.toThrow('Refusing to overwrite');
    await expect(manager.initializeConfig()).rejects.toThrow('Recovery is required');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(originalFile);
  });

  it('parses a legacy-key config before re-encrypting it with the current key', async () => {
    const currentKey = '7'.repeat(64);
    process.env.SHEKELSYNC_ENCRYPTION_KEY = currentKey;
    const configPath = path.join(testDirectory, 'config.enc');
    const legacyKey = crypto.scryptSync('electron-app-key', 'salt', 32).toString('hex');
    const legacyFile = encryptConfig(
      { database: { mode: 'sqlite', path: path.join(testDirectory, 'custom.sqlite') } },
      legacyKey,
    );
    fs.writeFileSync(configPath, legacyFile, { mode: 0o600 });

    const module = await import('../config.js');
    const { ConfigManager } = module.default || module;
    const manager = new ConfigManager();

    const config = await manager.loadConfig();

    expect(config.database.path).toContain('custom.sqlite');
    expect(manager.loadFailed).toBe(false);
    expect(fs.readFileSync(configPath, 'utf8')).not.toBe(legacyFile);
    expect(new ConfigManager().decryptAndParse(fs.readFileSync(configPath, 'utf8'))).toEqual(config);
    if (process.platform !== 'win32') {
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps the decrypted legacy config usable when atomic re-encryption cannot install', async () => {
    const currentKey = '8'.repeat(64);
    process.env.SHEKELSYNC_ENCRYPTION_KEY = currentKey;
    const configPath = path.join(testDirectory, 'config.enc');
    const legacyKey = crypto.scryptSync('electron-app-key', 'salt', 32).toString('hex');
    const legacyFile = encryptConfig(
      { database: { mode: 'sqlite', path: path.join(testDirectory, 'legacy.sqlite') } },
      legacyKey,
    );
    fs.writeFileSync(configPath, legacyFile, { mode: 0o600 });
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated rename failure');
    });

    try {
      const module = await import('../config.js');
      const { ConfigManager } = module.default || module;
      const manager = new ConfigManager();

      const config = await manager.loadConfig();

      expect(config.database.path).toContain('legacy.sqlite');
      expect(manager.loadFailed).toBe(false);
      expect(manager.needsReencrypt).toBe(true);
      expect(fs.readFileSync(configPath, 'utf8')).toBe(legacyFile);
      expect(fs.readdirSync(testDirectory).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }
  });
});
