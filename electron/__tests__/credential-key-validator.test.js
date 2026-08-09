import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const validatorModule = await import('../credential-key-validator.js');
const { validateCredentialKey, validateCredentialRows } = validatorModule.default || validatorModule;
const testDirectory = '/tmp/shekelsync-credential-key-validator-test';
const originalDatabasePath = process.env.SQLITE_DB_PATH;

function encrypt(value, keyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
}

function encryptConfig(config, keyHex) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(config), 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function databaseCtor(rows, openedPaths = []) {
  return class FakeDatabase {
    constructor(databasePath, options) {
      openedPaths.push({ databasePath, options });
    }

    pragma() {}

    prepare(sql) {
      if (sql.includes('sqlite_master')) return { get: () => ({ present: 1 }) };
      return { all: () => rows };
    }

    close() {}
  };
}

afterEach(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.SQLITE_DB_PATH;
  else process.env.SQLITE_DB_PATH = originalDatabasePath;
  vi.restoreAllMocks();
});

describe('credential key validator', () => {
  it('authenticates every encrypted credential field without returning plaintext', () => {
    const key = '1'.repeat(64);
    const result = validateCredentialRows([
      {
        username: encrypt('user', key),
        password: encrypt('secret', key),
        id_number: null,
        identification_code: encrypt('code', key),
      },
    ], key);

    expect(result).toEqual({
      status: 'match',
      encryptedFields: 3,
      authenticatedFields: 3,
      failedFields: 0,
      malformedFields: 0,
      plainFields: 0,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('rejects a wrong key and mixed-key rows', () => {
    const key = '2'.repeat(64);
    const otherKey = '3'.repeat(64);
    const wrong = validateCredentialRows([{ username: encrypt('user', key) }], otherKey);
    const mixed = validateCredentialRows([
      { username: encrypt('one', key), password: encrypt('two', otherKey) },
    ], key);

    expect(wrong.status).toBe('mismatch');
    expect(wrong.failedFields).toBe(1);
    expect(mixed.status).toBe('partial');
    expect(mixed.authenticatedFields).toBe(1);
    expect(mixed.failedFields).toBe(1);
  });

  it('fails closed for malformed envelopes and ignores null or legacy plain values', () => {
    const key = '4'.repeat(64);
    const result = validateCredentialRows([
      {
        username: 'legacy-user',
        password: 'bad:envelope',
        id_number: null,
        identification_code: '',
      },
    ], key);

    expect(result.status).toBe('malformed');
    expect(result.malformedFields).toBe(1);
    expect(result.plainFields).toBe(1);
  });

  it('reports empty data distinctly and rejects trailing key garbage', () => {
    expect(validateCredentialRows([], '5'.repeat(64)).status).toBe('empty');
    expect(validateCredentialRows([], `${'5'.repeat(64)}junk`).status).toBe('invalid_key');
  });

  it('distinguishes a provable first run from a missing explicit database', () => {
    const key = '6'.repeat(64);
    fs.mkdirSync(testDirectory, { recursive: true });
    const missingPath = path.join(testDirectory, 'missing.sqlite');

    expect(validateCredentialKey(key, { userDataPath: testDirectory }).status).toBe('fresh');
    expect(validateCredentialKey(key, {
      userDataPath: testDirectory,
      databasePath: missingPath,
    }).status).toBe('missing');
  });

  it('reports an existing zero-row credential table as empty', () => {
    const key = '7'.repeat(64);
    const databasePath = path.join(testDirectory, 'shekelsync.sqlite');
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(databasePath, 'sqlite-placeholder');

    const result = validateCredentialKey(key, {
      userDataPath: testDirectory,
      databaseCtor: databaseCtor([]),
    });

    expect(result.status).toBe('empty');
  });

  it('uses candidate-readable config to validate the configured custom database only', () => {
    const key = '8'.repeat(64);
    const wrongKey = '9'.repeat(64);
    const databasePath = path.join(testDirectory, 'custom.sqlite');
    const openedPaths = [];
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(databasePath, 'sqlite-placeholder');
    fs.writeFileSync(
      path.join(testDirectory, 'config.enc'),
      encryptConfig({ database: { mode: 'sqlite', path: databasePath } }, key),
    );

    const matching = validateCredentialKey(key, {
      userDataPath: testDirectory,
      databaseCtor: databaseCtor([{ username: encrypt('user', key) }], openedPaths),
    });
    const wrong = validateCredentialKey(wrongKey, {
      userDataPath: testDirectory,
      databaseCtor: databaseCtor([], openedPaths),
    });

    expect(matching.status).toBe('match');
    expect(openedPaths).toHaveLength(1);
    expect(openedPaths[0].databasePath).toBe(databasePath);
    expect(wrong.status).toBe('config_mismatch');
  });

  it('blocks ambiguous default and legacy databases instead of picking an empty decoy', () => {
    const key = 'a'.repeat(64);
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(path.join(testDirectory, 'shekelsync.sqlite'), 'preferred');
    fs.writeFileSync(path.join(testDirectory, 'clarify.sqlite'), 'legacy');

    const result = validateCredentialKey(key, {
      userDataPath: testDirectory,
      databaseCtor: databaseCtor([]),
    });

    expect(result.status).toBe('ambiguous');
  });

  it('fails closed when the configured database cannot be opened', () => {
    const key = 'b'.repeat(64);
    const databasePath = path.join(testDirectory, 'shekelsync.sqlite');
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(databasePath, 'sqlite-placeholder');
    class FailingDatabase {
      constructor() {
        throw new Error('database unavailable');
      }
    }

    expect(validateCredentialKey(key, {
      userDataPath: testDirectory,
      databaseCtor: FailingDatabase,
    }).status).toBe('unavailable');
  });

  it('does not treat an inaccessible config path as a fresh install', () => {
    const key = 'c'.repeat(64);
    fs.mkdirSync(testDirectory, { recursive: true });
    const configPath = path.join(testDirectory, 'config.enc');
    const statSync = fs.statSync.bind(fs);
    vi.spyOn(fs, 'statSync').mockImplementation((candidatePath, ...args) => {
      if (candidatePath === configPath) {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      }
      return statSync(candidatePath, ...args);
    });

    expect(validateCredentialKey(key, { userDataPath: testDirectory }).status).toBe('unavailable');
  });

  it('does not treat an unreadable auxiliary artifact as absent', () => {
    const key = 'd'.repeat(64);
    const artifactPath = path.join(testDirectory, 'secure-store', 'chatbot-secrets.enc');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, 'placeholder');
    const readFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, 'readFileSync').mockImplementation((candidatePath, ...args) => {
      if (candidatePath === artifactPath) {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      }
      return readFileSync(candidatePath, ...args);
    });

    expect(validateCredentialKey(key, { userDataPath: testDirectory }).status).toBe('unavailable');
  });

  it('does not let a malformed legacy-ignore marker hide recovery ciphertext', () => {
    const key = 'e'.repeat(64);
    const markerPath = path.join(testDirectory, 'secure-store', '.legacy-session-ignored');
    fs.mkdirSync(markerPath, { recursive: true });

    expect(validateCredentialKey(key, { userDataPath: testDirectory }).status).toBe('unavailable');
  });

  it('does not treat an authoritative-session marker without its payload as a fresh install', () => {
    const key = 'f'.repeat(64);
    const markerPath = path.join(testDirectory, 'secure-store', '.session-file-authoritative');
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, '1', { mode: 0o600 });

    expect(validateCredentialKey(key, { userDataPath: testDirectory })).toMatchObject({
      status: 'unavailable',
      auxiliaryStatus: 'unavailable',
    });
  });

  it('fails closed if an authoritative session disappears between inspection and read', () => {
    const key = '0'.repeat(64);
    const secureStorePath = path.join(testDirectory, 'secure-store');
    const markerPath = path.join(secureStorePath, '.session-file-authoritative');
    const sessionPath = path.join(secureStorePath, 'session.production.enc');
    fs.mkdirSync(secureStorePath, { recursive: true });
    fs.writeFileSync(markerPath, '1', { mode: 0o600 });
    fs.writeFileSync(sessionPath, encrypt('{"user":{"id":"test"}}', key), { mode: 0o600 });
    const readFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, 'readFileSync').mockImplementation((candidatePath, ...args) => {
      if (candidatePath === sessionPath) {
        fs.unlinkSync(sessionPath);
        const error = new Error('session disappeared');
        error.code = 'ENOENT';
        throw error;
      }
      return readFileSync(candidatePath, ...args);
    });

    expect(validateCredentialKey(key, { userDataPath: testDirectory })).toMatchObject({
      status: 'unavailable',
      auxiliaryStatus: 'unavailable',
    });
  });

  it('uses encrypted auxiliary artifacts as authentication evidence when no database exists', () => {
    const key = 'f'.repeat(64);
    const wrongKey = '1'.repeat(64);
    const secureStore = path.join(testDirectory, 'secure-store');
    fs.mkdirSync(secureStore, { recursive: true });
    fs.writeFileSync(path.join(secureStore, 'chatbot-secrets.enc'), encrypt('{"apiKey":"x"}', key));

    expect(validateCredentialKey(wrongKey, { userDataPath: testDirectory }).status).toBe('mismatch');
    expect(validateCredentialKey(key, { userDataPath: testDirectory }).status).toBe('match');
  });

  it('requires one key to authenticate both an empty database and auxiliary artifacts', () => {
    const key = '2'.repeat(64);
    const wrongKey = '3'.repeat(64);
    const databasePath = path.join(testDirectory, 'shekelsync.sqlite');
    const secureStore = path.join(testDirectory, 'secure-store');
    fs.mkdirSync(secureStore, { recursive: true });
    fs.writeFileSync(databasePath, 'sqlite-placeholder');
    fs.writeFileSync(path.join(secureStore, 'telegram.enc'), encrypt('{"token":"x"}', key));

    expect(validateCredentialKey(key, {
      userDataPath: testDirectory,
      databaseCtor: databaseCtor([]),
    }).status).toBe('match');
    expect(validateCredentialKey(wrongKey, {
      userDataPath: testDirectory,
      databaseCtor: databaseCtor([]),
    }).status).toBe('mismatch');
  });

  it('normalizes mixed-case Postgres mode but labels base64 config as candidate-unbound', () => {
    const key = '4'.repeat(64);
    const wrongKey = '5'.repeat(64);
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(testDirectory, 'config.enc'),
      Buffer.from(JSON.stringify({ database: { mode: 'Postgres' } })).toString('base64'),
    );

    const matching = validateCredentialKey(key, { userDataPath: testDirectory });
    const wrong = validateCredentialKey(wrongKey, { userDataPath: testDirectory });

    expect(matching).toMatchObject({ status: 'config_match', configStatus: 'base64' });
    expect(wrong).toMatchObject({ status: 'config_match', configStatus: 'base64' });
  });

  it('labels candidate-readable Postgres config for environment-key validation', () => {
    const key = '6'.repeat(64);
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(testDirectory, 'config.enc'),
      encryptConfig({ database: { mode: 'Postgres' } }, key),
    );

    expect(validateCredentialKey(key, { userDataPath: testDirectory })).toMatchObject({
      status: 'config_match',
      configStatus: 'candidate',
    });
  });

  it('uses auxiliary authentication to bind a legacy Postgres config to the candidate key', () => {
    const key = '7'.repeat(64);
    const wrongKey = '8'.repeat(64);
    const secureStore = path.join(testDirectory, 'secure-store');
    fs.mkdirSync(secureStore, { recursive: true });
    fs.writeFileSync(
      path.join(testDirectory, 'config.enc'),
      Buffer.from(JSON.stringify({ database: { mode: 'postgres' } })).toString('base64'),
    );
    fs.writeFileSync(path.join(secureStore, 'telegram.enc'), encrypt('{"token":"x"}', key));

    expect(validateCredentialKey(key, { userDataPath: testDirectory }).status).toBe('match');
    expect(validateCredentialKey(wrongKey, { userDataPath: testDirectory }).status).toBe('mismatch');
  });

  it('does not hide a configured missing database behind matching auxiliary data', () => {
    const key = '9'.repeat(64);
    const secureStore = path.join(testDirectory, 'secure-store');
    const missingDatabase = path.join(testDirectory, 'missing.sqlite');
    fs.mkdirSync(secureStore, { recursive: true });
    fs.writeFileSync(
      path.join(testDirectory, 'config.enc'),
      encryptConfig({ database: { mode: 'sqlite', path: missingDatabase } }, key),
    );
    fs.writeFileSync(path.join(secureStore, 'chatbot-secrets.enc'), encrypt('{"apiKey":"x"}', key));

    expect(validateCredentialKey(key, { userDataPath: testDirectory }).status).toBe('missing');
  });
});
