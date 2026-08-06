import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('telegram-store', () => {
  let tempDir;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-telegram-store-'));
    process.env.SHEKELSYNC_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.SHEKELSYNC_TEST_USER_DATA = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.SHEKELSYNC_ENCRYPTION_KEY;
    delete process.env.SHEKELSYNC_TEST_USER_DATA;
  });

  it('persists telegram secrets in encrypted storage and can clear them', async () => {
    const telegramStoreModule = await import('../telegram-store.js');
    const telegramStore = telegramStoreModule.default || telegramStoreModule;

    await telegramStore.save({
      botToken: '123456:secret-token',
      chatId: 42,
      chatUsername: 'alice',
    });

    const filePath = path.join(tempDir, 'secure-store', 'telegram.enc');
    const raw = fs.readFileSync(filePath, 'utf8');
    expect(raw).not.toContain('secret-token');
    expect(raw).not.toContain('alice');
    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    }

    const loaded = await telegramStore.load();
    expect(loaded).toMatchObject({
      botToken: '123456:secret-token',
      chatId: 42,
      chatUsername: 'alice',
    });

    await telegramStore.clear();
    expect(fs.existsSync(filePath)).toBe(false);
    expect(await telegramStore.load()).toEqual({});
  });

  it('preserves the previous encrypted secrets when atomic replacement fails', async () => {
    const telegramStoreModule = await import('../telegram-store.js');
    const telegramStore = telegramStoreModule.default || telegramStoreModule;
    await telegramStore.save({ botToken: 'original-token', chatId: 7 });
    const filePath = path.join(tempDir, 'secure-store', 'telegram.enc');
    const originalFile = fs.readFileSync(filePath, 'utf8');
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
      new Error('simulated rename failure'),
    );

    try {
      await expect(telegramStore.save({ botToken: 'replacement-token', chatId: 8 }))
        .rejects.toThrow('simulated rename failure');
      expect(fs.readFileSync(filePath, 'utf8')).toBe(originalFile);
      expect(await telegramStore.load()).toMatchObject({ botToken: 'original-token', chatId: 7 });
      expect(fs.readdirSync(path.dirname(filePath)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('fails closed when an existing encrypted store cannot be decrypted', async () => {
    const filePath = path.join(tempDir, 'secure-store', 'telegram.enc');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'corrupt-existing-ciphertext', { mode: 0o600 });

    const telegramStoreModule = await import('../telegram-store.js');
    const telegramStore = telegramStoreModule.default || telegramStoreModule;

    await expect(telegramStore.load()).rejects.toMatchObject({
      code: 'telegram_secret_store_unreadable',
    });
    await expect(telegramStore.load()).rejects.toMatchObject({
      code: 'telegram_secret_store_unreadable',
    });
  });
});
