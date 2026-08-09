import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('chatbot-secret-store', () => {
  let tempDir;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-chatbot-secret-store-'));
    process.env.SHEKELSYNC_ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.SHEKELSYNC_TEST_USER_DATA = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.SHEKELSYNC_ENCRYPTION_KEY;
    delete process.env.SHEKELSYNC_TEST_USER_DATA;
  });

  it('returns an empty store only when no encrypted file exists', async () => {
    const storeModule = await import('../chatbot-secret-store.js');
    const store = storeModule.default || storeModule;

    expect(await store.load()).toEqual({});
  });

  it('persists and loads encrypted chatbot secrets', async () => {
    const storeModule = await import('../chatbot-secret-store.js');
    const store = storeModule.default || storeModule;

    await store.save({ openAiApiKey: 'secret-api-key' });

    const filePath = path.join(tempDir, 'secure-store', 'chatbot-secrets.enc');
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('secret-api-key');
    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    }
    expect(await store.load()).toEqual({ openAiApiKey: 'secret-api-key' });
  });

  it('preserves the previous encrypted secrets when atomic replacement fails', async () => {
    const storeModule = await import('../chatbot-secret-store.js');
    const store = storeModule.default || storeModule;
    await store.save({ openAiApiKey: 'original-key' });
    const filePath = path.join(tempDir, 'secure-store', 'chatbot-secrets.enc');
    const originalFile = fs.readFileSync(filePath, 'utf8');
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
      new Error('simulated rename failure'),
    );

    try {
      await expect(store.save({ openAiApiKey: 'replacement-key' })).rejects.toThrow(
        'simulated rename failure',
      );
      expect(fs.readFileSync(filePath, 'utf8')).toBe(originalFile);
      expect(await store.load()).toEqual({ openAiApiKey: 'original-key' });
      expect(fs.readdirSync(path.dirname(filePath)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('fails closed when an existing encrypted store cannot be decrypted', async () => {
    const filePath = path.join(tempDir, 'secure-store', 'chatbot-secrets.enc');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'corrupt-existing-ciphertext', { mode: 0o600 });

    const storeModule = await import('../chatbot-secret-store.js');
    const store = storeModule.default || storeModule;

    await expect(store.load()).rejects.toMatchObject({
      code: 'chatbot_secret_store_unreadable',
    });
    await expect(store.load()).rejects.toMatchObject({
      code: 'chatbot_secret_store_unreadable',
    });
  });
});
