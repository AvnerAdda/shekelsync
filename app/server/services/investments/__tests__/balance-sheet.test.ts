import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let balanceSheetService: any;
let getInvestmentBalanceSheet: (query?: Record<string, unknown>) => Promise<any>;
let dialect: any;

beforeAll(async () => {
  const module = await import('../balance-sheet.js');
  balanceSheetService = module.default ?? module;
  getInvestmentBalanceSheet = module.getInvestmentBalanceSheet;

  const sqlDialectModule = await import('../../../../lib/sql-dialect.js');
  dialect = sqlDialectModule.dialect;
});

beforeEach(() => {
  queryMock.mockReset();
  balanceSheetService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  balanceSheetService.__resetDatabase();
});

describe('investment balance sheet service', () => {
  it('classifies accounts into buckets and returns partial net worth when no pairings exist', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            account_name: 'Bank Balance',
            account_type: 'bank_balance',
            investment_category: 'liquid',
            currency: 'ILS',
            current_value: '1500',
            as_of_date: '2026-02-02',
          },
          {
            id: 2,
            account_name: 'Brokerage',
            account_type: 'brokerage',
            investment_category: 'liquid',
            currency: 'USD',
            current_value: '3000',
            as_of_date: '2026-02-03',
          },
          {
            id: 3,
            account_name: 'Pension',
            account_type: 'pension',
            investment_category: 'restricted',
            currency: 'ILS',
            current_value: null,
            as_of_date: null,
          },
          {
            id: 4,
            account_name: 'Bond',
            account_type: 'bond',
            investment_category: 'stability',
            currency: null,
            current_value: '200',
            as_of_date: '2026-02-01',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const result = await getInvestmentBalanceSheet();

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][1]).toEqual([dialect.useSqlite ? 1 : true]);
    expect(result.assets.total).toBe(4700);
    expect(result.assets.newestUpdateDate).toBe('2026-02-03');
    expect(result.assets.buckets.cash).toMatchObject({
      totalValue: 1500,
      accountsCount: 1,
      accountsWithValue: 1,
    });
    expect(result.assets.buckets.liquid).toMatchObject({
      totalValue: 3000,
      accountsCount: 1,
      accountsWithValue: 1,
    });
    expect(result.assets.buckets.restricted).toMatchObject({
      totalValue: 0,
      accountsCount: 1,
      missingValueCount: 1,
    });
    expect(result.assets.buckets.stability).toMatchObject({
      totalValue: 200,
      accountsCount: 1,
      accountsWithValue: 1,
    });
    expect(result.assets.buckets.cash.accounts).toBeUndefined();
    expect(result.assets.currencies).toEqual({
      distinct: ['ILS', 'USD'],
      hasMultiple: true,
    });
    expect(result.liabilities).toMatchObject({
      pendingCreditCardDebt: null,
      pendingCreditCardDebtStatus: 'no_pairings',
      creditCardVendorCount: 0,
    });
    expect(result.netWorth).toBeNull();
    expect(result.netWorthStatus).toBe('partial');
    expect(result.missingValuationsCount).toBe(1);
  });

  it('computes net worth when pending credit card debt is available and includes account details', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            account_name: 'Unknown Bucket',
            account_type: 'custom_type',
            investment_category: 'mystery',
            currency: 'EUR',
            current_value: '100',
            as_of_date: '2026-02-06',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ vendor: 'visaCal' }, { vendor: '' }, { vendor: null }],
      })
      .mockResolvedValueOnce({
        rows: [{ last_date: '2026-02-05' }],
      })
      .mockResolvedValueOnce({
        rows: [{ pending_debt: '40.5' }],
      });

    const result = await getInvestmentBalanceSheet({ includeAccounts: 'true' });

    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(String(queryMock.mock.calls[3][0])).toContain('vendor IN ($1)');
    expect(queryMock.mock.calls[3][1]).toEqual(['visaCal', '2026-02-05']);
    expect(result.assets.total).toBe(100);
    expect(result.assets.buckets.other.accounts).toHaveLength(1);
    expect(result.assets.buckets.other.accounts[0]).toMatchObject({
      id: 10,
      accountName: 'Unknown Bucket',
      currentValue: 100,
    });
    expect(result.assets.currencies).toEqual({
      distinct: ['EUR'],
      hasMultiple: false,
    });
    expect(result.liabilities).toMatchObject({
      pendingCreditCardDebt: 40.5,
      pendingCreditCardDebtStatus: 'ok',
      lastCreditCardRepaymentDate: '2026-02-05',
      creditCardVendorCount: 1,
    });
    expect(result.netWorth).toBe(59.5);
    expect(result.netWorthStatus).toBe('ok');
  });

  it('returns missing repayment baseline status when pairings exist but no repayment is found', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ vendor: 'max' }] })
      .mockResolvedValueOnce({ rows: [{ last_date: null }] });

    const result = await getInvestmentBalanceSheet();

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(result.assets.total).toBe(0);
    expect(result.liabilities).toMatchObject({
      pendingCreditCardDebt: null,
      pendingCreditCardDebtStatus: 'missing_repayment_baseline',
      creditCardVendorCount: 1,
      lastCreditCardRepaymentDate: null,
    });
    expect(result.netWorth).toBeNull();
    expect(result.netWorthStatus).toBe('partial');
  });
});
