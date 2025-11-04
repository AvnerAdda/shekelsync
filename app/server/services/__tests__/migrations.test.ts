import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

const migrationsModulePromise = import('../migrations/run.js');

let migrationsService: any;

const existsSyncSpy = vi.spyOn(fs, 'existsSync');
const readFileSyncSpy = vi.spyOn(fs, 'readFileSync');

const queryMock = vi.fn();
const releaseMock = vi.fn();
const mockClient = { query: queryMock, release: releaseMock };
const getClientMock = vi.fn(async () => mockClient);
const originalFlag = process.env.ALLOW_DB_MIGRATE;

beforeAll(async () => {
  migrationsService = (await migrationsModulePromise).default;
});

describe('migrations service', () => {
  beforeEach(() => {
    migrationsService.__setMigrationEnabledForTests(true);
    migrationsService.__setDatabaseForTests({ getClient: getClientMock });
  });

  afterEach(() => {
    migrationsService.__setDatabaseForTests();
    existsSyncSpy.mockReset();
    readFileSyncSpy.mockReset();
    queryMock.mockReset();
    releaseMock.mockReset();
    getClientMock.mockClear();
    migrationsService.__setMigrationEnabledForTests(false);
  });

  afterAll(() => {
    if (typeof originalFlag === 'undefined') {
      delete process.env.ALLOW_DB_MIGRATE;
    } else {
      process.env.ALLOW_DB_MIGRATE = originalFlag;
    }
  });

  it('runs the investments migration successfully', async () => {
    existsSyncSpy.mockImplementation((file) => String(file).endsWith('migration_investments.sql'));
    readFileSyncSpy.mockReturnValueOnce('SELECT 1;');
    queryMock.mockResolvedValue({});

    const result = await migrationsService.runInvestmentsMigration();

    expect(existsSyncSpy).toHaveBeenCalled();
    expect(readFileSyncSpy).toHaveBeenCalled();
    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(queryMock).toHaveBeenCalledWith('SELECT 1;');
    expect(queryMock).toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/completed successfully/i);
  });

  it('throws a 403 when migrations are disabled via flag', async () => {
    migrationsService.__setMigrationEnabledForTests(false);

    await expect(migrationsService.runInvestmentsMigration()).rejects.toMatchObject({
      status: 403,
    });

    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('rolls back and surfaces structured errors on failure', async () => {
    existsSyncSpy.mockImplementation((file) => String(file).endsWith('migration_investments.sql'));
    readFileSyncSpy.mockReturnValueOnce('CREATE TABLE investments ();');
    queryMock.mockImplementation(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') {
        return {};
      }
      if (sql === 'COMMIT') {
        return {};
      }
      throw new Error('duplicate column name');
    });

    await expect(migrationsService.runInvestmentsMigration()).rejects.toMatchObject({
      status: 500,
      hint: expect.stringContaining('Tables may already exist'),
    });

    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith('BEGIN');
    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
