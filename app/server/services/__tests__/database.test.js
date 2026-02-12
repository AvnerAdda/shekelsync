import Module from 'module';
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const DATABASE_MODULE_PATH = require.resolve('../database.js');
const CREATE_DB_POOL_MODULE_PATH = require.resolve('../../../lib/create-db-pool.js');

const originalCreateDbPoolModule = require.cache[CREATE_DB_POOL_MODULE_PATH];

function mockCreateDbPool(factory) {
  const moduleStub = new Module(CREATE_DB_POOL_MODULE_PATH);
  moduleStub.filename = CREATE_DB_POOL_MODULE_PATH;
  moduleStub.loaded = true;
  moduleStub.exports = factory;
  moduleStub.exports.default = factory;
  require.cache[CREATE_DB_POOL_MODULE_PATH] = moduleStub;
}

function loadDatabaseWithPoolFactory(factory) {
  mockCreateDbPool(factory);
  delete require.cache[DATABASE_MODULE_PATH];
  const loaded = require('../database.js');
  return loaded.default || loaded;
}

describe('database service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete require.cache[DATABASE_MODULE_PATH];
    if (originalCreateDbPoolModule) {
      require.cache[CREATE_DB_POOL_MODULE_PATH] = originalCreateDbPoolModule;
    } else {
      delete require.cache[CREATE_DB_POOL_MODULE_PATH];
    }
  });

  it('memoizes pool instance returned by create-db-pool', () => {
    const pool = { query: vi.fn() };
    const createDbPool = vi.fn(() => pool);

    const db = loadDatabaseWithPoolFactory(createDbPool);

    expect(db.getPool()).toBe(pool);
    expect(db.getPool()).toBe(pool);
    expect(createDbPool).toHaveBeenCalledTimes(1);
  });

  it('returns connected client when pool supports connect', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    const createDbPool = vi.fn(() => ({ connect: vi.fn().mockResolvedValue(client) }));

    const db = loadDatabaseWithPoolFactory(createDbPool);

    await expect(db.getClient()).resolves.toBe(client);
  });

  it('throws when pool does not expose connect', async () => {
    const createDbPool = vi.fn(() => ({ query: vi.fn() }));

    const db = loadDatabaseWithPoolFactory(createDbPool);

    await expect(db.getClient()).rejects.toThrow('Database pool does not expose a connect() method');
  });

  it('uses pool.query when available', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: true }] });
    const createDbPool = vi.fn(() => ({ query }));

    const db = loadDatabaseWithPoolFactory(createDbPool);

    const result = await db.query('SELECT 1', ['x']);

    expect(result.rows).toEqual([{ ok: true }]);
    expect(query).toHaveBeenCalledWith('SELECT 1', ['x']);
  });

  it('falls back to client.query and releases the client', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
      release: vi.fn(),
    };
    const createDbPool = vi.fn(() => ({ connect: vi.fn().mockResolvedValue(client) }));

    const db = loadDatabaseWithPoolFactory(createDbPool);

    const result = await db.query('SELECT 2');

    expect(result.rows).toEqual([{ id: 1 }]);
    expect(client.query).toHaveBeenCalledWith('SELECT 2', []);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('releases connected client even when client.query throws', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('boom')),
      release: vi.fn(),
    };
    const createDbPool = vi.fn(() => ({ connect: vi.fn().mockResolvedValue(client) }));

    const db = loadDatabaseWithPoolFactory(createDbPool);

    await expect(db.query('SELECT broken')).rejects.toThrow('boom');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('closes pool when close exists and resets singleton', async () => {
    const close = vi.fn();
    const firstPool = { query: vi.fn(), close };
    const secondPool = { query: vi.fn() };
    const createDbPool = vi
      .fn()
      .mockImplementationOnce(() => firstPool)
      .mockImplementationOnce(() => secondPool);

    const db = loadDatabaseWithPoolFactory(createDbPool);

    expect(db.getPool()).toBe(firstPool);
    await db.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(db.getPool()).toBe(secondPool);
    expect(createDbPool).toHaveBeenCalledTimes(2);
  });

  it('close is a no-op when pool was never initialized', async () => {
    const createDbPool = vi.fn(() => ({ query: vi.fn() }));

    const db = loadDatabaseWithPoolFactory(createDbPool);

    await expect(db.close()).resolves.toBeUndefined();
    expect(createDbPool).not.toHaveBeenCalled();
  });
});
