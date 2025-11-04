import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunScrape = vi.fn();
const mockBulkScrape = vi.fn();
const mockListScrapeEvents = vi.fn();
const mockGetScrapeStatusById = vi.fn();

vi.mock('israeli-bank-scrapers', () => ({
  CompanyTypes: {
    isracard: 'isracard',
    visaCal: 'visaCal',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createScrapingRouter } = require('../../routes/scraping.js');

function buildApp() {
  const mockWindow = {
    webContents: {
      send: vi.fn(),
    },
  };

  const services = {
    runScrape: mockRunScrape,
    bulkScrape: mockBulkScrape,
    listScrapeEvents: mockListScrapeEvents,
    getScrapeStatusById: mockGetScrapeStatusById,
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createScrapingRouter({ mainWindow: mockWindow, services }));
  return { app, mockWindow };
}

describe('Shared /api/scrape routes', () => {
  let app: express.Express;
  let mockWindow: ReturnType<typeof buildApp>['mockWindow'];

  beforeEach(() => {
    const setup = buildApp();
    app = setup.app;
    mockWindow = setup.mockWindow;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockRunScrape.mockReset();
    mockBulkScrape.mockReset();
    mockListScrapeEvents.mockReset();
    mockGetScrapeStatusById.mockReset();
  });

  it('triggers a single scrape job and streams updates', async () => {
    const scrapeResult = { success: true, accounts: [] };
    mockRunScrape.mockResolvedValue(scrapeResult);

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
  });

  it('returns scrape history events', async () => {
    const events = [{ id: 1 }];
    mockListScrapeEvents.mockResolvedValue(events);

    const response = await request(app).get('/api/scrape_events?limit=5').expect(200);

    expect(response.body).toEqual({ success: true, events });
    expect(mockListScrapeEvents).toHaveBeenCalledWith({ limit: '5' });
  });

  it('handles bulk scrape failures gracefully', async () => {
    mockBulkScrape.mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/api/scrape/bulk').send({}).expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/failed/i);
  });

  it('returns scrape status for an event', async () => {
    const event = { id: 42, vendor: 'isracard' };
    mockGetScrapeStatusById.mockResolvedValue(event);

    const res = await request(app).get('/api/scrape/status/42').expect(200);

    expect(res.body).toEqual({ success: true, event });
    expect(mockGetScrapeStatusById).toHaveBeenCalledWith('42');
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
});
