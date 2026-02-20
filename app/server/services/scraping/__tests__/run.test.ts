import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Module from 'module';

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const {
  queryMock,
  getClientMock,
  createScraperMock,
  scrapeQueueLengthMock,
  runExclusiveMock,
  getLastTransactionDateMock,
  syncBankBalanceToInvestmentsMock,
  forwardFillForCredentialMock,
  getCreditCardRepaymentCategoryIdMock,
  resolveCategoryMock,
  findCategoryByNameMock,
  getCategoryInfoMock,
  getInstitutionByIdMock,
  mapInstitutionToVendorCodeMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getClientMock: vi.fn(),
  createScraperMock: vi.fn(),
  scrapeQueueLengthMock: vi.fn(() => 0),
  runExclusiveMock: vi.fn((fn: () => Promise<any>) => fn()),
  getLastTransactionDateMock: vi.fn(),
  syncBankBalanceToInvestmentsMock: vi.fn(),
  forwardFillForCredentialMock: vi.fn(),
  getCreditCardRepaymentCategoryIdMock: vi.fn(),
  resolveCategoryMock: vi.fn(),
  findCategoryByNameMock: vi.fn(),
  getCategoryInfoMock: vi.fn(),
  getInstitutionByIdMock: vi.fn(),
  mapInstitutionToVendorCodeMock: vi.fn(),
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
    discount: 'discount',
    mercantile: 'mercantile',
    yahav: 'yahav',
    beyahadBishvilha: 'beyahadBishvilha',
    behatsdaa: 'behatsdaa',
    oneZero: 'oneZero',
    amex: 'amex',
    visaCal: 'visaCal',
  },
  createScraper: createScraperMock,
  default: {
    CompanyTypes: {
      hapoalim: 'hapoalim',
      leumi: 'leumi',
      isracard: 'isracard',
      max: 'max',
      discount: 'discount',
      mercantile: 'mercantile',
      yahav: 'yahav',
      beyahadBishvilha: 'beyahadBishvilha',
      behatsdaa: 'behatsdaa',
      oneZero: 'oneZero',
      amex: 'amex',
      visaCal: 'visaCal',
    },
    createScraper: createScraperMock,
  },
}));

// Mock mutex
vi.mock('../../../../lib/mutex.js', () => ({
  default: class MockMutex {
    getQueueLength() {
      return scrapeQueueLengthMock();
    }

    runExclusive(fn: () => Promise<any>) {
      return runExclusiveMock(fn);
    }
  }
}));

// Mock constants
vi.mock('../../../../utils/constants.js', () => ({
  BANK_VENDORS: ['hapoalim', 'leumi'],
  SPECIAL_BANK_VENDORS: [],
  OTHER_BANK_VENDORS: [],
  SCRAPE_RATE_LIMIT_MS: 24 * 60 * 60 * 1000,
  SCRAPE_RATE_LIMIT_MAX_ATTEMPTS: 2,
}));

// Mock category helpers
vi.mock('../../../../lib/category-helpers.js', () => ({
  resolveCategory: resolveCategoryMock,
  findCategoryByName: findCategoryByNameMock,
  getCategoryInfo: getCategoryInfoMock,
}));

// Mock category constants
vi.mock('../../../../lib/category-constants.js', () => ({
  BANK_CATEGORY_NAME: 'Bank Fees',
}));

// Mock institutions
vi.mock('../../institutions.js', () => ({
  getInstitutionById: getInstitutionByIdMock,
  mapInstitutionToVendorCode: mapInstitutionToVendorCodeMock,
}));

// Mock balance-sync
vi.mock('../../investments/balance-sync.js', () => ({
  syncBankBalanceToInvestments: syncBankBalanceToInvestmentsMock,
  forwardFillForCredential: forwardFillForCredentialMock,
}));

