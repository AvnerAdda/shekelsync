import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let historyService: any;
let getInvestmentHistory: (params?: Record<string, unknown>) => Promise<any>;
let clearInstitutionsCache: () => void;

function isStandardHistoryQuery(sql: string) {
  return sql.includes("COALESCE(ih.holding_type, 'standard') <> 'pikadon'")
    && !sql.includes('WITH ranked_baseline AS');
}

function isBaselineHistoryQuery(sql: string) {
  return sql.includes('WITH ranked_baseline AS');
}

function isPikadonHistoryQuery(sql: string) {
  return sql.includes("ih.holding_type = 'pikadon'");
}

beforeAll(async () => {
  const module = await import('../history.js');
  historyService = module.default ?? module;
  getInvestmentHistory = module.getInvestmentHistory;

  const institutionsModule = await import('../../institutions.js');
  clearInstitutionsCache = institutionsModule.clearInstitutionsCache;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-10T00:00:00.000Z'));
  queryMock.mockReset();
  clearInstitutionsCache();
  historyService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  historyService.__resetDatabase();
  clearInstitutionsCache();
  vi.useRealTimers();
});

describe('investment history service', () => {
  it('returns an empty payload when no history rows exist', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ timeRange: 'all' });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(isStandardHistoryQuery(String(queryMock.mock.calls[0][0]))).toBe(true);
    expect(isPikadonHistoryQuery(String(queryMock.mock.calls[1][0]))).toBe(true);
    expect(result).toEqual({
      success: true,
      timeRange: 'all',
      startDate: null,
      dataPoints: 0,
      history: [],
    });
  });

  it('returns forward-filled data for a single account using holding snapshots', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-02',
            current_value: '95',
            cost_basis: '90',
            account_id: 1,
            account_name: 'Main',
            account_type: 'brokerage',
          },
          {
            id: 2,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-05',
            current_value: '100',
            cost_basis: '90',
            account_id: 1,
            account_name: 'Main',
            account_type: 'brokerage',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ accountId: 1, timeRange: '1w' });

    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(isStandardHistoryQuery(String(queryMock.mock.calls[0][0]))).toBe(true);
    expect(isBaselineHistoryQuery(String(queryMock.mock.calls[1][0]))).toBe(true);
    expect(isPikadonHistoryQuery(String(queryMock.mock.calls[2][0]))).toBe(true);
    expect(result.dataPoints).toBe(result.history.length);
    expect(result.history.length).toBeGreaterThanOrEqual(7);
    expect(result.history[0]).toMatchObject({
      date: result.startDate,
      currentValue: 95,
      costBasis: 90,
    });
    expect(result.history.find((point: any) => point.date === '2026-02-05')).toMatchObject({
      currentValue: 100,
      costBasis: 90,
    });
  });

  it('adds active pikadon balances on top of standard snapshots for mixed accounts', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-03',
            current_value: '100',
            cost_basis: '90',
            account_id: 1,
            account_name: 'Mixed Savings',
            account_type: 'savings',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            holding_type: 'pikadon',
            status: 'active',
            snapshot_date: '2026-02-03',
            return_date: null,
            current_value: '50',
            cost_basis: '50',
            account_id: 1,
            account_name: 'Mixed Savings',
            account_type: 'savings',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ accountId: 1, timeRange: '1w' });

    expect(result.history[0]).toMatchObject({
      date: result.startDate,
      currentValue: 150,
      costBasis: 140,
    });
  });

  it('appends synthetic history points for linked non-pikadon contributions after the last snapshot', async () => {
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-23',
            current_value: '300',
            cost_basis: '300',
            account_id: 2,
            account_name: 'פיקדונות',
            account_type: 'savings',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 2,
            identifier: 'contrib-1',
            vendor: 'discount',
            date: '2026-03-09T22:00:00.000Z',
            transaction_datetime: '2026-03-09T22:00:00.000Z',
            name: 'Monthly investment contribution',
            memo: '',
            price: '-680000',
            category_type: 'investment',
            category_name: 'Contribution',
            category_name_en: 'Contribution',
            category_name_fr: null,
          },
        ],
      });

    const result = await getInvestmentHistory({ accountId: 2, timeRange: '1m' });

    expect(result.history.some((point: any) => point.date === '2026-03-10')).toBe(true);
    expect(result.history.at(-1)).toMatchObject({
      date: '2026-03-10',
      currentValue: 680300,
      costBasis: 680300,
    });
  });

  it('keeps pre-window pikadon deposits in view until the in-window return date', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 12,
            holding_type: 'pikadon',
            status: 'returned',
            snapshot_date: '2026-01-15',
            return_date: '2026-02-05',
            current_value: '1000',
            cost_basis: '1000',
            account_id: 4,
            account_name: 'Pikadon Ladder',
            account_type: 'savings',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ accountId: 4, timeRange: '1w' });

    expect(result.history.find((point: any) => point.date === '2026-02-03')).toMatchObject({
      currentValue: 1000,
      costBasis: 1000,
    });
    expect(result.history.find((point: any) => point.date === '2026-02-05')).toMatchObject({
      currentValue: 0,
      costBasis: 0,
    });
  });

  it('aggregates multiple accounts and includes per-account histories when requested', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-03',
            current_value: '110',
            cost_basis: '95',
            account_id: 1,
            account_name: 'Brokerage',
            account_type: 'brokerage',
          },
          {
            id: 2,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-10',
            current_value: '120',
            cost_basis: '100',
            account_id: 1,
            account_name: 'Brokerage',
            account_type: 'brokerage',
          },
          {
            id: 3,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-03',
            current_value: '75',
            cost_basis: '70',
            account_id: 2,
            account_name: 'Pension',
            account_type: 'pension',
          },
          {
            id: 4,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-10',
            current_value: '80',
            cost_basis: '70',
            account_id: 2,
            account_name: 'Pension',
            account_type: 'pension',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            vendor_code: 'pension',
            display_name_en: 'Pension Co',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({
      timeRange: '1w',
      includeAccounts: 'true',
    });

    expect(result.dataPoints).toBe(result.history.length);
    expect(result.history.length).toBeGreaterThanOrEqual(7);
    expect(result.history.at(-1)).toMatchObject({
      accountCount: 2,
      currentValue: 200,
      costBasis: 170,
    });
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0].accountId).toBe(1);
    expect(result.accounts[1].accountId).toBe(2);
  });

  it('builds IN filtering when accountIds are provided', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await getInvestmentHistory({
      timeRange: 'all',
      accountIds: [3, 4],
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('ih.account_id IN ($1,$2)');
    expect(params).toEqual([3, 4, '2026-02-10']);
  });

  it('returns empty payload when no rows exist inside the requested window', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ timeRange: '1w' });

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.history).toEqual([]);
    expect(result.dataPoints).toBe(0);
    expect(result.startDate).toBe('2026-02-03');
  });

  it('supports scalar accountIds and includeAccounts="1" with institution fields from joined rows', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-10',
            current_value: '200',
            cost_basis: '150',
            account_id: 3,
            account_name: 'Direct Institution',
            account_type: 'bank',
            institution_id: 44,
            institution_vendor_code: 'leumi',
            institution_display_name_he: 'לאומי',
            institution_display_name_en: 'Leumi',
            institution_type: 'bank',
            institution_category: 'banking',
            institution_subcategory: 'retail',
            institution_logo_url: 'logo',
            institution_is_scrapable: 1,
            institution_scraper_company_id: 'leumi',
            institution_parent_id: null,
            institution_hierarchy_path: 'banking/leumi',
            institution_depth_level: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({
      timeRange: '1w',
      accountIds: 3,
      includeAccounts: '1',
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('ih.account_id IN ($1)');
    expect(params[0]).toBe(3);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ accountId: 3 });
    expect(Array.isArray(result.accounts[0].history)).toBe(true);
  });

  it('uses default 3-month window for unknown timeRange and falls back institution by vendor code', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 6,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2025-11-12',
            current_value: '80',
            cost_basis: '80',
            account_id: 9,
            account_name: 'Fallback Account',
            account_type: 'pension',
          },
          {
            id: 7,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-10',
            current_value: '90',
            cost_basis: '80',
            account_id: 9,
            account_name: 'Fallback Account',
            account_type: 'pension',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 555,
            vendor_code: 'pension',
            display_name_en: 'Pension Co',
            institution_type: 'pension',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ timeRange: 'weird-range' });

    expect(result.startDate).toBe('2025-11-10');
    expect(result.history.length).toBeGreaterThan(0);
    expect(result.history.at(-1).accounts[0]).toMatchObject({
      account_id: 9,
      account_type: 'pension',
    });
  });

  it('supports all explicit timeRange presets', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    const expectations: Array<[string, string | null | string[]]> = [
      ['1d', '2026-02-09'],
      ['1w', '2026-02-03'],
      ['1m', '2026-01-10'],
      ['2m', '2025-12-10'],
      ['3m', '2025-11-10'],
      ['6m', ['2025-08-09', '2025-08-10']],
      ['1y', ['2025-02-09', '2025-02-10']],
      ['ytd', '2026-01-01'],
      ['all', null],
    ];

    for (const [timeRange, startDate] of expectations) {
      const result = await getInvestmentHistory({ timeRange });
      if (Array.isArray(startDate)) {
        expect(startDate).toContain(result.startDate);
      } else {
        expect(result.startDate).toBe(startDate);
      }
    }
  });

  it('includes per-account histories when includeAccounts is boolean true', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 8,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-03',
            current_value: '110',
            cost_basis: '90',
            account_id: 1,
            account_name: 'Brokerage',
            account_type: 'brokerage',
          },
          {
            id: 9,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-10',
            current_value: '120',
            cost_basis: '100',
            account_id: 1,
            account_name: 'Brokerage',
            account_type: 'brokerage',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({
      timeRange: '1w',
      includeAccounts: true,
    });

    expect(Array.isArray(result.accounts)).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ accountId: 1 });
  });

  it('prioritizes accountId over accountIds when both are supplied', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            holding_type: 'standard',
            status: 'active',
            snapshot_date: '2026-02-10',
            current_value: '50',
            cost_basis: '40',
            account_id: 5,
            account_name: 'Specific',
            account_type: 'bank',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await getInvestmentHistory({
      timeRange: '1w',
      accountId: 5,
      accountIds: [1, 2, 3],
    });

    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('ih.account_id = $1');
    expect(sql).not.toContain('ih.account_id IN');
  });
});
