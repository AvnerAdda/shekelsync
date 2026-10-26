import { afterEach, describe, expect, it } from 'vitest';

const storeModule = await import('../master-key-store.js');
const { MASTER_KEY_SLOT, getMasterKey, getMasterKeySource, setMasterKey } = storeModule.default || storeModule;
const encryptionModule = await import('../../app/lib/server/encryption.js');
const { encrypt, decrypt } = encryptionModule.default || encryptionModule;

const KEY = 'a'.repeat(64);

afterEach(() => {
  delete globalThis[MASTER_KEY_SLOT];
  delete process.env.SHEKELSYNC_ENCRYPTION_KEY;
});

describe('master-key-store', () => {
  it('keeps the key in memory and removes it from the environment', () => {
    process.env.SHEKELSYNC_ENCRYPTION_KEY = KEY;
    setMasterKey(KEY, { source: 'environment' });

    expect(process.env.SHEKELSYNC_ENCRYPTION_KEY).toBeUndefined();
    expect(getMasterKey()).toBe(KEY);
    expect(getMasterKeySource()).toBe('environment');
  });

  it('falls back to the environment for standalone scripts', () => {
    process.env.SHEKELSYNC_ENCRYPTION_KEY = KEY;
    expect(getMasterKey()).toBe(KEY);
    expect(getMasterKeySource()).toBe('environment');
  });

  it('is the key the credential encryption module uses', () => {
    setMasterKey(KEY);
    expect(decrypt(encrypt('secret'))).toBe('secret');
    expect(Object.keys(process.env)).not.toContain('SHEKELSYNC_ENCRYPTION_KEY');
  });
});
