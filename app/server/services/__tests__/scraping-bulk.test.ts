import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const bulkScrapeModulePromise = import('../scraping/bulk.js');

let bulkScrapeService: any;

describe('bulk scrape service', () => {
  const queryMock = vi.fn();
  const releaseMock = vi.fn();
  const getClientMock = vi.fn();
  const runScrapeMock = vi.fn();

  beforeAll(async () => {
    bulkScrapeService = (await bulkScrapeModulePromise).default;
  });

  afterEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    getClientMock.mockReset();
    runScrapeMock.mockReset();
    bulkScrapeService.__setDatabaseForTests();
    bulkScrapeService.__setScrapingServiceForTests();
  });

  it('queries staleness per-credential and lets runScrape resolve startDate', async () => {
    const mockClient = { query: queryMock, release: releaseMock };
    getClientMock.mockResolvedValue(mockClient);

    let capturedSql: string | null = null;

    queryMock.mockImplementation(async (sql: string) => {
      capturedSql = sql;
      return {
        rows: [
          {
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
          },
        ],
      };
    });

    runScrapeMock.mockResolvedValue({ success: true, accounts: [] });

    bulkScrapeService.__setDatabaseForTests({ getClient: getClientMock });
    bulkScrapeService.__setScrapingServiceForTests({ runScrape: runScrapeMock });

    await bulkScrapeService.bulkScrape({ thresholdMs: 0, logger: null });

    expect(capturedSql).toContain('GROUP BY credential_id');
    expect(capturedSql).toContain('vc.id = last_scrapes.credential_id');

    expect(runScrapeMock).toHaveBeenCalledTimes(1);
    const call = runScrapeMock.mock.calls[0][0];
    expect(call.options.companyId).toBe('max');
    expect(call.options.startDate).toBeUndefined();
  });
});

