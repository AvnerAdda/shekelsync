import { afterEach, describe, expect, it } from 'vitest';

const dbModulePath = require.resolve('../db.js');
const createDbPoolPath = require.resolve('../../lib/create-db-pool.js');

function loadDbModule(seedPool) {
  delete require.cache[dbModulePath];

  if (typeof seedPool === 'undefined') {
    delete globalThis.__TEST_DB_POOL__;
  } else {
    globalThis.__TEST_DB_POOL__ = seedPool;
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require('../db.js');
}

describe('utils/db', () => {
  afterEach(() => {
    delete globalThis.__TEST_DB_POOL__;
    delete require.cache[dbModulePath];
  });

  it('exports the seeded test pool when available', () => {
    const testPool = { name: 'seeded-pool' };

    const exportedPool = loadDbModule(testPool);

    expect(exportedPool).toBe(testPool);
    expect(typeof exportedPool.__setTestPool).toBe('function');
  });

  it('updates the global test pool via __setTestPool', () => {
    const initialPool = { name: 'initial' };
    const replacementPool = { name: 'replacement' };
    const exportedPool = loadDbModule(initialPool);

    exportedPool.__setTestPool(replacementPool);

    expect(globalThis.__TEST_DB_POOL__).toBe(replacementPool);
    const reloadedPool = loadDbModule(globalThis.__TEST_DB_POOL__);
    expect(reloadedPool).toBe(replacementPool);
  });

  it('creates a new pool when no seeded test pool exists', () => {
    const originalFactoryCache = require.cache[createDbPoolPath];
    const createdPool = { name: 'created-pool' };
    let factoryCalls = 0;

    require.cache[createDbPoolPath] = {
      id: createDbPoolPath,
      filename: createDbPoolPath,
      loaded: true,
      exports: () => {
        factoryCalls += 1;
        return createdPool;
      },
    };

    const exportedPool = loadDbModule(undefined);

    expect(exportedPool).toBe(createdPool);
    expect(factoryCalls).toBe(1);

    if (originalFactoryCache) {
      require.cache[createDbPoolPath] = originalFactoryCache;
    } else {
      delete require.cache[createDbPoolPath];
    }
  });
});
