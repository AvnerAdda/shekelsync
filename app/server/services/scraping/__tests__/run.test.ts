import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const { queryMock, getClientMock, createScraperMock, getLastTransactionDateMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getClientMock: vi.fn(),
  createScraperMock: vi.fn(),
  getLastTransactionDateMock: vi.fn(),
}));

// Mock database module
vi.mock('../../database.js', () => ({
  query: queryMock,
  getClient: getClientMock,
  default: {
    query: queryMock,
    getClient: getClientMock,
  },
}));

// Mock create-db-pool to prevent better-sqlite3 loading
vi.mock('../../../../lib/create-db-pool.js', () => ({
  default: vi.fn(),
}));

// Mock israeli-bank-scrapers
vi.mock('israeli-bank-scrapers', () => ({
  CompanyTypes: {
    hapoalim: 'hapoalim',
    leumi: 'leumi',
    isracard: 'isracard',
    max: 'max',
  },
  createScraper: createScraperMock,
  default: {
    CompanyTypes: {
      hapoalim: 'hapoalim',
      leumi: 'leumi',
      isracard: 'isracard',
      max: 'max',
    },
    createScraper: createScraperMock,
  },
}));

// Mock mutex
vi.mock('../../../../lib/mutex.js', () => ({
  default: class MockMutex {
    runExclusive(fn: () => Promise<any>) {
      return fn();
    }
  },
}));

// Mock constants
vi.mock('../../../../utils/constants.js', () => ({
  BANK_VENDORS: ['hapoalim', 'leumi'],
  SPECIAL_BANK_VENDORS: [],
  OTHER_BANK_VENDORS: [],
}));

// Mock category helpers
vi.mock('../../../../lib/category-helpers.js', () => ({
  resolveCategory: vi.fn(),
  findCategoryByName: vi.fn(),
  getCategoryInfo: vi.fn(),
}));

// Mock category constants
vi.mock('../../../../lib/category-constants.js', () => ({
  BANK_CATEGORY_NAME: 'Bank Fees',
}));

// Mock institutions
vi.mock('../../institutions.js', () => ({
  getInstitutionById: vi.fn(),
  mapInstitutionToVendorCode: vi.fn(),
}));

// Mock balance-sync
vi.mock('../../investments/balance-sync.js', () => ({
  syncBankBalanceToInvestments: vi.fn(),
  forwardFillForCredential: vi.fn(),
}));

// Mock last-transaction-date
vi.mock('../../accounts/last-transaction-date.js', () => ({
  getLastTransactionDate: getLastTransactionDateMock,
  default: {
    getLastTransactionDate: getLastTransactionDateMock,
  },
}));

let runService: typeof import('../run.js').default;
let originalSqliteDbPath: string | undefined;

beforeEach(async () => {
  originalSqliteDbPath = process.env.SQLITE_DB_PATH;
  vi.resetModules();
  queryMock.mockReset();
  getClientMock.mockReset();
  createScraperMock.mockReset();
  getLastTransactionDateMock.mockReset();
  runService = (await import('../run.js')).default;
  runService.__setDatabaseForTests?.({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  runService.__resetDatabaseForTests?.();
  if (typeof originalSqliteDbPath === 'undefined') {
    delete process.env.SQLITE_DB_PATH;
  } else {
    process.env.SQLITE_DB_PATH = originalSqliteDbPath;
  }
  vi.clearAllMocks();
});

describe('scraping run service', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    getClientMock.mockResolvedValue(mockClient);
    mockClient.query.mockReset();
    mockClient.release.mockReset();
  });

  describe('runScrape', () => {
    it('throws error for missing companyId', async () => {
      await expect(
        runService.runScrape({
          credentials: { username: 'test', password: 'test' },
        } as any)
      ).rejects.toThrow();
    });

    it('throws error for missing credentials', async () => {
      await expect(
        runService.runScrape({
          companyId: 'hapoalim',
        } as any)
      ).rejects.toThrow();
    });

    it('simulates sync for anonymized demo DB and inserts a latest transaction', async () => {
      process.env.SQLITE_DB_PATH = '/tmp/clarify-anonymized.sqlite';

      getLastTransactionDateMock.mockResolvedValue({
        lastTransactionDate: '2026-02-07T00:00:00.000Z',
        message: 'Using latest transaction date',
        hasTransactions: true,
      });

      queryMock.mockImplementation(async (sql: string) => {
        if (String(sql).includes('RETURNING id')) {
          return { rows: [{ id: 42 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      });

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('SELECT id FROM vendor_credentials')) {
          return { rows: [{ id: 7 }], rowCount: 1 };
        }
        if (normalizedSql.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await runService.runScrape({
        options: { companyId: 'max' },
        credentials: {
          dbId: 7,
          nickname: 'Max Demo',
          password: '',
          card6Digits: '1234',
        },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      } as any);

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(Array.isArray(result.accounts)).toBe(true);
      expect(result.accounts[0]?.txns?.length).toBe(1);
      expect(createScraperMock).not.toHaveBeenCalled();

      const insertedTxnCall = mockClient.query.mock.calls.find(([sql]) =>
        String(sql).includes('INSERT INTO transactions'),
      );
      expect(insertedTxnCall).toBeTruthy();
    });
  });
});
