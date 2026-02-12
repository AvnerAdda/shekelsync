import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let bankSummaryService: any;
let getBankBalanceSummary: (query?: Record<string, unknown>) => Promise<any>;
let dialect: any;

beforeAll(async () => {
  const module = await import('../bank-summary.js');
  bankSummaryService = module.default ?? module;
  getBankBalanceSummary = module.getBankBalanceSummary;

  const sqlDialectModule = await import('../../../../lib/sql-dialect.js');
  dialect = sqlDialectModule.dialect;
});

beforeEach(() => {
  queryMock.mockReset();
  bankSummaryService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  bankSummaryService.__resetDatabase();
});

describe('bank summary service', () => {
  it('builds summary with daily aggregation by default', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 1,
            account_name: 'Checking',
            account_number: '1111',
            institution_id: 8,
            institution_name_he: 'בנק',
            institution_name_en: 'Bank',
            vendor_code: 'hapoalim',
            institution_logo: 'logo.png',
            current_balance: '1000.5',
            as_of_date: '2026-02-15',
          },
          {
            account_id: 2,
            account_name: 'Savings',
            account_number: '2222',
            institution_id: null,
            current_balance: '500',
            as_of_date: '2026-02-15',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 1,
            month_start_balance: '900',
            snapshot_date: '2026-02-01',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            date: '2026-02-10',
            account_id: 1,
            account_name: 'Checking',
            total_balance: '1000.5',
            avg_balance: '1000.5',
            min_balance: '1000.5',
            max_balance: '1000.5',
            snapshot_count: '1',
          },
          {
            date: '2026-02-10',
            account_id: 2,
            account_name: 'Savings',
            total_balance: '500',
            avg_balance: '500',
            min_balance: '500',
            max_balance: '500',
            snapshot_count: '1',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ date: '2026-02-10', total_balance: '1500.5' }],
      })
      .mockResolvedValueOnce({
        rows: [
          { snapshot_date: '2026-02-01', total_balance: '900' },
          { snapshot_date: '2026-03-01', total_balance: '1000' },
        ],
      });

    const result = await getBankBalanceSummary({
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });

    expect(queryMock).toHaveBeenCalledTimes(5);
    const dailyExpr = dialect.dateTrunc('day', 'ih.as_of_date');
    expect(String(queryMock.mock.calls[2][0])).toContain(dailyExpr);
    expect(String(queryMock.mock.calls[3][0])).toContain(dailyExpr);
    expect(queryMock.mock.calls[1][1]).toEqual(['2026-02-01']);
    expect(result.dateRange.monthStartDate).toBe('2026-02-01');

    expect(result.summary).toMatchObject({
      currentTotalBalance: 1500.5,
      monthStartTotalBalance: 900,
      totalBalanceChange: 600.5,
      accountCount: 2,
    });
    expect(result.summary.totalBalanceChangePercent).toBeCloseTo((600.5 / 900) * 100, 6);

    const checking = result.accounts.find((row: any) => row.accountId === 1);
    const savings = result.accounts.find((row: any) => row.accountId === 2);
    expect(checking).toMatchObject({
      monthStartBalance: 900,
      balanceChange: 100.5,
    });
    expect(checking.balanceChangePercent).toBeCloseTo((100.5 / 900) * 100, 6);
    expect(checking.institution).toMatchObject({ vendor_code: 'hapoalim' });
    expect(savings).toMatchObject({
      monthStartBalance: 0,
      balanceChange: 0,
      institution: null,
    });

    expect(result.history.total).toEqual([{ date: '2026-02-10', totalBalance: 1500.5 }]);
    expect(result.history.perAccount).toHaveLength(2);
    expect(result.monthStarts).toEqual([
      { date: '2026-02-01', totalBalance: 900 },
      { date: '2026-03-01', totalBalance: 1000 },
    ]);
  });

  it('uses weekly aggregation and handles zero month-start balances', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 7,
            account_name: 'Weekly Account',
            account_number: '7777',
            institution_id: null,
            current_balance: '300',
            as_of_date: '2026-03-07',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ account_id: 7, month_start_balance: '0', snapshot_date: '2026-03-01' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            date: '2026-03-02',
            account_id: 7,
            account_name: 'Weekly Account',
            total_balance: '300',
            avg_balance: '300',
            min_balance: '300',
            max_balance: '300',
            snapshot_count: '2',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ date: '2026-03-02', total_balance: '300' }],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const result = await getBankBalanceSummary({
      startDate: '2026-03-02',
      endDate: '2026-03-09',
      aggregation: 'weekly',
    });

    const weeklyExpr = dialect.dateTrunc('week', 'ih.as_of_date');
    expect(String(queryMock.mock.calls[2][0])).toContain(weeklyExpr);
    expect(String(queryMock.mock.calls[3][0])).toContain(weeklyExpr);
    expect(result.dateRange.monthStartDate).toBe('2026-03-01');
    expect(result.summary.totalBalanceChange).toBe(300);
    expect(result.summary.totalBalanceChangePercent).toBe(0);
    expect(result.accounts[0].balanceChangePercent).toBe(0);
  });

  it('uses monthly aggregation and returns empty structures when no data exists', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getBankBalanceSummary({
      startDate: '2026-01-15',
      endDate: '2026-04-15',
      aggregation: 'monthly',
    });

    const monthlyExpr = dialect.dateTrunc('month', 'ih.as_of_date');
    expect(String(queryMock.mock.calls[2][0])).toContain(monthlyExpr);
    expect(String(queryMock.mock.calls[3][0])).toContain(monthlyExpr);
    expect(queryMock.mock.calls[1][1]).toEqual(['2026-01-01']);

    expect(result.summary).toMatchObject({
      currentTotalBalance: 0,
      monthStartTotalBalance: 0,
      totalBalanceChange: 0,
      totalBalanceChangePercent: 0,
      accountCount: 0,
    });
    expect(result.accounts).toEqual([]);
    expect(result.history.total).toEqual([]);
    expect(result.history.perAccount).toEqual([]);
    expect(result.monthStarts).toEqual([]);
  });
});
