import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromApp = createRequire(path.resolve(__dirname, '../../app/package.json'));
const BetterSqlite = requireFromApp('better-sqlite3');
const restoreModule = await import('../sqlite-restore.js');
const { buildPreRestoreBackupPath, replaceDatabaseFile, validateRestoreSource } = restoreModule.default || restoreModule;

const currentKey = crypto.randomBytes(32).toString('hex');
const otherKey = crypto.randomBytes(32).toString('hex');

function encrypt(value, keyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
}

let workDir;

function createDatabase(fileName, { credentialKey = null, withTransactions = true } = {}) {
  const filePath = path.join(workDir, fileName);
  const db = new BetterSqlite(filePath);
  if (withTransactions) {
    db.exec('CREATE TABLE transactions (identifier TEXT, vendor TEXT, price REAL)');
    db.prepare('INSERT INTO transactions VALUES (?, ?, ?)').run(fileName, 'max', -10);
  }
  db.exec('CREATE TABLE vendor_credentials (username TEXT, password TEXT, id_number TEXT, identification_code TEXT)');
  if (credentialKey) {
    db.prepare('INSERT INTO vendor_credentials (username, password) VALUES (?, ?)')
      .run(encrypt('user', credentialKey), encrypt('secret', credentialKey));
  }
  db.close();
  return filePath;
}

function readTransactionIds(filePath) {
  const db = new BetterSqlite(filePath, { readonly: true });
  try {
    return db.prepare('SELECT identifier FROM transactions').all().map((row) => row.identifier);
  } finally {
    db.close();
  }
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-restore-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('validateRestoreSource', () => {
  it('accepts a database whose credentials decrypt with the current key', () => {
    const source = createDatabase('backup.sqlite', { credentialKey: currentKey });
    expect(validateRestoreSource(source, { masterKey: currentKey, databaseCtor: BetterSqlite }))
      .toEqual({ ok: true, credentialStatus: 'match' });
  });

  it('accepts a database without stored credentials', () => {
    const source = createDatabase('backup.sqlite');
    expect(validateRestoreSource(source, { masterKey: currentKey, databaseCtor: BetterSqlite }))
      .toEqual({ ok: true, credentialStatus: 'empty' });
  });

  it('rejects a backup encrypted with a different key', () => {
    const source = createDatabase('backup.sqlite', { credentialKey: otherKey });
    const result = validateRestoreSource(source, { masterKey: currentKey, databaseCtor: BetterSqlite });
    expect(result.ok).toBe(false);
    expect(result.credentialStatus).toBe('mismatch');
  });

  it('rejects files that are not ShekelSync databases', () => {
    const wrongSchema = createDatabase('other.sqlite', { withTransactions: false });
    expect(validateRestoreSource(wrongSchema, { masterKey: currentKey, databaseCtor: BetterSqlite }).ok).toBe(false);

    const notSqlite = path.join(workDir, 'notes.txt');
    fs.writeFileSync(notSqlite, 'definitely not a database');
    expect(validateRestoreSource(notSqlite, { masterKey: currentKey, databaseCtor: BetterSqlite }).ok).toBe(false);
  });
});

describe('replaceDatabaseFile', () => {
  it('swaps the database in place and removes stale WAL files', async () => {
    const target = createDatabase('live.sqlite');
    const source = createDatabase('backup.sqlite');
    fs.writeFileSync(`${target}-wal`, 'stale');
    const closeDatabase = vi.fn();
    const reopenDatabase = vi.fn();

    await replaceDatabaseFile(source, target, { closeDatabase, reopenDatabase });

    expect(readTransactionIds(target)).toEqual(['backup.sqlite']);
    expect(fs.existsSync(`${target}-wal`)).toBe(false);
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(reopenDatabase).toHaveBeenCalledOnce();
    expect(fs.readdirSync(workDir).some((name) => name.includes('.restore-'))).toBe(false);
  });

  it('leaves the live database untouched when the copy fails', async () => {
    const target = createDatabase('live.sqlite');
    const reopenDatabase = vi.fn();

    await expect(replaceDatabaseFile(path.join(workDir, 'missing.sqlite'), target, {
      closeDatabase: vi.fn(),
      reopenDatabase,
    })).rejects.toThrow();

    expect(readTransactionIds(target)).toEqual(['live.sqlite']);
  });

  it('builds the pre-restore backup path next to the database', () => {
    const backupPath = buildPreRestoreBackupPath('/data/shekelsync.sqlite', new Date('2026-10-25T12:00:00.000Z'));
    expect(backupPath).toBe(path.join('/data', 'backups', 'pre-restore-2026-10-25T12-00-00-000Z.sqlite'));
  });
});