vi.mock('../../accounts/repayment-category.js', () => ({
  getCreditCardRepaymentCategoryId: getCreditCardRepaymentCategoryIdMock,
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
  scrapeQueueLengthMock.mockReset();
  scrapeQueueLengthMock.mockReturnValue(0);
  runExclusiveMock.mockReset();
  runExclusiveMock.mockImplementation((fn: () => Promise<any>) => fn());
  getLastTransactionDateMock.mockReset();
  syncBankBalanceToInvestmentsMock.mockReset();
  forwardFillForCredentialMock.mockReset();
  getCreditCardRepaymentCategoryIdMock.mockReset();
  resolveCategoryMock.mockReset();
  findCategoryByNameMock.mockReset();
  getCategoryInfoMock.mockReset();
  getInstitutionByIdMock.mockReset();
  mapInstitutionToVendorCodeMock.mockReset();
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
  const buildLogger = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });

  beforeEach(() => {
    getClientMock.mockResolvedValue(mockClient);
    mockClient.query.mockReset();
    mockClient.release.mockReset();
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
    syncBankBalanceToInvestmentsMock.mockResolvedValue({
      success: true,
      skipped: false,
      filledDates: 0,
    });
    forwardFillForCredentialMock.mockResolvedValue({
      accountsUpdated: 1,
      datesForwardFilled: 1,
    });
    getCreditCardRepaymentCategoryIdMock.mockResolvedValue(55);
    resolveCategoryMock.mockResolvedValue(null);
    findCategoryByNameMock.mockResolvedValue({
      id: 33,
      category_definition_id: 33,
      category_type: 'expense',
      name: 'Bank Fees',
    });
    getCategoryInfoMock.mockResolvedValue({
      id: 1,
      name: 'General Expense',
      category_type: 'expense',
    });
    getInstitutionByIdMock.mockResolvedValue(null);
    mapInstitutionToVendorCodeMock.mockResolvedValue(null);
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

    it('returns a 400 error for unknown company IDs', async () => {
      await expect(
        runService.runScrape({
          options: { companyId: 'does-not-exist' },
          credentials: { username: 'demo', password: 'secret' },
          logger: buildLogger(),
        } as any),
      ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid company ID' });
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

    it('treats no-transactions scraper errors with accounts as successful balance updates', async () => {
      const logger = buildLogger();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('SELECT id FROM vendor_credentials') && normalizedSql.includes('bank_account_number')) {
          return { rows: [{ id: 7 }], rowCount: 1 };
        }
        if (normalizedSql.includes('SELECT institution_id FROM vendor_credentials')) {
          return { rows: [{ institution_id: 11 }], rowCount: 1 };
        }
        if (normalizedSql.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass' },
        execute: async () => ({
          success: false,
          errorMessage: 'No transactions for selected date range',
          accounts: [
            { accountNumber: '123456', balance: '₪1,234.56', txns: [] },
          ],
        }),
        logger,
      } as any);

      expect(result.success).toBe(true);
      expect(result.noNewTransactions).toBe(true);
      expect(result.message).toContain('No new transactions found');
    });

    it('forward-fills portfolio history when no transactions and no accounts are returned', async () => {
      const logger = buildLogger();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass' },
        execute: async () => ({
          success: false,
          errorMessage: 'no results',
          accounts: [],
        }),
        logger,
      } as any);

      expect(result.success).toBe(true);
      expect(result.accounts).toEqual([]);
      expect(result.message).toContain('portfolio history updated');
    });

    it('rolls back and marks scrape as failed when scraper returns a hard failure', async () => {
      const logger = buildLogger();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('ROLLBACK')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await expect(
        runService.runScrape({
          options: { companyId: 'hapoalim' },
          credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass' },
          execute: async () => ({
            success: false,
            errorType: 'AuthFailed',
            errorMessage: 'bad credentials',
            accounts: [],
          }),
          logger,
        } as any),
      ).rejects.toMatchObject({ statusCode: 400, errorType: 'AuthFailed' });

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE scrape_events'),
        expect.arrayContaining(['failed']),
      );
    });

    it('completes a successful non-simulated scrape and commits transaction updates', async () => {
      const logger = buildLogger();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('FROM categorization_rules')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('FROM account_pairings')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass' },
        execute: async () => ({ success: true, accounts: [] }),
        logger,
      } as any);

      expect(result.success).toBe(true);
      expect(result.bankTransactions).toBe(0);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE scrape_events'),
        expect.arrayContaining(['success']),
      );
    });

    it('continues successfully when scrape_events start insert fails', async () => {
      const logger = buildLogger();
      queryMock.mockRejectedValueOnce(new Error('insert down'));

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('FROM categorization_rules')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('FROM account_pairings')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass' },
        execute: async () => ({ success: true, accounts: [] }),
        logger,
      } as any);

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write scrape_events start record: insert down'),
      );
    });

    it('logs queue wait message when multiple scrape jobs are queued', async () => {
      const waitingLogger = buildLogger();
      let releaseFirst: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('FROM categorization_rules')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('FROM account_pairings')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const first = runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass' },
        execute: async () => {
          await firstGate;
          return { success: true, accounts: [] };
        },
        logger: buildLogger(),
      } as any);

      // Queue one request behind the lock holder.
      const second = runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass' },
        execute: async () => ({ success: true, accounts: [] }),
        logger: buildLogger(),
      } as any);

      // Third request should observe queue length > 0 and emit waiting log.
      const third = runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass' },
        execute: async () => ({ success: true, accounts: [] }),
        logger: waitingLogger,
      } as any);

      releaseFirst!();
      await Promise.all([first, second, third]);

      expect(
        waitingLogger.info.mock.calls.some(([message]) =>
          String(message).includes('Waiting for'),
        ),
      ).toBe(true);
    });

    it('does not update credential status on successful scrape when dbId is missing', async () => {
      const logger = buildLogger();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('FROM categorization_rules')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('FROM account_pairings')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { username: 'bank-user', password: 'bank-pass' },
        execute: async () => ({ success: true, accounts: [] }),
        logger,
      } as any);

      expect(result.success).toBe(true);
      expect(
        mockClient.query.mock.calls.some(([sql]) =>
          String(sql).includes('last_scrape_status'),
        ),
      ).toBe(false);
    });

    it('builds fallback failure details and skips failed status update when dbId is missing', async () => {
      const logger = buildLogger();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('ROLLBACK')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      });

      await expect(
        runService.runScrape({
          options: { companyId: 'hapoalim' },
          credentials: { username: 'bank-user', password: 'bank-pass' },
          execute: async () => {
            throw new Error('executor exploded');
          },
          logger,
        } as any),
      ).rejects.toThrow('executor exploded');

      const failedAuditUpdateCall = queryMock.mock.calls.find(
        ([sql, params]) =>
          String(sql).includes('UPDATE scrape_events') &&
          Array.isArray(params) &&
          params[0] === 'failed',
      );
      expect(failedAuditUpdateCall).toBeTruthy();
      expect(String(failedAuditUpdateCall?.[1]?.[1])).toContain('executor exploded');
      expect(
        mockClient.query.mock.calls.some(([sql]) =>
          String(sql).includes('last_scrape_status'),
        ),
      ).toBe(false);
    });

    it('warns and continues when forward-fill fails for no-account no-transaction responses', async () => {
      const logger = buildLogger();
      forwardFillForCredentialMock.mockRejectedValueOnce(new Error('ff failed'));

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalizedSql = String(sql);
        if (normalizedSql.includes('FROM investment_accounts')) {
          throw new Error('ff failed');
        }
        if (normalizedSql.includes('BEGIN') || normalizedSql.includes('COMMIT')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalizedSql.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await runService.runScrape({
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, username: 'bank-user', password: 'bank-pass', vendor: 'hapoalim' },
        execute: async () => ({
          success: false,
          errorMessage: 'no results',
          accounts: [],
        }),
        logger,
      } as any);

      expect(result.success).toBe(true);
      expect(result.noNewTransactions).toBe(true);
      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes('Forward-fill failed (non-critical): ff failed'),
        ),
      ).toBe(true);
    });

  });

  describe('_internal helpers', () => {
    it('covers demo simulation and audit label utilities', () => {
      const internal = (runService as any)._internal;

      expect(internal.hasNonEmptyString(' value ')).toBe(true);
      expect(internal.hasNonEmptyString('   ')).toBe(false);
      expect(internal.resolvePrimaryAccountNumber({ bankAccountNumber: ' 111 ; 222 ' })).toBe('111');
      expect(internal.resolvePrimaryAccountNumber({ card6Digits: ' 9999 ' })).toBe('9999');
      expect(internal.resolvePrimaryAccountNumber({})).toBe(null);

      process.env.SQLITE_DB_PATH = '/tmp/clarify-anonymized.sqlite';
      expect(internal.isAnonymizedSqliteDatabase()).toBe(true);
      expect(internal.shouldSimulateDemoSync({}, { password: '' })).toBe(true);
      expect(internal.shouldSimulateDemoSync({ forceRealScrape: true }, { password: '' })).toBe(false);

      process.env.DEMO_SIMULATE_SYNC = 'false';
      expect(internal.shouldSimulateDemoSync({}, { password: '' })).toBe(false);
      process.env.DEMO_SIMULATE_SYNC = 'true';
      expect(internal.shouldSimulateDemoSync({}, { password: 'secret' })).toBe(true);
      delete process.env.DEMO_SIMULATE_SYNC;

      const bankSim = internal.buildSimulatedDemoResult({ companyId: 'hapoalim' }, { accountNumber: '123' }, true);
      const cardSim = internal.buildSimulatedDemoResult({ companyId: 'max' }, { card6Digits: '7777' }, false);
      expect(bankSim.success).toBe(true);
      expect(bankSim.accounts[0].txns).toHaveLength(1);
      expect(bankSim.accounts[0].txns[0].chargedAmount).toBeLessThan(0);
      expect(cardSim.accounts[0].txns[0].chargedAmount).toBeGreaterThan(0);

      expect(internal.isBankVendor('hapoalim')).toBe(true);
      expect(internal.isBankVendor('isracard')).toBe(false);
      expect(internal.getCredentialAuditLabel({ dbId: 77 })).toBe('credential:77');
      expect(internal.getCredentialAuditLabel({ nickname: 'Nick Name' })).toMatch(/^credential:anon-/);
      expect(internal.resolveTriggeredBy({ username: 'test@example.com' })).toMatch(/^credential:anon-/);
    });

    it('handles resolveStartDate explicit values and service fallback', async () => {
      const internal = (runService as any)._internal;
      const future = new Date();
      future.setDate(future.getDate() + 5);

      const clamped = await internal.resolveStartDate(
        { companyId: 'hapoalim', startDate: future.toISOString() },
        { nickname: 'demo' },
      );
      expect(clamped.reason).toContain('clamped to today');
      expect(clamped.date.getTime()).toBeLessThanOrEqual(Date.now());

      const explicit = await internal.resolveStartDate(
        { companyId: 'hapoalim', startDate: '2025-01-01T00:00:00.000Z' },
        { nickname: 'demo' },
      );
      expect(explicit.reason).toBe('User-provided date');
      expect(explicit.date.toISOString()).toContain('2025-01-01');

      const fromService = await internal.resolveStartDate(
        { companyId: 'hapoalim' },
        { nickname: 'demo' },
      );
      expect(fromService.date).toBeInstanceOf(Date);
      expect(typeof fromService.reason).toBe('string');

      getLastTransactionDateMock.mockRejectedValueOnce(new Error('lookup failed'));
      const fallback = await internal.resolveStartDate({ companyId: 'hapoalim', startDate: 'invalid-date' }, { nickname: 'demo' });
      expect(fallback.reason).toContain('Fallback');
      expect(fallback.hasTransactions).toBe(false);
    });

    it('builds scraper options and vendor-specific credentials', async () => {
      const internal = (runService as any)._internal;
      const start = new Date('2026-01-01T00:00:00.000Z');

      const maxOpts = internal.buildScraperOptions({ companyId: 'max' }, false, '/bin/chrome', start);
      expect(maxOpts.companyId).toBe('max');
      expect(maxOpts.showBrowser).toBe(true);
      expect(maxOpts.timeout).toBe(300000);
      expect(maxOpts.defaultTimeout).toBe(300000);
      expect(maxOpts.executablePath).toBe('/bin/chrome');
      expect(typeof maxOpts.preparePage).toBe('function');

      const leumiOpts = internal.buildScraperOptions({ companyId: 'leumi', showBrowser: false }, true, undefined, start);
      expect(leumiOpts.showBrowser).toBe(false);
      expect(leumiOpts.timeout).toBe(120000);
      expect(leumiOpts.defaultTimeout).toBe(120000);

      const userPreparePage = vi.fn().mockResolvedValue(undefined);
      const visaCalOpts = internal.buildScraperOptions(
        { companyId: 'visaCal', preparePage: userPreparePage },
        false,
        undefined,
        start,
      );
      expect(visaCalOpts.timeout).toBe(300000);
      expect(visaCalOpts.defaultTimeout).toBe(300000);
      const fakePage = {
        setDefaultTimeout: vi.fn(),
        setDefaultNavigationTimeout: vi.fn(),
      };
      await visaCalOpts.preparePage(fakePage);
      expect(fakePage.setDefaultTimeout).toHaveBeenCalledWith(300000);
      expect(fakePage.setDefaultNavigationTimeout).toHaveBeenCalledWith(300000);
      expect(userPreparePage).toHaveBeenCalledWith(fakePage);

      expect(
        internal.prepareScraperCredentials('visaCal', { companyId: 'max' }, { username: 'u', password: 'p' }),
      ).toEqual({ username: 'u', password: 'p' });
      expect(
        internal.prepareScraperCredentials('discount', { companyId: 'discount' }, { id: 'id', password: 'p', identification_code: '99' }),
      ).toEqual({ id: 'id', password: 'p', num: '99' });
      expect(
        internal.prepareScraperCredentials('yahav', { companyId: 'yahav' }, { username: 'u', password: 'p', id: '123' }),
      ).toEqual({ username: 'u', password: 'p', nationalID: '123' });

      const oneZeroCredentials = internal.prepareScraperCredentials(
        'oneZero',
        { companyId: 'oneZero' },
        { email: 'a@b.com', password: 'p', otpCode: '777777', otpToken: 'token' },
      );
      expect(oneZeroCredentials.email).toBe('a@b.com');
      expect(oneZeroCredentials.otpLongTermToken).toBe('token');
      expect(typeof oneZeroCredentials.otpCodeRetriever).toBe('function');
      await expect(oneZeroCredentials.otpCodeRetriever()).resolves.toBe('777777');

      expect(
        internal.prepareScraperCredentials('amex', { companyId: 'amex' }, { id: 'amex-user', card6Digits: '123456', password: 'p' }),
      ).toEqual({ username: 'amex-user', card6Digits: '123456', password: 'p' });
      expect(
        internal.prepareScraperCredentials('other', { companyId: 'hapoalim' }, { username: 'u', password: 'p', bankAccountNumber: '1' }),
      ).toEqual({ username: 'u', password: 'p', bankAccountNumber: '1' });
      expect(
        internal.prepareScraperCredentials(
          'other',
          { companyId: 'isracard' },
          { id: 'id', card6Digits: '123456', password: 'p' },
        ),
      ).toEqual({ id: 'id', card6Digits: '123456', password: 'p' });
    });

    it('formats failure messages and string/number normalization', () => {
      const internal = (runService as any)._internal;
      expect(internal.normalizeBalance('₪1,234.50')).toBe(1234.5);
      expect(internal.normalizeBalance(' - ')).toBe(null);
      expect(internal.normalizeBalance(55)).toBe(55);
      expect(internal.normalizeComparableText('  Hello   WORLD ')).toBe('hello world');
      expect(internal.getNameMatchScore('Netflix Ltd', 'netflix')).toBeGreaterThan(0);
      expect(internal.getNameMatchScore('Rent', 'Groceries')).toBe(0);
      expect(internal.getAbsHoursDiff('bad-date', '2026-01-01')).toBe(Number.POSITIVE_INFINITY);

      const failure = internal.buildScrapeFailureMessage({
        vendor: 'hapoalim',
        errorType: 'AuthFailed',
        errorMessage: 'Bad creds',
        statusCode: 401,
        details: { attempts: 2 },
      });
      expect(failure).toContain('AuthFailed: Bad creds');
      expect(failure).toContain('"vendor":"hapoalim"');
      expect(internal.truncateMessage('a'.repeat(15), 10)).toBe('aaaaaaa...');
    });

    it('covers helper fallbacks for empty values and type coercion', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();

      expect(internal.pickRandom([], 'fallback')).toBe('fallback');
      expect(internal.pickRandom('not-an-array', 'fallback')).toBe('fallback');

      expect(internal.getCredentialAuditLabel(null)).toBe('credential:unknown');
      expect(internal.getCredentialAuditLabel({})).toBe('credential:unknown');

      expect(internal.normalizeBalance(undefined)).toBeNull();
      expect(internal.normalizeBalance(true)).toBe(1);
      expect(internal.normalizeBalance({})).toBeNull();

      expect(internal.truncateMessage(undefined)).toBeUndefined();
      expect(internal.getNameMatchScore('', 'merchant')).toBe(0);
      expect(internal.getNameMatchScore('net', 'netflix')).toBe(2);
      expect(internal.getNameMatchScore('merchant market', 'market')).toBe(1);

      const executablePath = await internal.getPuppeteerExecutable(logger);
      if (typeof executablePath === 'undefined') {
        expect(logger.warn).toHaveBeenCalled();
      } else {
        expect(typeof executablePath).toBe('string');
      }
    });

    it('falls back when puppeteer executable resolution throws', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();
      const originalRequire = Module.prototype.require;
      const requireSpy = vi.spyOn(Module.prototype, 'require').mockImplementation(function (id: string) {
        if (id === 'puppeteer') {
          throw new Error('puppeteer missing');
        }
        return originalRequire.apply(this, arguments as any);
      });

      try {
        const executablePath = await internal.getPuppeteerExecutable(logger);
        expect(executablePath).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(
          'Could not resolve Puppeteer Chrome executable, falling back to default',
        );
      } finally {
        requireSpy.mockRestore();
      }
    });

    it('finds duplicates and picks the best candidate by score then time distance', async () => {
      const internal = (runService as any)._internal;
      const queryClient = { query: vi.fn() };

      await expect(
        internal.findPotentialDuplicateTransactions(queryClient, {
          vendor: 'max',
          accountNumber: '1234',
          price: -100,
          transactionDatetimeIso: 'not-a-date',
        }),
      ).resolves.toEqual([]);
      expect(queryClient.query).not.toHaveBeenCalled();

      queryClient.query.mockResolvedValueOnce({
        rows: [
          { identifier: 'a', vendor: 'max', name: 'Netflix', status: 'pending', transaction_datetime: '2026-01-01T11:00:00.000Z' },
          { identifier: 'b', vendor: 'max', name: 'Netfl', status: 'pending', transaction_datetime: '2026-01-01T09:00:00.000Z' },
        ],
      });

      const candidates = await internal.findPotentialDuplicateTransactions(queryClient, {
        vendor: 'max',
        accountNumber: '1234',
        price: -100,
        transactionDatetimeIso: '2026-01-01T10:00:00.000Z',
      });
      expect(candidates).toHaveLength(2);
      const best = internal.pickBestDuplicateCandidate(candidates, {
        name: 'Netflix',
        transactionDatetimeIso: '2026-01-01T10:15:00.000Z',
        status: 'pending',
      });
      expect(best.identifier).toBe('a');

      const none = internal.pickBestDuplicateCandidate(candidates, {
        name: 'Completely Different',
        transactionDatetimeIso: '2026-01-01T10:15:00.000Z',
        status: 'pending',
      });
      expect(none).toBeNull();
    });

    it('updates vendor account numbers only when account ids are discoverable', async () => {
      const internal = (runService as any)._internal;

      await internal.updateVendorAccountNumbers(mockClient, { companyId: 'max' }, {}, new Set(), false);
      expect(mockClient.query).not.toHaveBeenCalled();

      await internal.updateVendorAccountNumbers(
        mockClient,
        { companyId: 'max' },
        {},
        new Set(['111111']),
        false,
      );
      expect(mockClient.query).not.toHaveBeenCalled();

      await internal.updateVendorAccountNumbers(
        mockClient,
        { companyId: 'max' },
        { dbId: 7 },
        new Set(['111111', '222222']),
        false,
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SET card6_digits = $1'),
        ['111111;222222', 'max', 7],
      );
    });

    it('applies categorization rules and dynamic category resolution', async () => {
      const internal = (runService as any)._internal;

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('FROM categorization_rules')) {
          return {
            rows: [
              { id: 1, name_pattern: 'חשמל', target_category: 'Bills', category_definition_id: null, resolved_subcategory: null, resolved_parent_category: null, priority: 10 },
              { id: 2, name_pattern: 'WOLT', target_category: 'Food', category_definition_id: 5, resolved_subcategory: 'Food', resolved_parent_category: 'Food', priority: 5 },
            ],
            rowCount: 2,
          };
        }
        if (normalized.includes('UPDATE transactions')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await internal.applyCategorizationRules(mockClient);
      expect(result).toEqual({ rulesApplied: 2, transactionsUpdated: 2 });
    });

    it('applies account pairings including repayment category resolution and log insert', async () => {
      const internal = (runService as any)._internal;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(internal.applyAccountPairings(mockClient)).resolves.toEqual({
        pairingsApplied: 0,
        transactionsUpdated: 0,
      });

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('FROM account_pairings')) {
          return {
            rows: [
              {
                id: 1,
                credit_card_vendor: 'max',
                credit_card_account_number: '1234',
                bank_vendor: 'hapoalim',
                bank_account_number: '9999',
                match_patterns: JSON.stringify(['ישראכרט']),
              },
            ],
            rowCount: 1,
          };
        }
        if (normalized.includes('SELECT id FROM category_definitions')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      });
      await expect(internal.applyAccountPairings(mockClient)).resolves.toEqual({
        pairingsApplied: 0,
        transactionsUpdated: 0,
      });
      expect(warnSpy).toHaveBeenCalled();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('FROM account_pairings')) {
          return {
            rows: [
              {
                id: 2,
                credit_card_vendor: 'max',
                credit_card_account_number: '1234',
                bank_vendor: 'hapoalim',
                bank_account_number: '9999',
                match_patterns: JSON.stringify(['ישראכרט']),
              },
            ],
            rowCount: 1,
          };
        }
        if (normalized.includes('SELECT id FROM category_definitions')) {
          return { rows: [{ id: 77 }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE transactions')) {
          return { rows: [], rowCount: 2 };
        }
        if (normalized.includes('INSERT INTO account_pairing_log')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await internal.applyAccountPairings(mockClient);
      expect(result).toEqual({ pairingsApplied: 1, transactionsUpdated: 2 });
      warnSpy.mockRestore();
    });

    it('skips account pairings that have no match patterns', async () => {
      const internal = (runService as any)._internal;

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('FROM account_pairings')) {
          return {
            rows: [
              {
                id: 3,
                credit_card_vendor: 'max',
                credit_card_account_number: '1234',
                bank_vendor: 'hapoalim',
                bank_account_number: '9999',
                match_patterns: JSON.stringify([]),
              },
            ],
            rowCount: 1,
          };
        }
        if (normalized.includes('FROM category_definitions')) {
          return { rows: [{ id: 77 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await internal.applyAccountPairings(mockClient);
      expect(result).toEqual({ pairingsApplied: 1, transactionsUpdated: 0 });
      expect(
        mockClient.query.mock.calls.some(([sql]: any[]) => String(sql).includes('UPDATE transactions')),
      ).toBe(false);
    });

    it('handles updateVendorBalance for invalid balances and missing credentials', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();

      await internal.updateVendorBalance(
        mockClient,
        { companyId: 'hapoalim' },
        { dbId: 7, username: 'bank-user' },
        { accountNumber: '111111', balance: '₪ --' },
        logger,
      );
      expect(logger.debug).toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();

      mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await internal.updateVendorBalance(
        mockClient,
        { companyId: 'hapoalim' },
        { dbId: 7, username: 'bank-user' },
        { accountNumber: '111111', balance: '123.45' },
        logger,
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No credential record found for vendor hapoalim'));
    });

    it('updates vendor balance and tolerates downstream sync errors', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();
      syncBankBalanceToInvestmentsMock.mockRejectedValueOnce(new Error('sync failed'));

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('SELECT id FROM vendor_credentials') && normalized.includes('bank_account_number')) {
          return { rows: [{ id: 99 }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        if (normalized.includes('SELECT institution_id FROM vendor_credentials')) {
          return { rows: [{ institution_id: 11 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await internal.updateVendorBalance(
        mockClient,
        { companyId: 'hapoalim' },
        { dbId: 7, username: 'bank-user' },
        { accountNumber: '111111', balance: '₪2,100.5' },
        logger,
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE vendor_credentials'),
        [2100.5, 99],
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Balance updated successfully for credential ID 99'),
      );
    });

    it('warns when balance update resolves a credential but updates no rows', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('SELECT id FROM vendor_credentials') && normalized.includes('bank_account_number')) {
          return { rows: [{ id: 88 }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      });

      await internal.updateVendorBalance(
        mockClient,
        { companyId: 'max' },
        {},
        { accountNumber: '111111', balance: '100' },
        logger,
      );

      expect(
        logger.warn.mock.calls.some(([message]) =>
          String(message).includes('Balance update failed - no matching credential found'),
        ),
      ).toBe(true);
    });

    it('processes scrape results for empty and populated account lists', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();

      await expect(
        internal.processScrapeResult(mockClient, {
          options: { companyId: 'hapoalim' },
          credentials: { dbId: 7 },
          result: { success: true, accounts: [] },
          isBank: true,
          logger,
        }),
      ).resolves.toEqual({ bankTransactions: 0 });

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('WHERE vendor = $1 AND (bank_account_number = $2 OR card6_digits = $2)')) {
          return { rows: [{ id: 7 }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        if (normalized.includes('SELECT identifier')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('FROM category_definitions') && normalized.includes('LOWER(name)')) {
          return { rows: [{ id: 33, category_type: 'expense', parent_id: null, name: 'Bank Fees' }], rowCount: 1 };
        }
        if (normalized.includes('INSERT INTO transactions')) {
          return { rows: [], rowCount: 1 };
        }
        if (normalized.includes('SET bank_account_number = $1')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const result = await internal.processScrapeResult(mockClient, {
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, nickname: 'Bank Nick', institution_id: 11 },
        result: {
          success: true,
          accounts: [
            {
              accountNumber: '111111',
              balance: '4000',
              txns: [
                {
                  identifier: 'txn-1',
                  date: '2026-02-10T10:00:00.000Z',
                  processedDate: '2026-02-10T10:00:00.000Z',
                  description: 'Incoming transfer',
                  chargedAmount: -120,
                  originalAmount: -120,
                  originalCurrency: 'ILS',
                  chargedCurrency: 'ILS',
                  type: 'transfer',
                  status: 'completed',
                },
              ],
            },
          ],
        },
        isBank: true,
        logger,
      });

      expect(result.bankTransactions).toBe(1);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SET bank_account_number = $1'),
        ['111111', 'hapoalim', 7],
      );
    });

    it('handles pending/completed duplicate transitions without inserting duplicate rows', async () => {
      const internal = (runService as any)._internal;
      const baseTxn = {
        identifier: 'txn-dup',
        date: '2026-02-10T10:00:00.000Z',
        processedDate: '2026-02-10T10:00:00.000Z',
        description: 'NETFLIX',
        chargedAmount: 50,
        originalAmount: 50,
        originalCurrency: 'ILS',
        chargedCurrency: 'ILS',
        type: 'card',
      };

      mockClient.query.mockResolvedValueOnce({
        rows: [
          { identifier: 'done-1', vendor: 'max', name: 'Netflix', status: 'completed', transaction_datetime: '2026-02-10T10:20:00.000Z' },
        ],
      });
      await internal.insertTransaction({ ...baseTxn, status: 'pending' }, mockClient, 'max', false, '1234', 'Nick');
      expect(
        mockClient.query.mock.calls.some(([sql]: any[]) => String(sql).includes('INSERT INTO transactions')),
      ).toBe(false);

      mockClient.query.mockReset();
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { identifier: 'pending-1', vendor: 'max', name: 'Netflix', status: 'pending', transaction_datetime: '2026-02-10T09:50:00.000Z' },
        ],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await internal.insertTransaction({ ...baseTxn, status: 'completed' }, mockClient, 'max', false, '1234', 'Nick');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE transactions'),
        expect.arrayContaining(['pending-1', 'max']),
      );

      mockClient.query.mockReset();
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { identifier: 'pending-2', vendor: 'max', name: 'Netflix', status: 'pending', transaction_datetime: '2026-02-10T09:50:00.000Z' },
          { identifier: 'done-2', vendor: 'max', name: 'Netflix', status: 'completed', transaction_datetime: '2026-02-10T10:05:00.000Z' },
        ],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await internal.insertTransaction({ ...baseTxn, status: 'completed' }, mockClient, 'max', false, '1234', 'Nick');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM transactions'),
        ['pending-2', 'max'],
      );
    });

    it('inserts non-bank transactions with fallback expense category when uncategorized', async () => {
      const internal = (runService as any)._internal;
      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('FROM transactions')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('FROM category_mapping')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('FROM categorization_rules')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('FROM category_definitions') && normalized.includes('LOWER(name)')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('WHERE cd.id = $1')) {
          return {
            rows: [{ id: 1, name: 'General Expense', category_type: 'expense', parent_id: null, parent_name: null }],
            rowCount: 1,
          };
        }
        if (normalized.includes('INSERT INTO transactions')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await internal.insertTransaction(
        {
          identifier: 'txn-insert',
          date: '2026-02-11T09:00:00.000Z',
          processedDate: '2026-02-11T09:00:00.000Z',
          description: 'Unknown merchant',
          chargedAmount: 120,
          originalAmount: 120,
          originalCurrency: 'ILS',
          chargedCurrency: 'ILS',
          type: 'card',
          status: 'completed',
          category: 'Misc',
        },
        mockClient,
        'max',
        false,
        '1234',
        'Nick',
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining(['max', 'Nick', -120, 1, 'expense']),
      );
    });

    it('inserts non-bank transactions using resolved categorization metadata', async () => {
      const internal = (runService as any)._internal;
      resolveCategoryMock.mockResolvedValueOnce({
        categoryDefinitionId: 44,
        parentCategory: 'Utilities',
        subcategory: 'Electricity',
      });
      getCategoryInfoMock.mockResolvedValueOnce({
        id: 44,
        name: 'Electricity',
        category_type: 'expense',
      });

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('FROM transactions')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('INSERT INTO transactions')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await internal.insertTransaction(
        {
          identifier: 'txn-categorized',
          date: '2026-02-12T09:00:00.000Z',
          processedDate: '2026-02-12T09:00:00.000Z',
          description: 'Electric Company',
          chargedAmount: 150,
          originalAmount: 150,
          originalCurrency: 'ILS',
          chargedCurrency: 'ILS',
          type: 'card',
          status: 'completed',
          category: 'Utilities',
        },
        mockClient,
        'max',
        false,
        '1234',
        'Nick',
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining(['max', 'Nick', -150]),
      );
    });

    it('covers scrape event helpers, safe status updates, and bank category cache behavior', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();
      const bankClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
      const eventClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 123 }], rowCount: 1 }),
      };

      await expect(
        internal.insertScrapeEvent(eventClient, {
          triggeredBy: 'credential:7',
          vendor: 'hapoalim',
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          credentialId: 7,
        }),
      ).resolves.toBe(123);

      await internal.updateScrapeEventStatus(eventClient, 123, 'success', 'done');
      expect(eventClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE scrape_events'),
        ['success', 'done', 123],
      );
      await internal.updateScrapeEventStatus(eventClient, null, 'success', 'skip');

      queryMock.mockResolvedValueOnce({ rows: [{ id: 88 }], rowCount: 1 });
      await expect(
        internal.insertScrapeEvent(null, {
          triggeredBy: 'credential:8',
          vendor: 'max',
          startDate: new Date('2026-01-02T00:00:00.000Z'),
          credentialId: null,
        }),
      ).resolves.toBe(88);

      queryMock.mockRejectedValueOnce(new Error('write failed'));
      await internal.safeUpdateScrapeEventStatus(88, 'failed', 'oops', logger);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update scrape_events: write failed'),
      );
      await internal.safeUpdateScrapeEventStatus(null, 'success', 'noop', logger);

      await expect(internal.getBankCategoryDefinition(bankClient)).rejects.toThrow(
        /not found in category_definitions/,
      );

      const bankCategory = {
        id: 33,
        category_definition_id: 33,
        category_type: 'expense',
        name: 'Bank Fees',
      };
      bankClient.query.mockResolvedValueOnce({ rows: [bankCategory], rowCount: 1 });

      const first = await internal.getBankCategoryDefinition(bankClient);
      const second = await internal.getBankCategoryDefinition(bankClient);
      expect(first).toBe(bankCategory);
      expect(second).toBe(bankCategory);
      expect(bankClient.query).toHaveBeenCalledTimes(2);
    });

    it('covers additional credential-preparation and status-marking branches', async () => {
      const internal = (runService as any)._internal;

      expect(
        internal.prepareScraperCredentials(
          'hapoalim',
          { companyId: 'hapoalim' },
          { userCode: 'user-code', username: 'user-name', password: 'secret' },
        ),
      ).toEqual({ userCode: 'user-code', password: 'secret' });
      expect(
        internal.prepareScraperCredentials(
          'hapoalim',
          { companyId: 'hapoalim' },
          { username: 'user-name', password: 'secret' },
        ),
      ).toEqual({ userCode: 'user-name', password: 'secret' });

      expect(
        internal.prepareScraperCredentials(
          'mercantile',
          { companyId: 'mercantile' },
          { id: 'id-1', password: 'p', num: '42' },
        ),
      ).toEqual({ id: 'id-1', password: 'p', num: '42' });
      expect(
        internal.prepareScraperCredentials(
          'beyahadBishvilha',
          { companyId: 'beyahadBishvilha' },
          { id: 'abc', password: 'p' },
        ),
      ).toEqual({ id: 'abc', password: 'p' });
      expect(
        internal.prepareScraperCredentials(
          'behatsdaa',
          { companyId: 'behatsdaa' },
          { id: 'xyz', password: 'p' },
        ),
      ).toEqual({ id: 'xyz', password: 'p' });

      const oneZeroNoOtp = internal.prepareScraperCredentials(
        'oneZero',
        { companyId: 'oneZero' },
        { email: 'a@b.com', password: 'secret' },
      );
      expect(oneZeroNoOtp.otpCodeRetriever).toBeUndefined();
      expect(oneZeroNoOtp.otpLongTermToken).toBeNull();

      await internal.markCredentialScrapeStatus(mockClient, 7, 'success');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("last_scrape_status = 'success'"),
        [7],
      );

      mockClient.query.mockReset();
      await internal.markCredentialScrapeStatus(mockClient, 7, 'failed');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("last_scrape_status = 'failed'"),
        [7],
      );
    });

    it('updates non-bank balances through vendor fallback and skips investment sync', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('WHERE vendor = $1 AND (bank_account_number = $2 OR card6_digits = $2)')) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('WHERE vendor = $1') && normalized.includes('LIMIT 1')) {
          return { rows: [{ id: 21 }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE vendor_credentials')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await internal.updateVendorBalance(
        mockClient,
        { companyId: 'max' },
        { dbId: 21, username: 'card-user' },
        { accountNumber: '1234', balance: '₪500.00' },
        logger,
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE vendor_credentials'),
        [500, 21],
      );
      expect(syncBankBalanceToInvestmentsMock).not.toHaveBeenCalled();
    });

    it('continues processing when a single account balance update throws', async () => {
      const internal = (runService as any)._internal;
      const logger = buildLogger();

      mockClient.query.mockRejectedValueOnce(new Error('balance lookup failed'));

      const result = await internal.processScrapeResult(mockClient, {
        options: { companyId: 'hapoalim' },
        credentials: { dbId: 7, nickname: 'Bank Nick' },
        result: {
          success: true,
          accounts: [{ balance: '123.45', txns: [] }],
        },
        isBank: true,
        logger,
      });

      expect(result).toEqual({ bankTransactions: 0 });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update balance for undefined:'),
        'balance lookup failed',
      );
    });

    it('covers sync-failure catch and default createScraper execution via isolated module stubs', async () => {
      const originalRequire = Module.prototype.require;
      const localLogger = buildLogger();
      const createScraperStub = vi.fn(() => ({
        scrape: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
      }));
      const syncStub = vi.fn().mockRejectedValue(new Error('sync exploded'));
      const getLastTxnStub = vi.fn().mockResolvedValue({
        lastTransactionDate: '2026-02-07T00:00:00.000Z',
        message: 'Using latest transaction date',
        hasTransactions: true,
      });

      const localClient = {
        query: vi.fn(async (sql: string) => {
          const normalized = String(sql);
          if (normalized.includes('SELECT id FROM vendor_credentials') && normalized.includes('bank_account_number')) {
            return { rows: [{ id: 41 }], rowCount: 1 };
          }
          if (normalized.includes('SELECT institution_id FROM vendor_credentials')) {
            return { rows: [{ institution_id: 11 }], rowCount: 1 };
          }
          if (normalized.includes('SELECT id FROM vendor_credentials') && normalized.includes('LIMIT 1')) {
            return { rows: [{ id: 41 }], rowCount: 1 };
          }
          if (normalized.includes('UPDATE vendor_credentials')) {
            return { rows: [], rowCount: 1 };
          }
          if (normalized.includes('BEGIN') || normalized.includes('COMMIT') || normalized.includes('ROLLBACK')) {
            return { rows: [], rowCount: 0 };
          }
          if (normalized.includes('FROM categorization_rules')) {
            return { rows: [], rowCount: 0 };
          }
          if (normalized.includes('FROM account_pairings')) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        }),
        release: vi.fn(),
      };
      const localDb = {
        query: vi.fn(async (sql: string) => {
          if (String(sql).includes('RETURNING id')) {
            return { rows: [{ id: 321 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        }),
        getClient: vi.fn().mockResolvedValue(localClient),
      };

      const requireSpy = vi.spyOn(Module.prototype, 'require').mockImplementation(function (id: string) {
        if (id === '../database.js') {
          return localDb;
        }
        if (id === 'israeli-bank-scrapers') {
          return {
            CompanyTypes: {
              hapoalim: 'hapoalim',
            },
            createScraper: createScraperStub,
          };
        }
        if (id === '../investments/balance-sync.js') {
          return {
            syncBankBalanceToInvestments: syncStub,
            forwardFillForCredential: vi.fn().mockResolvedValue({
              accountsUpdated: 0,
              datesForwardFilled: 0,
            }),
          };
        }
        if (id === '../accounts/last-transaction-date.js') {
          return {
            getLastTransactionDate: getLastTxnStub,
          };
        }
        return originalRequire.apply(this, arguments as any);
      });

      try {
        vi.resetModules();
        const isolatedRunService = (await import('../run.js')).default as any;
        isolatedRunService.__setDatabaseForTests(localDb);

        await isolatedRunService._internal.updateVendorBalance(
          localClient,
          { companyId: 'hapoalim' },
          { dbId: 41, username: 'bank-user' },
          { accountNumber: '111111', balance: '₪1,000.5' },
          localLogger,
        );
        expect(localLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to sync balance to investment holdings:'),
          'sync exploded',
        );

        const result = await isolatedRunService._internal._runScrapeInternal({
          options: { companyId: 'hapoalim' },
          credentials: { dbId: 41, username: 'bank-user', password: 'secret' },
          logger: localLogger,
        });

        expect(createScraperStub).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
      } finally {
        requireSpy.mockRestore();
      }
    });

    it('covers resolved categorization assignments and successful/skip sync log branches via isolated stubs', async () => {
      const originalRequire = Module.prototype.require;
      const localLogger = buildLogger();
      const syncStub = vi
        .fn()
        .mockResolvedValueOnce({ success: true, skipped: true, reason: 'already up to date' })
        .mockResolvedValueOnce({ success: true, skipped: false, filledDates: 5 });
      const resolveCategoryStub = vi.fn().mockResolvedValue({
        categoryDefinitionId: 44,
        parentCategory: 'Utilities',
        subcategory: 'Electricity',
      });
      const getCategoryInfoStub = vi.fn().mockResolvedValue({
        id: 44,
        name: 'Electricity',
        category_type: 'expense',
      });

      const localClient = {
        query: vi.fn(async (sql: string) => {
          const normalized = String(sql);
          if (normalized.includes('SELECT id FROM vendor_credentials') && normalized.includes('bank_account_number')) {
            return { rows: [{ id: 55 }], rowCount: 1 };
          }
          if (normalized.includes('SELECT institution_id FROM vendor_credentials')) {
            return { rows: [{ institution_id: 11 }], rowCount: 1 };
          }
          if (normalized.includes('SELECT id FROM vendor_credentials') && normalized.includes('LIMIT 1')) {
            return { rows: [{ id: 55 }], rowCount: 1 };
          }
          if (normalized.includes('UPDATE vendor_credentials')) {
            return { rows: [], rowCount: 1 };
          }
          if (normalized.includes('FROM transactions')) {
            return { rows: [], rowCount: 0 };
          }
          if (normalized.includes('INSERT INTO transactions')) {
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
        release: vi.fn(),
      };
      const localDb = {
        query: vi.fn(async () => ({ rows: [], rowCount: 1 })),
        getClient: vi.fn().mockResolvedValue(localClient),
      };

      const requireSpy = vi.spyOn(Module.prototype, 'require').mockImplementation(function (id: string) {
        if (id === '../database.js') {
          return localDb;
        }
        if (id === '../../../lib/category-helpers.js') {
          return {
            resolveCategory: resolveCategoryStub,
            findCategoryByName: vi.fn().mockResolvedValue({
              id: 33,
              category_definition_id: 33,
              category_type: 'expense',
            }),
            getCategoryInfo: getCategoryInfoStub,
          };
        }
        if (id === '../investments/balance-sync.js') {
          return {
            syncBankBalanceToInvestments: syncStub,
            forwardFillForCredential: vi.fn().mockResolvedValue({
              accountsUpdated: 0,
              datesForwardFilled: 0,
            }),
          };
        }
        if (id === 'israeli-bank-scrapers') {
          return {
            CompanyTypes: {
              hapoalim: 'hapoalim',
            },
            createScraper: vi.fn(),
          };
        }
        return originalRequire.apply(this, arguments as any);
      });

      try {
        vi.resetModules();
        const isolatedRunService = (await import('../run.js')).default as any;
        isolatedRunService.__setDatabaseForTests(localDb);

        await isolatedRunService._internal.updateVendorBalance(
          localClient,
          { companyId: 'hapoalim' },
          { dbId: 55, username: 'bank-user' },
          { accountNumber: '111111', balance: '₪1,200' },
          localLogger,
        );
        await isolatedRunService._internal.updateVendorBalance(
          localClient,
          { companyId: 'hapoalim' },
          { dbId: 55, username: 'bank-user' },
          { accountNumber: '111111', balance: '₪1,400' },
          localLogger,
        );

        await isolatedRunService._internal.insertTransaction(
          {
            identifier: 'txn-categorized-stubbed',
            date: '2026-02-12T09:00:00.000Z',
            processedDate: '2026-02-12T09:00:00.000Z',
            description: 'Electric Company',
            chargedAmount: 150,
            originalAmount: 150,
            originalCurrency: 'ILS',
            chargedCurrency: 'ILS',
            type: 'card',
            status: 'completed',
            category: 'Utilities',
          },
          localClient,
          'max',
          false,
          '1234',
          'Nick',
        );

        expect(syncStub).toHaveBeenCalledTimes(2);
        expect(resolveCategoryStub).toHaveBeenCalled();
        expect(
          localLogger.info.mock.calls.some(([message]) =>
            String(message).includes('Balance sync skipped: already up to date'),
          ),
        ).toBe(true);
        expect(
          localLogger.info.mock.calls.some(([message]) =>
            String(message).includes('Balance synced to investments (filled 5 dates)'),
          ),
        ).toBe(true);
      } finally {
        requireSpy.mockRestore();
      }
    });
  });

  describe('wasScrapedRecently', () => {
    it('accepts nullish overrides and restores default database reference', async () => {
      const customDb = {
        query: vi.fn(),
        getClient: vi.fn(),
      };

      runService.__setDatabaseForTests(customDb as any);
      runService.__setDatabaseForTests(null as any);
      runService.__setDatabaseForTests();
      expect(customDb.getClient).not.toHaveBeenCalled();
    });

    it('returns false immediately when credential id is missing', async () => {
      await expect(runService.wasScrapedRecently(undefined as any)).resolves.toBe(false);
    });

    it('returns true only when attempts in the time window reach maxAttempts', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ attempt_count: 1 }],
      });

      await expect(runService.wasScrapedRecently(7, 60 * 60 * 1000, 2)).resolves.toBe(false);
      expect(mockClient.release).toHaveBeenCalledTimes(1);

      mockClient.query.mockResolvedValueOnce({
        rows: [{ attempt_count: 2 }],
      });

      await expect(runService.wasScrapedRecently(7, 60 * 60 * 1000, 2)).resolves.toBe(true);
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });

    it('falls back to default threshold and max attempts for invalid numeric inputs', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ attempt_count: '1' }],
      });

      await expect(
        runService.wasScrapedRecently(7, Number.NaN as any, -3 as any),
      ).resolves.toBe(false);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) AS attempt_count'),
        [7, expect.any(String)],
      );
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });
});
