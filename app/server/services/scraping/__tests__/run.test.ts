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

beforeEach(async () => {
  vi.resetModules();
  queryMock.mockReset();
  getClientMock.mockReset();
  createScraperMock.mockReset();
  getLastTransactionDateMock.mockReset();
  runService = (await import('../run.js')).default;
});

afterEach(() => {
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
  });
});
