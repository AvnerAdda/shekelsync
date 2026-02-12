import { describe, it, expect, vi, beforeEach } from 'vitest';

const database = require('../../database.js');
const service = require('../last-update.js');

describe('last-update', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when no credentials exist', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({ rows: [] });

    const result = await service.listAccountLastUpdates();
    expect(result).toEqual([]);
  });

  it('maps row fields to expected output shape', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [
        {
          id: 1,
          vendor: 'hapoalim',
          nickname: 'Main Bank',
          last_update: '2026-01-15T10:00:00Z',
          last_scrape_status: 'success',
          account_numbers: '1111,2222',
          card6_digits: null,
          bank_account_number: '3333',
          institution_id: 5,
          institution_vendor_code: 'hapoalim',
          institution_name_he: 'הפועלים',
          institution_name_en: 'Bank Hapoalim',
          institution_logo: '/logo.png',
          institution_type: 'bank',
        },
      ],
    });

    const result = await service.listAccountLastUpdates();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 1,
      vendor: 'hapoalim',
      nickname: 'Main Bank',
      lastScrapeStatus: 'success',
    });
    expect(result[0].accountNumbers).toContain('1111');
    expect(result[0].accountNumbers).toContain('2222');
    expect(result[0].accountNumbers).toContain('3333');
    expect(result[0].institution).toMatchObject({
      id: 5,
      vendor_code: 'hapoalim',
      display_name_he: 'הפועלים',
      display_name_en: 'Bank Hapoalim',
    });
  });

  it('returns null institution when institution_id is null', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [
        {
          id: 2,
          vendor: 'max',
          nickname: 'Max Card',
          last_update: '2026-01-10T08:00:00Z',
          last_scrape_status: null,
          account_numbers: null,
          card6_digits: '123456',
          bank_account_number: null,
          institution_id: null,
          institution_vendor_code: null,
          institution_name_he: null,
          institution_name_en: null,
          institution_logo: null,
          institution_type: null,
        },
      ],
    });

    const result = await service.listAccountLastUpdates();

    expect(result[0].institution).toBeNull();
    expect(result[0].lastScrapeStatus).toBe('never');
    expect(result[0].accountNumbers).toContain('123456');
  });

  it('deduplicates account numbers from multiple sources', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [
        {
          id: 3,
          vendor: 'visa',
          nickname: 'Visa',
          last_update: '2026-01-01',
          last_scrape_status: 'success',
          account_numbers: '1111,2222',
          card6_digits: '1111;3333',
          bank_account_number: '2222',
          institution_id: null,
        },
      ],
    });

    const result = await service.listAccountLastUpdates();
    const unique = [...new Set(result[0].accountNumbers)];
    expect(result[0].accountNumbers.length).toBe(unique.length);
  });

  it('handles card6_digits with semicolons', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [
        {
          id: 4,
          vendor: 'max',
          nickname: 'Max',
          last_update: null,
          last_scrape_status: null,
          account_numbers: null,
          card6_digits: '111111;222222;333333',
          bank_account_number: null,
          institution_id: null,
        },
      ],
    });

    const result = await service.listAccountLastUpdates();
    expect(result[0].accountNumbers).toEqual(['111111', '222222', '333333']);
  });
});
