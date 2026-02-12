import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const {
  queryMock,
  getClientMock,
  createScraperMock,
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
      return 0;
    }

    runExclusive(fn: () => Promise<any>) {
      return fn();
    }
  }
}));

// Mock constants
vi.mock('../../../../utils/constants.js', () => ({
  BANK_VENDORS: ['hapoalim', 'leumi'],
  SPECIAL_BANK_VENDORS: [],
  OTHER_BANK_VENDORS: [],
  SCRAPE_RATE_LIMIT_MS: 24 * 60 * 60 * 1000,
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

      getLastTransactionDateMock.mockRejectedValueOnce(new Error('lookup failed'));
      const fallback = await internal.resolveStartDate({ companyId: 'hapoalim', startDate: 'invalid-date' }, { nickname: 'demo' });
      expect(fallback.reason).toContain('Fallback');
      expect(fallback.hasTransactions).toBe(false);
    });

    it('builds scraper options and vendor-specific credentials', () => {
      const internal = (runService as any)._internal;
      const start = new Date('2026-01-01T00:00:00.000Z');

      const maxOpts = internal.buildScraperOptions({ companyId: 'max' }, false, '/bin/chrome', start);
      expect(maxOpts.companyId).toBe('max');
      expect(maxOpts.showBrowser).toBe(true);
      expect(maxOpts.timeout).toBe(300000);
      expect(maxOpts.executablePath).toBe('/bin/chrome');

      const leumiOpts = internal.buildScraperOptions({ companyId: 'leumi', showBrowser: false }, true, undefined, start);
      expect(leumiOpts.showBrowser).toBe(false);
      expect(leumiOpts.timeout).toBe(120000);

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

      expect(
        internal.prepareScraperCredentials('amex', { companyId: 'amex' }, { id: 'amex-user', card6Digits: '123456', password: 'p' }),
      ).toEqual({ username: 'amex-user', card6Digits: '123456', password: 'p' });
      expect(
        internal.prepareScraperCredentials('other', { companyId: 'hapoalim' }, { username: 'u', password: 'p', bankAccountNumber: '1' }),
      ).toEqual({ username: 'u', password: 'p', bankAccountNumber: '1' });
    });

    it('formats failure messages and string/number normalization', () => {
      const internal = (runService as any)._internal;
      expect(internal.normalizeBalance('₪1,234.50')).toBe(1234.5);
      expect(internal.normalizeBalance(' - ')).toBe(null);
      expect(internal.normalizeBalance(55)).toBe(55);
      expect(internal.normalizeComparableText('  Hello   WORLD ')).toBe('hello world');
      expect(internal.getNameMatchScore('Netflix Ltd', 'netflix')).toBeGreaterThan(0);
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
    });

    it('updates vendor account numbers only when account ids are discoverable', async () => {
      const internal = (runService as any)._internal;

      await internal.updateVendorAccountNumbers(mockClient, { companyId: 'max' }, {}, new Set(), false);
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
        if (normalized.includes('WHERE vendor = $1 AND (bank_account_number = $2 OR card6_digits = $2)')) {
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
  });

  describe('wasScrapedRecently', () => {
    it('returns false immediately when credential id is missing', async () => {
      await expect(runService.wasScrapedRecently(undefined as any)).resolves.toBe(false);
    });

    it('returns true only when the last attempt is within the threshold', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ last_scrape_attempt: new Date(Date.now() - 5 * 60 * 1000).toISOString() }],
      });

      await expect(runService.wasScrapedRecently(7, 60 * 60 * 1000)).resolves.toBe(true);
      expect(mockClient.release).toHaveBeenCalledTimes(1);

      mockClient.query.mockResolvedValueOnce({
        rows: [{ last_scrape_attempt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }],
      });

      await expect(runService.wasScrapedRecently(7, 60 * 60 * 1000)).resolves.toBe(false);
      expect(mockClient.release).toHaveBeenCalledTimes(2);
    });
  });
});
