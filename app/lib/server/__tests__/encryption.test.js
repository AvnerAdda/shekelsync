import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const encryptionPath = require.resolve('../encryption.js');

function reloadEncryption() {
  delete require.cache[encryptionPath];
  // eslint-disable-next-line global-require
  return require('../encryption.js');
}

describe('server encryption helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    delete require.cache[encryptionPath];
  });

  it('falls back to dev key when allowed', () => {
    process.env.SHEKELSYNC_ENCRYPTION_KEY = '';
    process.env.ALLOW_DEV_NO_ENCRYPTION = 'true';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { encrypt, decrypt } = reloadEncryption();
    const cipher = encrypt('hello-dev');
    expect(typeof cipher).toBe('string');
    expect(decrypt(cipher)).toBe('hello-dev');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws for invalid key length', () => {
    process.env.SHEKELSYNC_ENCRYPTION_KEY = '1234';
    const { encrypt } = reloadEncryption();

    expect(() => encrypt('oops')).toThrow(/64-character hex/);
  });

  it('encrypts and decrypts with provided key', () => {
    process.env.ALLOW_DEV_NO_ENCRYPTION = '';
    process.env.SHEKELSYNC_ENCRYPTION_KEY = 'a'.repeat(64);
    const { encrypt, decrypt } = reloadEncryption();

    const cipher = encrypt('secret-text');
    expect(cipher.split(':')).toHaveLength(3);
    expect(decrypt(cipher)).toBe('secret-text');
  });

  it('handles nulls and non-strings gracefully', () => {
    process.env.ALLOW_DEV_NO_ENCRYPTION = 'true';
    const { encrypt, decrypt } = reloadEncryption();

    expect(decrypt(null)).toBeNull();
    expect(encrypt(123)).toBe('123');
    expect(() => decrypt('not:encrypted')).toThrow();
  });
});
