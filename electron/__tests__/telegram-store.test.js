import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('telegram-store', () => {
  let tempDir;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-telegram-store-'));
    process.env.SHEKELSYNC_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.SHEKELSYNC_TEST_USER_DATA = tempDir;
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
});
