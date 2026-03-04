import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const originalFlag = process.env.ALLOW_DB_MIGRATE;

function loadMigrationsModule() {
  const modulePath = require.resolve('../migrations/run.js');
  delete require.cache[modulePath];
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require('../migrations/run.js');
}

afterEach(() => {
  if (typeof originalFlag === 'undefined') {
    delete process.env.ALLOW_DB_MIGRATE;
  } else {
    process.env.ALLOW_DB_MIGRATE = originalFlag;
  }
  vi.restoreAllMocks();
});

describe('migrations service commonjs exports', () => {
  it('exposes helper exports and flag toggles', () => {
    const migrationsModule = loadMigrationsModule();

    expect(migrationsModule.MIGRATION_ENV_FLAG).toBe('ALLOW_DB_MIGRATE');
    expect(migrationsModule.default).toBe(migrationsModule);

    migrationsModule.__setMigrationEnabledForTests(true);
    expect(migrationsModule.isMigrationEnabled()).toBe(true);

    migrationsModule.__setMigrationEnabledForTests(false);
    expect(migrationsModule.isMigrationEnabled()).toBe(false);
  });

  it('returns 403 when migration flag is disabled', async () => {
    const migrationsModule = loadMigrationsModule();
    migrationsModule.__setMigrationEnabledForTests(false);

    await expect(migrationsModule.runInvestmentsMigration()).rejects.toMatchObject({
      status: 403,
      hint: expect.stringContaining('ALLOW_DB_MIGRATE=true'),
    });
  });

  it('checks migration candidates and returns 404 when file is missing', async () => {
    const migrationsModule = loadMigrationsModule();
    migrationsModule.__setMigrationEnabledForTests(true);
    const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await expect(migrationsModule.runInvestmentsMigration()).rejects.toMatchObject({
      status: 404,
      details: expect.stringContaining('migration_investments.sql'),
    });

    expect(existsSyncSpy).toHaveBeenCalledTimes(2);
  });
});
