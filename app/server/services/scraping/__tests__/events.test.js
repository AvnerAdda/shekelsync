import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = require('../../database.js');
const eventsService = require('../events.js');

describe('scraping events service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('listScrapeEvents', () => {
    it('uses default limit and maps rows without institution', async () => {
      const querySpy = vi.spyOn(database, 'query').mockResolvedValue({
        rows: [
          {
            id: 1,
            triggered_by: 'manual',
            vendor: 'isracard',
            start_date: '2026-02-01',
            status: 'success',
            message: 'ok',
            created_at: '2026-02-01T00:00:00.000Z',
            institution_id: null,
          },
        ],
      });

      const result = await eventsService.listScrapeEvents();

      expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('LIMIT $1'), [100]);
      expect(result).toEqual([
        {
          id: 1,
          triggered_by: 'manual',
          vendor: 'isracard',
          start_date: '2026-02-01',
          status: 'success',
          message: 'ok',
          created_at: '2026-02-01T00:00:00.000Z',
          institution: null,
        },
      ]);
    });

    it('caps limit at 500 and maps institution details when available', async () => {
      const querySpy = vi.spyOn(database, 'query').mockResolvedValue({
        rows: [
          {
            id: 2,
            triggered_by: 'auto',
            vendor: 'hapoalim',
            start_date: '2026-02-02',
            status: 'running',
            message: 'sync',
            created_at: '2026-02-02T00:00:00.000Z',
            institution_id: 77,
            institution_vendor_code: 'hapoalim',
            institution_name_he: 'בנק הפועלים',
            institution_name_en: 'Bank Hapoalim',
            institution_logo: 'https://logo.test/hapoalim.png',
            institution_type: 'bank',
          },
        ],
      });

      const result = await eventsService.listScrapeEvents({ limit: 9999 });

      expect(querySpy).toHaveBeenCalledWith(expect.any(String), [500]);
      expect(result[0].institution).toEqual({
        id: 77,
        vendor_code: 'hapoalim',
        display_name_he: 'בנק הפועלים',
        display_name_en: 'Bank Hapoalim',
        logo_url: 'https://logo.test/hapoalim.png',
        institution_type: 'bank',
      });
    });

    it('falls back to limit 100 when provided limit is invalid', async () => {
      const querySpy = vi.spyOn(database, 'query').mockResolvedValue({ rows: [] });

      await eventsService.listScrapeEvents({ limit: 'abc' });

      expect(querySpy).toHaveBeenCalledWith(expect.any(String), [100]);
    });
  });

  describe('getScrapeEvent', () => {
    it('returns null when event does not exist', async () => {
      vi.spyOn(database, 'query').mockResolvedValue({ rows: [] });

      await expect(eventsService.getScrapeEvent(55)).resolves.toBeNull();
    });

    it('returns mapped event with institution object', async () => {
      vi.spyOn(database, 'query').mockResolvedValue({
        rows: [
          {
            id: 9,
            triggered_by: 'manual',
            vendor: 'discount',
            start_date: '2026-02-03',
            status: 'failed',
            message: 'error',
            created_at: '2026-02-03T00:00:00.000Z',
            institution_id: 88,
            institution_vendor_code: 'discount',
            institution_name_he: 'בנק דיסקונט',
            institution_name_en: 'Discount Bank',
            institution_logo: null,
            institution_type: 'bank',
          },
        ],
      });

      const result = await eventsService.getScrapeEvent(9);

      expect(result).toEqual({
        id: 9,
        triggered_by: 'manual',
        vendor: 'discount',
        start_date: '2026-02-03',
        status: 'failed',
        message: 'error',
        created_at: '2026-02-03T00:00:00.000Z',
        institution: {
          id: 88,
          vendor_code: 'discount',
          display_name_he: 'בנק דיסקונט',
          display_name_en: 'Discount Bank',
          logo_url: null,
          institution_type: 'bank',
        },
      });
    });
  });
});
