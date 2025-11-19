import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createRequire } from 'module';

const requireModule = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../../..');
const electronRoot = path.join(repoRoot, 'electron');

const coreRoutesPath = path.join(electronRoot, 'api-routes', 'core.js');
const databaseModulePath = path.join(electronRoot, 'database.js');
const healthModulePath = path.join(repoRoot, 'app', 'server', 'services', 'health.js');
const transactionsMetricsModulePath = path.join(
  repoRoot,
  'app',
  'server',
  'services',
  'transactions',
  'metrics.js',
);

const ModuleLoader = requireModule('module');

const dbManagerMock = {
  testConnection: vi.fn(),
  query: vi.fn(),
  getStats: vi.fn(),
  isConnected: true,
};

const healthServiceMock = {
  ping: vi.fn(),
};

const transactionsMetricsMock = {
  listCategories: vi.fn(),
};

function loadCoreRoutes() {
  const originalLoad = ModuleLoader._load;
  const electronMock = {
    app: {
      getPath: vi.fn(() => '/tmp/electron-test-user'),
    },
  };

  ModuleLoader._load = function patched(request: string, parent: any, isMain: boolean) {
    if (request === 'electron') {
      return electronMock;
    }

    let resolved: string | null = null;
    try {
      resolved = requireModule.resolve(request, parent);
    } catch {
      // ignore resolution errors and fall back to original loader
    }

    if (resolved === databaseModulePath) {
      return { dbManager: dbManagerMock };
    }
    if (resolved === healthModulePath) {
      return healthServiceMock;
    }
    if (resolved === transactionsMetricsModulePath) {
      return transactionsMetricsMock;
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    return requireModule(coreRoutesPath);
  } finally {
    ModuleLoader._load = originalLoad;
  }
}

const coreRoutes = loadCoreRoutes();

function createMockRes() {
  const payload: { statusCode: number; body: any } = {
    statusCode: 200,
    body: null,
  };

  return {
    status(code: number) {
      payload.statusCode = code;
      return this;
    },
    json(body: any) {
      payload.body = body;
      return this;
    },
    get result() {
      return payload;
    },
  };
}

describe('electron core routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok status from ping when dependencies are healthy', async () => {
    healthServiceMock.ping.mockResolvedValue({ ok: true, status: 'ok' });
    dbManagerMock.testConnection.mockResolvedValue({ success: true });

    const res = createMockRes();
    await coreRoutes.ping({} as any, res as any);

    expect(healthServiceMock.ping).toHaveBeenCalledTimes(1);
    expect(dbManagerMock.testConnection).toHaveBeenCalledTimes(1);
    expect(res.result.statusCode).toBe(200);
    expect(res.result.body).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('ShekelSync'),
      database: 'connected',
    });
  });

  it('propagates errors when the health check fails', async () => {
    healthServiceMock.ping.mockResolvedValue({
      ok: false,
      status: 'degraded',
      error: 'db failed',
    });

    const res = createMockRes();
    await coreRoutes.ping({} as any, res as any);

    expect(res.result.statusCode).toBe(500);
    expect(res.result.body).toEqual({
      status: 'degraded',
      message: 'Database connectivity check failed',
      error: 'db failed',
    });
    expect(dbManagerMock.testConnection).not.toHaveBeenCalled();
  });

  it('normalizes numeric strings returned in transaction stats', async () => {
    dbManagerMock.query.mockResolvedValue({
      rows: [
        {
          total_transactions: '3',
          unique_vendors: '2',
          unique_categories: '2',
          earliest_transaction: '2024-01-01',
          latest_transaction: '2024-02-01',
          total_income: '100.50',
          total_expenses: '40.25',
        },
      ],
    });

    const res = createMockRes();
    await coreRoutes.getTransactionStats({} as any, res as any);

    expect(res.result.statusCode).toBe(200);
    expect(res.result.body.success).toBe(true);
    expect(res.result.body.stats).toMatchObject({
      total_transactions: '3',
      unique_vendors: 2,
      unique_categories: 2,
      total_income: 100.5,
      total_expenses: 40.25,
    });
  });

  it('invokes the metrics service when listing categories', async () => {
    const fakeCategories = [{ id: 1, name: 'Housing' }];
    transactionsMetricsMock.listCategories.mockResolvedValue(fakeCategories);

    const res = createMockRes();
    await coreRoutes.getCategories({} as any, res as any);

    expect(transactionsMetricsMock.listCategories).toHaveBeenCalledTimes(1);
    expect(res.result.body).toEqual(fakeCategories);
  });

  it('combines stats and connection test results in getDatabaseInfo', async () => {
    const stats = { poolSize: 5 };
    const testResult = { success: true };
    dbManagerMock.getStats.mockResolvedValue(stats);
    dbManagerMock.testConnection.mockResolvedValue(testResult);

    const res = createMockRes();
    await coreRoutes.getDatabaseInfo({} as any, res as any);

    expect(dbManagerMock.getStats).toHaveBeenCalledTimes(1);
    expect(dbManagerMock.testConnection).toHaveBeenCalledTimes(1);
    expect(res.result.body).toEqual({
      success: true,
      connection: {
        isConnected: true,
        stats,
        testResult,
      },
    });
  });
});
