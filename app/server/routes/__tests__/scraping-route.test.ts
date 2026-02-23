import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunScrape = vi.fn();
const mockBulkScrape = vi.fn();
const mockListScrapeEvents = vi.fn();
const mockGetScrapeStatusById = vi.fn();
const mockWasScrapedRecently = vi.fn();

vi.mock('israeli-bank-scrapers', () => ({
  CompanyTypes: {
    isracard: 'isracard',
    visaCal: 'visaCal',
  },
}));

vi.mock('../../services/scraping/run.js', () => {
  const runScrape = vi.fn();
  const wasScrapedRecently = vi.fn();

  return {
    runScrape,
    wasScrapedRecently,
    __setDatabaseForTests: vi.fn(),
    __resetDatabaseForTests: vi.fn(),
    default: {
      runScrape,
      wasScrapedRecently,
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createScrapingRouter } = require('../../routes/scraping.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const credentialsService = require('../../services/credentials.js');

function buildApp({
  onProgress,
  webContentsSend,
}: { onProgress?: (payload: unknown) => void; webContentsSend?: (...args: unknown[]) => void } = {}) {
  const mockWindow = {
    webContents: {
      send: webContentsSend || vi.fn(),
    },
  };

  const services = {
    runScrape: mockRunScrape,
    bulkScrape: mockBulkScrape,
    listScrapeEvents: mockListScrapeEvents,
    getScrapeStatusById: mockGetScrapeStatusById,
    wasScrapedRecently: mockWasScrapedRecently,
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createScrapingRouter({ mainWindow: mockWindow, onProgress, services }));
  return { app, mockWindow };
}

describe('Shared /api/scrape routes', () => {
  let app: express.Express;
  let mockWindow: ReturnType<typeof buildApp>['mockWindow'];

  beforeEach(() => {
    const setup = buildApp();
    app = setup.app;
    mockWindow = setup.mockWindow;
    vi.spyOn(credentialsService, 'listCredentials').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockRunScrape.mockReset();
    mockBulkScrape.mockReset();
    mockListScrapeEvents.mockReset();
    mockGetScrapeStatusById.mockReset();
    mockWasScrapedRecently.mockReset();
  });

  it('triggers a single scrape job and streams updates', async () => {
    const scrapeResult = { success: true, accounts: [] };
    mockRunScrape.mockResolvedValue(scrapeResult);
    mockWasScrapedRecently.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard', startDate: new Date().toISOString() },
        credentials: { id: '123', password: 'secret' },
      })
      .expect(200);

    expect(response.body.transactionCount).toBe(0);
    expect(mockRunScrape).toHaveBeenCalledTimes(1);
    expect(mockWindow.webContents.send).toHaveBeenCalled();
  }, 10000);

  it('looks up dbId using stored username and checks rate limit', async () => {
    mockRunScrape.mockResolvedValue({ success: true, accounts: [] });
    mockWasScrapedRecently.mockResolvedValue(false);
    credentialsService.listCredentials.mockResolvedValue([
      { id: 11, username: 'demo@example.com' },
      { id: 22, username: 'match@example.com' },
    ]);

    await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard' },
        credentials: { username: 'MATCH@example.com', password: 'secret' },
      })
      .expect(200);

    expect(credentialsService.listCredentials).toHaveBeenCalledWith({ vendor: 'isracard' });
    expect(mockWasScrapedRecently).toHaveBeenCalledWith(22);
    expect(mockRunScrape.mock.calls[0][0].credentials.dbId).toBe(22);
  });

  it('falls back to only stored credential when no match by nickname/username/id', async () => {
    mockRunScrape.mockResolvedValue({ success: true, accounts: [] });
    mockWasScrapedRecently.mockResolvedValue(false);
    credentialsService.listCredentials.mockResolvedValue([{ id: 77, username: 'someone@example.com' }]);

    await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard' },
        credentials: { username: 'different@example.com', password: 'secret' },
      })
      .expect(200);

    expect(mockRunScrape.mock.calls[0][0].credentials.dbId).toBe(77);
  });

  it('continues without dbId when credential lookup fails', async () => {
    mockRunScrape.mockResolvedValue({ success: true, accounts: [] });
    credentialsService.listCredentials.mockRejectedValue(new Error('lookup failed'));

    await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard' },
        credentials: { username: 'user@example.com', password: 'secret' },
      })
      .expect(200);

    expect(mockRunScrape.mock.calls[0][0].credentials.dbId).toBeNull();
    expect(mockWasScrapedRecently).not.toHaveBeenCalled();
  });

  it('returns 409 when syncing a saved account that no longer exists', async () => {
    credentialsService.listCredentials.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard' },
        credentials: { username: 'user@example.com', password: 'secret', fromSavedCredential: true },
      })
      .expect(409);

    expect(res.body.reason).toBe('credential_not_found');
    expect(mockRunScrape).not.toHaveBeenCalled();
  });

  it('returns 429 when account is rate-limited and force is not enabled', async () => {
    mockWasScrapedRecently.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard' },
        credentials: { dbId: 55, password: 'secret' },
      })
      .expect(429);

    expect(res.body.rateLimited).toBe(true);
    expect(res.body.reason).toBe('account_recently_scraped');
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(
      mockWindow.webContents.send.mock.calls.some(
        (call: unknown[]) => call[1]?.status === 'failed' && call[1]?.vendor === 'isracard',
      ),
    ).toBe(true);
    expect(mockRunScrape).not.toHaveBeenCalled();
  });

  it('bypasses rate-limit checks when force override is enabled', async () => {
    mockRunScrape.mockResolvedValue({ success: true, accounts: [] });

    await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard', force: true },
        credentials: { dbId: 55, password: 'secret' },
      })
      .expect(200);

    expect(mockWasScrapedRecently).not.toHaveBeenCalled();
    expect(mockRunScrape).toHaveBeenCalledTimes(1);
  });

  it('returns success:false payload when runScrape throws', async () => {
    mockRunScrape.mockRejectedValue({
      message: 'scraper failed',
      errorType: 'AUTH_ERROR',
      payload: { reason: 'bad credentials' },
    });

    const res = await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard' },
        credentials: { dbId: 55, password: 'secret' },
      })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.errorType).toBe('AUTH_ERROR');
    expect(res.body.error).toEqual({ reason: 'bad credentials' });
    expect(
      mockWindow.webContents.send.mock.calls.some(
        (call: unknown[]) => call[1]?.status === 'failed' && call[1]?.vendor === 'isracard',
      ),
    ).toBe(true);
  });

  it('returns scrape history events', async () => {
    const events = [{ id: 1 }];
    mockListScrapeEvents.mockResolvedValue(events);

    const response = await request(app).get('/api/scrape_events?limit=5').expect(200);

    expect(response.body).toEqual({ success: true, events });
    expect(mockListScrapeEvents).toHaveBeenCalledWith({ limit: '5' });
  }, 10000);

  it('returns 500 when scrape history fetch fails', async () => {
    mockListScrapeEvents.mockRejectedValue(new Error('db unavailable'));
    const response = await request(app).get('/api/scrape_events').expect(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/failed to fetch scrape events/i);
  });

  it('returns 400 when required scrape fields are missing', async () => {
    const res = await request(app).post('/api/scrape').send({}).expect(400);

    expect(res.body.success).toBe(false);
    expect(mockRunScrape).not.toHaveBeenCalled();
  });

  it('accepts missing startDate and preserves provided dbId', async () => {
    mockRunScrape.mockResolvedValue({ success: true, accounts: [] });
    mockWasScrapedRecently.mockResolvedValue(false);

    await request(app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard' },
        credentials: { id: '123', password: 'secret', dbId: 777 },
      })
      .expect(200);

    expect(mockRunScrape).toHaveBeenCalledTimes(1);
    expect(mockRunScrape.mock.calls[0][0].credentials.dbId).toBe(777);
  }, 10000);

  it('handles bulk scrape failures gracefully', async () => {
    mockBulkScrape.mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/api/scrape/bulk').send({}).expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/failed/i);
  });

  it('streams bulk progress and returns bulk summary payload', async () => {
    mockBulkScrape.mockImplementation(async (options: any) => {
      options.onAccountStart({ account: { vendor: 'isracard' }, index: 0, total: 1 });
      options.onAccountComplete({
        account: { vendor: 'isracard' },
        index: 0,
        total: 1,
        result: { success: true, message: 'done', transactionCount: 3 },
      });
      return {
        success: true,
        message: 'Bulk complete',
        successCount: 1,
        failureCount: 0,
        totalTransactions: 3,
      };
    });

    const res = await request(app).post('/api/scrape/bulk').send({}).expect(200);
    expect(res.body.message).toBe('Bulk complete');
    expect(mockWindow.webContents.send).toHaveBeenCalled();
  });

  it('returns scrape status for an event', async () => {
    const event = { id: 42, vendor: 'isracard' };
    mockGetScrapeStatusById.mockResolvedValue(event);

    const res = await request(app).get('/api/scrape/status/42').expect(200);

    expect(res.body).toEqual({ success: true, event });
    expect(mockGetScrapeStatusById).toHaveBeenCalledWith('42');
  });

  it('returns service status code when scrape status lookup fails', async () => {
    mockGetScrapeStatusById.mockRejectedValue({ status: 404, message: 'Not found' });
    const res = await request(app).get('/api/scrape/status/404').expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Not found');
  });

  it('returns 500 when scrape status lookup fails without status', async () => {
    mockGetScrapeStatusById.mockRejectedValue(new Error('status error'));
    const res = await request(app).get('/api/scrape/status/42').expect(500);
    expect(res.body.success).toBe(false);
  });

  it('validates scraper configuration via /scrape/test', async () => {
    const res = await request(app)
      .post('/api/scrape/test')
      .send({ companyId: 'isracard' })
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('rejects unknown company IDs during /scrape/test', async () => {
    const res = await request(app)
      .post('/api/scrape/test')
      .send({ companyId: 'unknown' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid company id/i);
  });

  it('rejects empty /scrape/test requests', async () => {
    const res = await request(app).post('/api/scrape/test').send({}).expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/company id is required/i);
  });

  it('keeps scrape flow running when renderer progress emit throws', async () => {
    const onProgress = vi.fn();
    const setup = buildApp({
      onProgress,
      webContentsSend: () => {
        throw new Error('renderer unavailable');
      },
    });

    mockRunScrape.mockResolvedValue({
      success: true,
      accounts: [{ txns: [{}, {}] }],
    });
    mockWasScrapedRecently.mockResolvedValue(false);

    const res = await request(setup.app)
      .post('/api/scrape')
      .send({
        options: { companyId: 'isracard' },
        credentials: { dbId: 10, password: 'secret' },
      })
      .expect(200);

    expect(res.body.transactionCount).toBe(2);
    expect(onProgress).toHaveBeenCalled();
  });
});
