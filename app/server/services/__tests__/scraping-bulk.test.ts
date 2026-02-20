import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const bulkScrapeModulePromise = import('../scraping/bulk.js');

let bulkScrapeService: any;

describe('bulk scrape service', () => {
  const queryMock = vi.fn();
  const releaseMock = vi.fn();
  const getClientMock = vi.fn();
  const runScrapeMock = vi.fn();
  const enterBulkModeMock = vi.fn();
  const exitBulkModeMock = vi.fn();
  const rebuildFtsIndexMock = vi.fn();
  const rebuildPairingExclusionsMock = vi.fn();
  const isBulkModeActiveMock = vi.fn();

  function makeAccount(overrides: Record<string, unknown> = {}) {
    return {
      id: 123,
      vendor: 'max',
      nickname: 'MAX Lois',
      username: null,
      password: null,
      id_number: null,
      card6_digits: null,
      bank_account_number: null,
      identification_code: null,
      institution_id: null,
      last_update: new Date().toISOString(),
      ...overrides,
    };
  }

  function configureService({
    staleAccounts = [],
    queryImpl,
    runScrapeImpl,
    pool,
  }: {
    staleAccounts?: any[];
    queryImpl?: (sql: string, params: unknown[]) => Promise<any>;
    runScrapeImpl?: (payload: any) => Promise<any>;
    pool?: Record<string, any>;
  } = {}) {
    const mockClient = { query: queryMock, release: releaseMock };
    getClientMock.mockResolvedValue(mockClient);

    if (queryImpl) {
      queryMock.mockImplementation(queryImpl);
    } else {
      queryMock.mockResolvedValue({ rows: staleAccounts, rowCount: staleAccounts.length });
    }

    if (runScrapeImpl) {
      runScrapeMock.mockImplementation(runScrapeImpl);
    } else {
      runScrapeMock.mockResolvedValue({ success: true, accounts: [] });
    }

    const defaultPool = {
      enterBulkMode: enterBulkModeMock,
      exitBulkMode: exitBulkModeMock,
      rebuildFtsIndex: rebuildFtsIndexMock,
      rebuildPairingExclusions: rebuildPairingExclusionsMock,
      isBulkModeActive: isBulkModeActiveMock,
    };

    bulkScrapeService.__setDatabaseForTests({
      getClient: getClientMock,
      _pool: pool || defaultPool,
    });
    bulkScrapeService.__setScrapingServiceForTests({ runScrape: runScrapeMock });

    return mockClient;
  }

  beforeAll(async () => {
    bulkScrapeService = (await bulkScrapeModulePromise).default;
  });

  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    getClientMock.mockReset();
    runScrapeMock.mockReset();
    enterBulkModeMock.mockReset();
    exitBulkModeMock.mockReset();
    rebuildFtsIndexMock.mockReset();
    rebuildPairingExclusionsMock.mockReset();
    isBulkModeActiveMock.mockReset();
    isBulkModeActiveMock.mockReturnValue(false);
  });

  afterEach(() => {
    bulkScrapeService.__setDatabaseForTests();
    bulkScrapeService.__setScrapingServiceForTests();
  });

  it('queries staleness per-credential and lets runScrape resolve startDate', async () => {
    let capturedSql: string | null = null;

    configureService({
      queryImpl: async (sql: string) => {
        capturedSql = sql;
        return { rows: [makeAccount()] };
      },
    });

    await bulkScrapeService.bulkScrape({ thresholdMs: 0, logger: null });

    expect(capturedSql).toContain('GROUP BY credential_id');
    expect(capturedSql).toContain('vc.id = last_scrapes.credential_id');
    expect(runScrapeMock).toHaveBeenCalledTimes(1);

    const call = runScrapeMock.mock.calls[0][0];
    expect(call.options.companyId).toBe('max');
    expect(call.options.startDate).toBeUndefined();
  });

  it('returns a zero-work summary when all accounts are already up to date', async () => {
    configureService({ staleAccounts: [] });

    const result = await bulkScrapeService.bulkScrape({ logger: null });

    expect(result).toEqual({
      success: true,
      message: 'All accounts are up to date',
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      totalTransactions: 0,
      results: [],
    });
    expect(runScrapeMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('decrypts credential envelopes and falls back to raw values on decrypt errors', async () => {
    const originalKey = process.env.SHEKELSYNC_ENCRYPTION_KEY;
    try {
      process.env.SHEKELSYNC_ENCRYPTION_KEY = '1'.repeat(64);
      const encryptionModule = await import('../../../lib/server/encryption.js');
      const encryption = (encryptionModule as any).default ?? encryptionModule;

      const encryptedUsername = encryption.encrypt('demo-user');
      const encryptedId = encryption.encrypt('987654321');

      configureService({
        staleAccounts: [
          makeAccount({
            username: encryptedUsername,
            password: 12345, // non-string bypasses decrypt
            id_number: encryptedId,
            card6_digits: '123456', // no colon bypasses decrypt
            identification_code: 'bad:blob', // decrypt throws, should fall back
            bank_account_number: '11112222',
            institution_id: 77,
          }),
        ],
        runScrapeImpl: async () => ({ success: true, accounts: [] }),
      });

      await bulkScrapeService.bulkScrape({ logger: null, showBrowser: false });

      const payload = runScrapeMock.mock.calls[0][0];
      expect(payload.options.showBrowser).toBe(false);
      expect(payload.credentials).toMatchObject({
        dbId: 123,
        id: '987654321',
        username: 'demo-user',
        userCode: 'demo-user',
        email: 'demo-user',
        password: 12345,
        card6Digits: '123456',
        bankAccountNumber: '11112222',
        identification_code: 'bad:blob',
        num: 'bad:blob',
        nationalID: 'bad:blob',
        otpToken: 'bad:blob',
        institution_id: 77,
        vendor: 'max',
      });
    } finally {
      if (typeof originalKey === 'undefined') {
        delete process.env.SHEKELSYNC_ENCRYPTION_KEY;
      } else {
        process.env.SHEKELSYNC_ENCRYPTION_KEY = originalKey;
      }
    }
  });

  it('aggregates success, scrape failures, and thrown errors while calling progress hooks', async () => {
    const onAccountStart = vi.fn();
    const onAccountComplete = vi.fn();
    const baseLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const vendorLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const createLogger = vi.fn(() => vendorLogger);

    configureService({
      staleAccounts: [
        makeAccount({ id: 1, vendor: 'max', nickname: 'MAX' }),
        makeAccount({ id: 2, vendor: 'isracard', nickname: 'ISR' }),
        makeAccount({ id: 3, vendor: 'hapoalim', nickname: 'HAP' }),
      ],
      runScrapeImpl: async ({ options }: any) => {
        if (options.companyId === 'max') {
          return {
            success: true,
            accounts: [{ txns: [{}, {}] }],
          };
        }
        if (options.companyId === 'isracard') {
          return {
            success: false,
            errorMessage: 'provider rejected',
            accounts: [{ txns: [{}] }],
          };
        }
        throw new Error('network down');
      },
    });

    const result = await bulkScrapeService.bulkScrape({
      logger: baseLogger,
      onAccountStart,
      onAccountComplete,
      createLogger,
      showBrowser: true,
    });

    expect(createLogger).toHaveBeenCalledTimes(3);
    expect(runScrapeMock).toHaveBeenCalledTimes(3);
    expect(runScrapeMock.mock.calls[0][0].logger).toBe(vendorLogger);
    expect(onAccountStart).toHaveBeenCalledTimes(3);
    expect(onAccountComplete).toHaveBeenCalledTimes(3);

    expect(result.success).toBe(true);
    expect(result.totalProcessed).toBe(3);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(2);
    expect(result.totalTransactions).toBe(3);
    expect(result.results[0]).toMatchObject({
      vendor: 'max',
      status: 'success',
      message: 'Scraped successfully',
      transactionCount: 2,
    });
    expect(result.results[1]).toMatchObject({
      vendor: 'isracard',
      status: 'failed',
      message: 'provider rejected',
      transactionCount: 1,
    });
    expect(result.results[2]).toMatchObject({
      vendor: 'hapoalim',
      status: 'failed',
      message: 'network down',
      transactionCount: 0,
    });
  });

  it('enters and exits bulk mode and rebuilds indexes on successful processing', async () => {
    configureService({
      staleAccounts: [makeAccount({ id: 7, vendor: 'discount' })],
      runScrapeImpl: async () => ({ success: true, accounts: [{ txns: [{}] }] }),
    });

    await bulkScrapeService.bulkScrape({ logger: null });

    expect(enterBulkModeMock).toHaveBeenCalledTimes(1);
    expect(exitBulkModeMock).toHaveBeenCalledTimes(1);
    expect(rebuildFtsIndexMock).toHaveBeenCalledTimes(1);
    expect(rebuildPairingExclusionsMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('forces bulk-mode cleanup in finally when a callback throws mid-run', async () => {
    isBulkModeActiveMock.mockReturnValue(true);

    configureService({
      staleAccounts: [makeAccount({ id: 91, vendor: 'leumi' })],
    });

    await expect(
      bulkScrapeService.bulkScrape({
        logger: null,
        onAccountStart: () => {
          throw new Error('hook failed');
        },
      }),
    ).rejects.toThrow('hook failed');

    expect(enterBulkModeMock).toHaveBeenCalledTimes(1);
    expect(exitBulkModeMock).toHaveBeenCalledTimes(1);
    expect(rebuildFtsIndexMock).toHaveBeenCalledTimes(1);
    expect(rebuildPairingExclusionsMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(runScrapeMock).not.toHaveBeenCalled();
  });
});
