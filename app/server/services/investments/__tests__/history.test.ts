import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let historyService: any;
let getInvestmentHistory: (params?: Record<string, unknown>) => Promise<any>;
let clearInstitutionsCache: () => void;

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
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ timeRange: 'all' });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      timeRange: 'all',
      startDate: null,
      dataPoints: 0,
      history: [],
    });
  });

  it('returns forward-filled data for a single account using baseline snapshots', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot_date: '2026-02-05',
            current_value: '100',
            cost_basis: '90',
            account_id: 1,
            account_name: 'Main',
            account_type: 'brokerage',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot_date: '2026-02-02',
            current_value: '95',
            cost_basis: '90',
            account_id: 1,
            account_name: 'Main',
            account_type: 'brokerage',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ accountId: 1, timeRange: '1w' });

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(result.dataPoints).toBe(result.history.length);
    expect(result.history.length).toBeGreaterThanOrEqual(7);
    expect(result.history[0]).toMatchObject({
      date: result.startDate,
      currentValue: 95,
      costBasis: 90,
    });
    const updatedPoint = result.history.find((point: any) => point.date === '2026-02-05');
    expect(updatedPoint).toMatchObject({ currentValue: 100, costBasis: 90 });
    expect(result.history.at(-1).date >= result.startDate).toBe(true);
  });

  it('aggregates multiple accounts and includes per-account histories when requested', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot_date: '2026-02-10',
            current_value: '120',
            cost_basis: '100',
            account_id: 1,
            account_name: 'Brokerage',
            account_type: 'brokerage',
          },
          {
            snapshot_date: '2026-02-10',
            current_value: '80',
            cost_basis: '70',
            account_id: 2,
            account_name: 'Pension',
            account_type: 'pension',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot_date: '2026-02-03',
            current_value: '110',
            cost_basis: '95',
            account_id: 1,
            account_name: 'Brokerage',
            account_type: 'brokerage',
          },
          {
            snapshot_date: '2026-02-03',
            current_value: '75',
            cost_basis: '70',
            account_id: 2,
            account_name: 'Pension',
            account_type: 'pension',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            vendor_code: 'pension',
            display_name_en: 'Pension Co',
          },
        ],
      });

    const result = await getInvestmentHistory({
      timeRange: '1w',
      includeAccounts: 'true',
    });

    expect(result.dataPoints).toBe(result.history.length);
    expect(result.history.length).toBeGreaterThanOrEqual(7);
    const latestPoint = result.history.at(-1);
    expect(latestPoint.accountCount).toBe(2);
    expect([185, 200]).toContain(latestPoint.currentValue);
    expect([165, 170]).toContain(latestPoint.costBasis);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0].accountId).toBe(1);
    expect(result.accounts[1].accountId).toBe(2);
  });

  it('builds IN filtering when accountIds are provided', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await getInvestmentHistory({
      timeRange: 'all',
      accountIds: [3, 4],
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('ih.account_id IN ($1,$2)');
    expect(params).toEqual([3, 4]);
  });

  it('returns empty payload when start-date queries have no baseline and no in-range rows', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentHistory({ timeRange: '1w' });

    expect(queryMock).toHaveBeenCalledTimes(2);
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
            snapshot_date: '2026-02-10',
            current_value: '90',
            cost_basis: '80',
            account_id: 9,
            account_name: 'Fallback Account',
            account_type: 'pension',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot_date: '2025-11-12',
            current_value: '80',
            cost_basis: '80',
            account_id: 9,
            account_name: 'Fallback Account',
            account_type: 'pension',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 555,
            vendor_code: 'pension',
            display_name_en: 'Pension Co',
            institution_type: 'pension',
          },
        ],
      });

    const result = await getInvestmentHistory({ timeRange: 'weird-range' });

    expect(result.startDate).toBe('2025-11-10');
    expect(result.history.length).toBeGreaterThan(0);
    expect(result.history.at(-1).accounts[0]).toMatchObject({
      account_id: 9,
      account_type: 'pension',
    });
  });

  it('prioritizes accountId over accountIds when both are supplied', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
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
      .mockResolvedValueOnce({ rows: [] });

    await getInvestmentHistory({
      timeRange: '1w',
      accountId: 5,
      accountIds: [1, 2, 3],
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('ih.account_id = $1');
    expect(sql).not.toContain('ih.account_id IN');
    expect(params[0]).toBe(5);
  });
});
