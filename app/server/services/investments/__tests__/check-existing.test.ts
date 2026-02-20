import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let checkExistingService: any;
let clearInstitutionsCache: () => void;

beforeAll(async () => {
  const module = await import('../check-existing.js');
  checkExistingService = module.default ?? module;

  const institutionsModule = await import('../../institutions.js');
  clearInstitutionsCache = institutionsModule.clearInstitutionsCache;
});

beforeEach(() => {
  queryMock.mockReset();
  clearInstitutionsCache();
  checkExistingService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  checkExistingService.__resetDatabase();
  clearInstitutionsCache();
});

describe('check existing investments service', () => {
  it('falls back to actual database when __setDatabase is called without a mock', () => {
    checkExistingService.__setDatabase();
    checkExistingService.__setDatabase({
      query: (...args: any[]) => queryMock(...args),
    });
  });

  it('maps vendors, rules, linked accounts, and grouped patterns', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            vendor: 'hapoalim',
            name: 'Investment transfer',
            category_definition_id: 10,
            category_name: 'Investments',
            parent_name: 'Finance',
            transaction_count: '3',
            total_amount: '1250.75',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            name_pattern: 'interactive',
            category_definition_id: 10,
            category_name: 'Investments',
            parent_name: 'Finance',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 91,
            account_name: 'Main Broker',
            account_type: 'brokerage',
            link_count: '4',
            institution_id: 12,
            institution_vendor_code: 'brokerage',
            institution_display_name_he: 'ברוקר',
            institution_display_name_en: 'Brokerage',
            institution_type: 'investment',
            institution_category: 'investments',
            institution_subcategory: null,
            institution_logo_url: null,
            institution_is_scrapable: 1,
            institution_scraper_company_id: null,
            institution_parent_id: null,
            institution_hierarchy_path: '/12',
            institution_depth_level: 1,
          },
        ],
      });

    const result = await checkExistingService.getExistingInvestments();

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(result.vendors).toEqual([
      {
        vendor: 'hapoalim',
        name: 'Investment transfer',
        categoryDefinitionId: 10,
        categoryName: 'Investments',
        parentName: 'Finance',
        transactionCount: 3,
        totalAmount: 1250.75,
      },
    ]);
    expect(result.rules).toEqual([
      {
        pattern: 'interactive',
        categoryDefinitionId: 10,
        categoryName: 'Investments',
        parentName: 'Finance',
      },
    ]);
    expect(result.linkedAccounts[0]).toMatchObject({
      id: 91,
      accountName: 'Main Broker',
      accountType: 'brokerage',
      linkCount: 4,
      institution: {
        id: 12,
        vendor_code: 'brokerage',
      },
    });
    expect(result.patterns.brokerage).toContain('interactive brokers');
  });

  it('falls back to vendor-code institution lookup when join fields are missing', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 55,
            account_name: 'Savings Plan',
            account_type: 'savings',
            link_count: '1',
            institution_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 88,
            vendor_code: 'savings',
            display_name_en: 'Savings',
            display_name_he: 'חיסכון',
          },
        ],
      });

    const result = await checkExistingService.getExistingInvestments();

    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(result.linkedAccounts[0]).toMatchObject({
      id: 55,
      accountType: 'savings',
      linkCount: 1,
      institution: {
        vendor_code: 'savings',
      },
    });
    expect(String(queryMock.mock.calls[3][0])).toContain('ORDER BY category, display_order');
  });

  it('returns null institution when neither joined data nor vendor fallback exists', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 21,
            account_name: 'Unknown',
            account_type: null,
            link_count: '0',
            institution_id: null,
          },
        ],
      });

    const result = await checkExistingService.getExistingInvestments();

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(result.linkedAccounts[0].institution).toBeNull();
    expect(result.linkedAccounts[0].linkCount).toBe(0);
  });
});
