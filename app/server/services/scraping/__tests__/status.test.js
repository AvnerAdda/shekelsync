import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = require('../../database.js');
const statusService = require('../status.js');

describe('scraping status service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws 400 when id is missing', async () => {
    await expect(statusService.getScrapeStatusById()).rejects.toMatchObject({
      status: 400,
      message: 'Scrape event ID is required',
    });
  });

  it('throws 404 when scrape event is not found', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({ rows: [] });

    await expect(statusService.getScrapeStatusById(123)).rejects.toMatchObject({
      status: 404,
      message: 'Scrape event not found',
    });
  });

  it('returns scrape event row by id', async () => {
    const row = {
      id: 10,
      vendor: 'leumi',
      status: 'success',
      message: 'ok',
      created_at: '2026-02-01T00:00:00.000Z',
    };

    const querySpy = vi.spyOn(database, 'query').mockResolvedValue({ rows: [row] });

    await expect(statusService.getScrapeStatusById(10)).resolves.toEqual(row);
    expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('FROM scrape_events'), [10]);
  });
});
