import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let balanceSheetService: any;
let getInvestmentBalanceSheet: (query?: Record<string, unknown>) => Promise<any>;
let dialect: any;

function isActivePikadonOverlapQuery(sql: string) {
  return sql.includes('AS active_value')
    && sql.includes('deposit_transaction_vendor');
}

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
    expect(result.assets.buckets.illiquid).toMatchObject({
      totalValue: 0,
      accountsCount: 0,
      accountsWithValue: 0,
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

  it('classifies real estate accounts as illiquid even with stale liquid category values', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 20,
            account_name: 'Rental Apartment',
            account_type: 'real_estate',
            investment_category: 'liquid',
            currency: 'ILS',
            current_value: '2500000',
            as_of_date: '2026-05-01',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentBalanceSheet({ includeAccounts: 'true' });

    expect(result.assets.total).toBe(2500000);
    expect(result.assets.buckets.liquid).toMatchObject({
      totalValue: 0,
      accountsCount: 0,
    });
    expect(result.assets.buckets.illiquid).toMatchObject({
      totalValue: 2500000,
      accountsCount: 1,
      accountsWithValue: 1,
    });
    expect(result.assets.buckets.illiquid.accounts[0]).toMatchObject({
      id: 20,
      accountType: 'real_estate',
      investmentCategory: 'liquid',
      currentValue: 2500000,
    });
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

  it('keeps native valuation coverage separate from a missing FX rate', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [
            {
              id: 12,
              account_name: 'US Brokerage',
              account_type: 'brokerage',
              investment_category: 'liquid',
              currency: 'USD',
              current_value: '100',
              as_of_date: '2026-02-06',
            },
            {
              id: 14,
              account_name: 'ILS Brokerage',
              account_type: 'brokerage',
              investment_category: 'liquid',
              currency: 'ILS',
              current_value: '50',
              as_of_date: '2026-02-06',
            },
          ],
        };
      }
      if (sql.includes('SELECT DISTINCT credit_card_vendor as vendor')) return { rows: [] };
      if (sql.includes('SELECT base_currency FROM investment_fx_preferences')) {
        return { rows: [{ base_currency: 'ILS' }] };
      }
      if (sql.includes('FROM investment_fx_rates') && sql.includes('rate_date <= $3')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await getInvestmentBalanceSheet({
      includeAccounts: 'true',
      normalizeCurrencies: 'true',
    });

    expect(result.assets.total).toBeNull();
    expect(result.assets.convertedSubtotal).toBe(50);
    expect(result.assets.nativeTotals).toEqual([
      { currency: 'ILS', total: 50, count: 1 },
      { currency: 'USD', total: 100, count: 1 },
    ]);
    expect(result.assets.buckets.liquid).toMatchObject({
      totalValue: null,
      convertedSubtotal: 50,
      fxComplete: false,
      accountsCount: 2,
      accountsWithValue: 2,
      missingValueCount: 0,
      missingFxCount: 1,
    });
    expect(result.assets.buckets.liquid.accounts[0]).toMatchObject({
      nativeCurrentValue: 100,
      currentValue: null,
    });
    expect(result.missingValuationsCount).toBe(0);
    expect(result.fx).toMatchObject({
      complete: false,
      missingCount: 1,
      convertedSubtotal: 50,
      assets: {
        complete: false,
        missingCount: 1,
        convertedSubtotal: 50,
        nativeTotals: [
          { currency: 'ILS', total: 50, count: 1 },
          { currency: 'USD', total: 100, count: 1 },
        ],
      },
    });
    expect(result.netWorth).toBeNull();
  });

  it('preserves genuine zero totals when normalized FX coverage is complete', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [{
            id: 13,
            account_name: 'Empty ILS Brokerage',
            account_type: 'brokerage',
            investment_category: 'liquid',
            currency: 'ILS',
            current_value: '0',
            as_of_date: '2026-02-06',
          }],
        };
      }
      if (sql.includes('SELECT DISTINCT credit_card_vendor as vendor')) {
        return { rows: [{ vendor: 'max' }] };
      }
      if (sql.includes('SELECT MAX(t.date) as last_date')) {
        return { rows: [{ last_date: '2026-02-05' }] };
      }
      if (sql.includes('SELECT COALESCE(SUM(ABS(price)), 0) as pending_debt')) {
        return { rows: [{ pending_debt: '0' }] };
      }
      if (sql.includes('SELECT base_currency FROM investment_fx_preferences')) {
        return { rows: [{ base_currency: 'ILS' }] };
      }
      return { rows: [] };
    });

    const result = await getInvestmentBalanceSheet({
      includeAccounts: 'true',
      normalizeCurrencies: 'true',
    });

    expect(result.assets).toMatchObject({
      total: 0,
      convertedSubtotal: 0,
    });
    expect(result.assets.buckets.liquid).toMatchObject({
      totalValue: 0,
      convertedSubtotal: 0,
      fxComplete: true,
      missingFxCount: 0,
    });
    expect(result.liabilities).toMatchObject({
      total: 0,
      convertedSubtotal: 0,
    });
    expect(result.netWorth).toBe(0);
    expect(result.netWorthStatus).toBe('ok');
    expect(result.fx).toMatchObject({ complete: true, missingCount: 0 });
  });

  it('marks liability totals unavailable when a manual liability lacks FX', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [{
            id: 15,
            account_name: 'ILS Brokerage',
            account_type: 'brokerage',
            investment_category: 'liquid',
            currency: 'ILS',
            current_value: '100',
            as_of_date: '2026-02-06',
          }],
        };
      }
      if (sql.includes('FROM investment_liabilities')) {
        return {
          rows: [{
            id: '5',
            liability_name: 'USD Loan',
            liability_type: 'loan',
            balance: '40',
            currency: 'USD',
            as_of_date: '2026-02-06',
            included_in_net_worth: 1,
            is_active: 1,
          }],
        };
      }
      if (sql.includes('SELECT DISTINCT credit_card_vendor as vendor')) {
        return { rows: [{ vendor: 'max' }] };
      }
      if (sql.includes('SELECT MAX(t.date) as last_date')) {
        return { rows: [{ last_date: '2026-02-05' }] };
      }
      if (sql.includes('SELECT COALESCE(SUM(ABS(price)), 0) as pending_debt')) {
        return { rows: [{ pending_debt: '0' }] };
      }
      if (sql.includes('SELECT base_currency FROM investment_fx_preferences')) {
        return { rows: [{ base_currency: 'ILS' }] };
      }
      if (sql.includes('FROM investment_fx_rates') && sql.includes('rate_date <= $3')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await getInvestmentBalanceSheet({
      includeLiabilities: 'true',
      normalizeCurrencies: 'true',
    });

    expect(result.assets.total).toBe(100);
    expect(result.liabilities).toMatchObject({
      manualTotal: null,
      total: null,
      convertedSubtotal: 0,
      nativeTotals: [{ currency: 'USD', total: 40, count: 1 }],
    });
    expect(result.fx).toMatchObject({
      complete: false,
      missingCount: 1,
      liabilities: {
        complete: false,
        missingCount: 1,
        convertedSubtotal: 0,
        nativeTotals: [{ currency: 'USD', total: 40, count: 1 }],
      },
    });
    expect(result.netWorth).toBeNull();
    expect(result.netWorthStatus).toBe('partial');
  });

  it('reduces cash totals when an active Pikadon overlaps a bank balance account', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        expect(sql).toContain("credential_id:");
        expect(sql).toContain('ia.account_number = vc.bank_account_number');
        return {
          rows: [
            {
              id: 1,
              account_name: 'Main Bank',
              account_type: 'bank_balance',
              investment_category: 'cash',
              account_number: '1234',
              institution_id: 18,
              institution_vendor_code: 'discount',
              currency: 'ILS',
              current_value: '705476.03',
              as_of_date: '2026-03-10',
            },
            {
              id: 2,
              account_name: 'Pikadon',
              account_type: 'savings',
              investment_category: 'liquid',
              account_number: '1234',
              institution_id: 18,
              institution_vendor_code: 'discount',
              currency: 'ILS',
              current_value: '680000',
              as_of_date: '2026-03-10',
            },
          ],
        };
      }

      if (isActivePikadonOverlapQuery(sql)) {
        return {
          rows: [
            {
              pikadon_account_id: 2,
              institution_id: 18,
              source_vendor_code: 'discount',
              source_account_number: '1234',
              active_value: '680000',
            },
          ],
        };
      }

      if (sql.includes('SELECT DISTINCT credit_card_vendor as vendor')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query in balance sheet overlap test: ${sql.slice(0, 120)}`);
    });

    const result = await getInvestmentBalanceSheet({ includeAccounts: 'true' });

    expect(result.assets.total).toBeCloseTo(705476.03, 6);
    expect(result.assets.buckets.cash).toMatchObject({
      totalValue: 25476.03,
      accountsCount: 1,
      accountsWithValue: 1,
    });
    expect(result.assets.buckets.liquid).toMatchObject({
      totalValue: 680000,
      accountsCount: 1,
      accountsWithValue: 1,
    });
    expect(result.assets.buckets.cash.accounts[0]).toMatchObject({
      id: 1,
      currentValue: 25476.03,
    });
    expect(result.assets.buckets.liquid.accounts[0]).toMatchObject({
      id: 2,
      currentValue: 680000,
    });
  });
});
