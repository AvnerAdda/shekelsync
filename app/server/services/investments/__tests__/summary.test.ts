import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();

let summaryService: any;
let getInvestmentSummary: (params?: Record<string, unknown>) => Promise<any>;
let clearInstitutionsCache: () => void;

function isStandardSnapshotQuery(sql: string) {
  return sql.includes('WITH ranked_standard AS');
}

function isActivePikadonSnapshotQuery(sql: string) {
  return sql.includes("ih.holding_type = 'pikadon'")
    && sql.includes('GROUP BY ih.account_id');
}

function isActivePikadonOverlapQuery(sql: string) {
  return sql.includes('AS active_value')
    && sql.includes('deposit_transaction_vendor');
}

beforeAll(async () => {
  const module = await import('../summary.js');
  summaryService = module.default ?? module;
  getInvestmentSummary = module.getInvestmentSummary;

  const institutionsModule = await import('../../institutions.js');
  clearInstitutionsCache = institutionsModule.clearInstitutionsCache;
});

beforeEach(() => {
  queryMock.mockReset();
  releaseMock.mockReset();
  clearInstitutionsCache();
  summaryService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
    getClient: async () => ({
      query: (...args: any[]) => queryMock(...args),
      release: (...args: any[]) => releaseMock(...args),
    }),
  });
});

afterEach(() => {
  summaryService.__resetDatabase();
  summaryService.__setFetchBankAccountsForTests?.();
  clearInstitutionsCache();
});

describe('investment summary service', () => {
  it('falls back to default DB when __setDatabase receives no mock', () => {
    summaryService.__setDatabase();
    summaryService.__setDatabase({
      query: (...args: any[]) => queryMock(...args),
      getClient: async () => ({
        query: (...args: any[]) => queryMock(...args),
        release: (...args: any[]) => releaseMock(...args),
      }),
    });
  });

  it('builds portfolio summary, breakdown, timeline, and asset attachments', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [
            {
              id: 1,
              account_name: 'Main Brokerage',
              account_type: 'brokerage',
              investment_category: 'liquid',
              current_value: '1200',
              cost_basis: '1000',
              as_of_date: '2026-01-31',
              institution_id: null,
            },
            {
              id: 2,
              account_name: 'Pension Plan',
              account_type: 'pension',
              investment_category: 'restricted',
              current_value: '800',
              cost_basis: '900',
              as_of_date: '2026-02-01',
              institution_id: 22,
              institution_vendor_code: 'pension',
            },
            {
              id: 3,
              account_name: 'Custom Account',
              account_type: 'custom_type',
              investment_category: 'liquid',
              current_value: '0',
              cost_basis: '0',
              as_of_date: null,
            },
          ],
        };
      }

      if (isStandardSnapshotQuery(sql)) {
        return {
          rows: [
            {
              id: 11,
              account_id: 1,
              holding_type: 'standard',
              status: 'active',
              current_value: '1200',
              cost_basis: '1000',
              as_of_date: '2026-01-31',
            },
            {
              id: 12,
              account_id: 2,
              holding_type: 'standard',
              status: 'active',
              current_value: '800',
              cost_basis: '900',
              as_of_date: '2026-02-01',
            },
            {
              id: 13,
              account_id: 3,
              holding_type: 'standard',
              status: 'active',
              current_value: '0',
              cost_basis: '0',
              as_of_date: null,
            },
          ],
        };
      }

      if (isActivePikadonSnapshotQuery(sql)) {
        return { rows: [] };
      }

      if (sql.includes('FROM investment_assets iasset')) {
        return {
          rows: [
            {
              id: 101,
              account_id: 1,
              asset_name: 'ETF',
              units: '2',
              average_cost: '300',
              current_value: '700',
              cost_basis: '600',
            },
            {
              id: 102,
              account_id: 2,
              asset_name: 'Pension Holding',
              units: '1',
              average_cost: '900',
              current_value: '800',
              cost_basis: '900',
            },
          ],
        };
      }

      if (sql.includes('FROM transaction_account_links tal')) {
        return { rows: [] };
      }

      if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
        return {
          rows: [{ id: 11, vendor_code: 'brokerage', display_name_en: 'Broker' }],
        };
      }

      if (sql.includes('FROM institution_nodes') && sql.includes('WHERE vendor_code = $1')) {
        return {
          rows: [{ id: 11, vendor_code: 'brokerage', display_name_en: 'Broker' }],
        };
      }

      if (sql.includes('SUM(current_value) AS total_value')) {
        return {
          rows: [
            { month: '2025-12-01T00:00:00.000Z', total_value: '1700', total_cost_basis: '1600' },
            { month: '2026-01-01T00:00:00.000Z', total_value: '2000', total_cost_basis: '1900' },
          ],
        };
      }

      throw new Error(`Unexpected query in summary test: ${sql.slice(0, 80)}`);
    });

    const result = await getInvestmentSummary({ historyMonths: 2 });

    expect(result.summary).toMatchObject({
      totalPortfolioValue: 2000,
      totalCostBasis: 1900,
      unrealizedGainLoss: 100,
      totalAccounts: 3,
      accountsWithValues: 2,
    });
    expect(result.summary.roi).toBeCloseTo((100 / 1900) * 100, 6);
    expect(result.summary.liquid).toMatchObject({
      totalValue: 1200,
      totalCost: 1000,
      accountsCount: 1,
    });
    expect(result.summary.restricted).toMatchObject({
      totalValue: 800,
      totalCost: 900,
      accountsCount: 1,
    });

    expect(result.breakdown).toHaveLength(3);
    expect(result.breakdown.find((entry: any) => entry.type === 'brokerage')?.percentage).toBe(60);
    expect(result.breakdown.find((entry: any) => entry.type === 'custom_type')).toMatchObject({
      name: 'custom_type',
      name_he: 'custom_type',
    });

    expect(result.timeline).toEqual([
      { date: '2025-12-01', totalValue: 1700, totalCost: 1600, gainLoss: 100 },
      { date: '2026-01-01', totalValue: 2000, totalCost: 1900, gainLoss: 100 },
    ]);

    expect(result.accounts.find((account: any) => account.id === 1)?.assets).toHaveLength(1);
    expect(result.accounts.find((account: any) => account.id === 2)?.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      units: 2,
      average_cost: 300,
      current_value: 700,
      cost_basis: 600,
    });
    expect(result.liquidAccounts).toHaveLength(2);
    expect(result.restrictedAccounts).toHaveLength(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('subtracts Pikadon-backed savings from matching bank balances to avoid double counting', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [
            {
              id: 1,
              account_name: 'Main Bank',
              account_type: 'bank_balance',
              investment_category: 'cash',
              account_number: '1234',
              current_value: '705476.03',
              cost_basis: '705476.03',
              as_of_date: '2026-03-10',
              institution_id: 18,
              institution_vendor_code: 'discount',
            },
            {
              id: 2,
              account_name: 'Pikadon',
              account_type: 'savings',
              investment_category: 'liquid',
              account_number: '1234',
              current_value: null,
              cost_basis: null,
              as_of_date: '2026-03-10',
              institution_id: 18,
              institution_vendor_code: 'discount',
            },
          ],
        };
      }

      if (isStandardSnapshotQuery(sql)) {
        return {
          rows: [
            {
              id: 21,
              account_id: 1,
              holding_type: 'standard',
              status: 'active',
              current_value: '705476.03',
              cost_basis: '705476.03',
              as_of_date: '2026-03-10',
            },
          ],
        };
      }

      if (isActivePikadonSnapshotQuery(sql)) {
        return {
          rows: [
            {
              account_id: 2,
              current_value: '680000',
              cost_basis: '680000',
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

      if (sql.includes('FROM investment_assets iasset')) {
        return { rows: [] };
      }

      if (sql.includes('FROM transaction_account_links tal')) {
        return { rows: [] };
      }

      if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
        return { rows: [] };
      }

      if (sql.includes('FROM institution_nodes') && sql.includes('WHERE vendor_code = $1')) {
        return { rows: [] };
      }

      if (sql.includes('SUM(current_value) AS total_value')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query in cash label summary test: ${sql.slice(0, 80)}`);
    });

    const result = await getInvestmentSummary({ historyMonths: 1 });

    expect(result.summary.totalPortfolioValue).toBeCloseTo(705476.03, 6);
    expect(result.accounts.find((account: any) => account.id === 1)).toMatchObject({
      account_type: 'bank_balance',
      current_value: 25476.03,
      cost_basis: 25476.03,
    });
    expect(result.breakdown.find((entry: any) => entry.type === 'bank_balance')).toMatchObject({
      name: 'Available Cash',
      category: 'liquid',
      totalValue: 25476.03,
    });
    expect(result.breakdown.find((entry: any) => entry.type === 'savings')).toMatchObject({
      name: 'Savings & Term Deposits',
      category: 'liquid',
      totalValue: 680000,
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('does not backfill linked pikadon deposits during summary reads', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [
            {
              id: 2,
              account_name: 'Pikadon',
              account_type: 'savings',
              investment_category: 'liquid',
              institution_id: null,
            },
          ],
        };
      }

      if (isStandardSnapshotQuery(sql)) {
        return { rows: [] };
      }

      if (isActivePikadonSnapshotQuery(sql)) {
        return { rows: [] };
      }

      if (sql.includes('FROM investment_assets iasset')) {
        return { rows: [] };
      }

      if (sql.includes('FROM transaction_account_links tal')) {
        return {
          rows: [
            {
              account_id: 2,
              identifier: 'pik-1',
              vendor: 'discount',
              date: '2026-03-09T22:00:00.000Z',
              transaction_datetime: '2026-03-09T22:00:00.000Z',
              name: 'הפקדה לפיקדון שבועי',
              memo: '',
              price: '-680000',
              category_type: 'investment',
              category_name: 'Contribution',
              category_name_en: 'Contribution',
              category_name_fr: null,
            },
          ],
        };
      }

      if (sql.includes('FROM institution_nodes') && sql.includes('WHERE vendor_code = $1')) {
        return { rows: [] };
      }

      if (sql.includes('SUM(current_value) AS total_value')) {
        return {
          rows: [
            { month: '2026-03-01T00:00:00.000Z', total_value: '680000', total_cost_basis: '680000' },
          ],
        };
      }

      throw new Error(`Unexpected query in summary backfill test: ${sql.slice(0, 120)}`);
    });

    const result = await getInvestmentSummary({ historyMonths: 1 });

    expect(result.summary).toMatchObject({
      totalPortfolioValue: 0,
      totalCostBasis: 0,
      totalAccounts: 1,
      accountsWithValues: 0,
    });
    expect(result.accounts[0]).toMatchObject({
      account_name: 'Pikadon',
      account_type: 'savings',
      current_value: null,
      cost_basis: null,
      uses_pikadon_rollup: false,
    });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO investment_holdings'))).toBe(false);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('UPDATE transactions SET is_pikadon_related = 1'))).toBe(false);
  });

  it('returns zeroed summary when accounts and history are empty', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) return { rows: [] };
      if (sql.includes('FROM investment_assets iasset')) return { rows: [] };
      if (sql.includes('FROM transaction_account_links tal')) return { rows: [] };
      if (sql.includes('SUM(current_value) AS total_value')) return { rows: [] };
      throw new Error(`Unexpected query in empty summary test: ${sql.slice(0, 80)}`);
    });

    const result = await getInvestmentSummary({ historyMonths: 3 });

    expect(result.summary).toMatchObject({
      totalPortfolioValue: 0,
      totalCostBasis: 0,
      unrealizedGainLoss: 0,
      roi: 0,
      totalAccounts: 0,
      accountsWithValues: 0,
    });
    expect(result.breakdown).toEqual([]);
    expect(result.timeline).toEqual([]);
    expect(result.assets).toEqual([]);
    expect(result.accounts).toEqual([]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('handles non-sqlite dialect paths, non-numeric history months fallback, and null numeric conversions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-16T00:00:00.000Z'));

    const sqlDialectModule = await import('../../../../lib/sql-dialect.js');
    const previousUseSqlite = sqlDialectModule.dialect.useSqlite;
    sqlDialectModule.dialect.useSqlite = false;

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [
            {
              id: 10,
              account_name: 'Edge Account',
              account_type: 'edge_type',
              investment_category: null,
              current_value: null,
              cost_basis: null,
              as_of_date: '2026-02-10',
              institution_id: null,
            },
          ],
        };
      }
      if (isStandardSnapshotQuery(sql)) {
        return {
          rows: [
            {
              id: 31,
              account_id: 10,
              holding_type: 'standard',
              status: 'active',
              current_value: null,
              cost_basis: null,
              as_of_date: '2026-02-10',
            },
          ],
        };
      }
      if (isActivePikadonSnapshotQuery(sql)) {
        return { rows: [] };
      }
      if (sql.includes('FROM investment_assets iasset')) {
        return {
          rows: [
            {
              id: 901,
              account_id: null,
              asset_name: 'Detached Asset',
              units: null,
              average_cost: null,
              current_value: null,
              cost_basis: null,
            },
          ],
        };
      }
      if (sql.includes('FROM transaction_account_links tal')) {
        return { rows: [] };
      }
      if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
        return { rows: [] };
      }
      if (sql.includes('FROM institution_nodes') && sql.includes('WHERE vendor_code = $1')) {
        return { rows: [] };
      }
      if (sql.includes('SUM(current_value) AS total_value')) {
        return {
          rows: [
            {
              month: new Date('2026-01-01T00:00:00.000Z'),
              total_value: null,
              total_cost_basis: null,
            },
            {
              month: '2026-02-01T00:00:00.000Z',
              total_value: '250',
              total_cost_basis: '200',
            },
          ],
        };
      }
      throw new Error(`Unexpected query in edge summary test: ${sql.slice(0, 80)}`);
    });

    try {
      const result = await getInvestmentSummary({ historyMonths: 'bad-value' as any });

      expect(result.summary.totalPortfolioValue).toBe(0);
      expect(result.summary.totalCostBasis).toBe(0);
      expect(result.breakdown[0]).toMatchObject({
        type: 'edge_type',
        category: 'liquid',
      });
      expect(result.timeline).toEqual([
        { date: '2026-01-01', totalValue: 0, totalCost: 0, gainLoss: 0 },
        { date: '2026-02-01', totalValue: 250, totalCost: 200, gainLoss: 50 },
      ]);
      expect(result.assets[0]).toMatchObject({
        units: null,
        average_cost: null,
        current_value: null,
        cost_basis: null,
      });

      const performanceCall = queryMock.mock.calls.find(([sql]) =>
        String(sql).includes('SUM(current_value) AS total_value'),
      );
      const startDateArg = performanceCall?.[1]?.[0];
      expect(startDateArg).toBeInstanceOf(Date);
      expect(startDateArg.toISOString().startsWith('2025-08')).toBe(true);
    } finally {
      sqlDialectModule.dialect.useSqlite = previousUseSqlite;
      vi.useRealTimers();
    }
  });

  it('releases the client when summary queries fail', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        throw new Error('accounts query failed');
      }
      return { rows: [] };
    });

    await expect(getInvestmentSummary({ historyMonths: 1 })).rejects.toThrow('accounts query failed');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('processes legacy bank account balances when fetchBankAccounts override returns rows', async () => {
    summaryService.__setFetchBankAccountsForTests(async () => ({
      rows: [
        {
          vendor: 'hapoalim',
          nickname: 'Legacy Balance',
          current_balance: '350',
          balance_updated_at: '2026-02-10',
        },
      ],
    }));

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) return { rows: [] };
      if (sql.includes('FROM investment_assets iasset')) return { rows: [] };
      if (sql.includes('FROM transaction_account_links tal')) return { rows: [] };
      if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
        return {
          rows: [{ id: 7, vendor_code: 'hapoalim', display_name_en: 'Hapoalim' }],
        };
      }
      if (sql.includes('FROM institution_nodes') && sql.includes('WHERE vendor_code = $1')) {
        return {
          rows: [{ id: 7, vendor_code: 'hapoalim', display_name_en: 'Hapoalim' }],
        };
      }
      if (sql.includes('SUM(current_value) AS total_value')) return { rows: [] };
      throw new Error(`Unexpected query in legacy bank summary test: ${sql.slice(0, 80)}`);
    });

    const result = await getInvestmentSummary({ historyMonths: 1 });

    expect(result.summary).toMatchObject({
      totalPortfolioValue: 350,
      totalCostBasis: 350,
      accountsWithValues: 1,
      totalAccounts: 0,
    });
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]).toMatchObject({
      type: 'savings',
      totalValue: 350,
      totalCost: 350,
      count: 1,
    });
    expect(result.liquidAccounts).toHaveLength(1);
    expect(result.liquidAccounts[0]).toMatchObject({
      account_type: 'savings',
      account_name: 'Legacy Balance',
      current_value: 350,
      cost_basis: 350,
      investment_category: 'liquid',
      institution: { id: 7, vendor_code: 'hapoalim' },
    });
    expect(result.accounts).toEqual([]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rolls account values forward from linked investment contributions after the last snapshot', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) {
        return {
          rows: [
            {
              id: 2,
              account_name: 'פיקדונות',
              account_type: 'savings',
              investment_category: 'liquid',
              current_value: '300',
              cost_basis: '300',
              as_of_date: '2026-02-23',
              institution_id: null,
            },
            {
              id: 3,
              account_name: 'קופות גמל',
              account_type: 'study_fund',
              investment_category: 'restricted',
              current_value: '6000',
              cost_basis: '6000',
              as_of_date: '2026-02-23',
              institution_id: null,
            },
          ],
        };
      }

      if (isStandardSnapshotQuery(sql)) {
        return {
          rows: [
            {
              id: 41,
              account_id: 2,
              holding_type: 'standard',
              status: 'active',
              current_value: '300',
              cost_basis: '300',
              as_of_date: '2026-02-23',
            },
            {
              id: 42,
              account_id: 3,
              holding_type: 'standard',
              status: 'active',
              current_value: '6000',
              cost_basis: '6000',
              as_of_date: '2026-02-23',
            },
          ],
        };
      }

      if (isActivePikadonSnapshotQuery(sql)) {
        return { rows: [] };
      }

      if (sql.includes('FROM investment_assets iasset')) {
        return { rows: [] };
      }

      if (sql.includes('FROM transaction_account_links tal')) {
        return {
          rows: [
            {
              account_id: 2,
              identifier: 'pik-1',
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
            {
              account_id: 3,
              identifier: 'fund-1',
              vendor: 'discount',
              date: '2026-03-01T22:00:00.000Z',
              transaction_datetime: '2026-03-01T22:00:00.000Z',
              name: 'קופת גמל ל חיוב',
              memo: '',
              price: '-2000',
              category_type: 'investment',
              category_name: 'קופות גמל',
              category_name_en: 'Study & Provident Funds',
              category_name_fr: null,
            },
          ],
        };
      }

      if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
        return { rows: [] };
      }

      if (sql.includes('FROM institution_nodes') && sql.includes('WHERE vendor_code = $1')) {
        return { rows: [] };
      }

      if (sql.includes('SUM(current_value) AS total_value')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query in roll-forward summary test: ${sql.slice(0, 80)}`);
    });

    const result = await getInvestmentSummary({ historyMonths: 1 });

    expect(result.summary).toMatchObject({
      totalPortfolioValue: 688300,
      totalCostBasis: 688300,
      newestUpdateDate: '2026-03-10',
    });
    expect(result.liquidAccounts[0]).toMatchObject({
      id: 2,
      current_value: 680300,
      cost_basis: 680300,
      as_of_date: '2026-03-10',
      linked_contribution_adjustment: 680000,
    });
    expect(result.restrictedAccounts[0]).toMatchObject({
      id: 3,
      current_value: 8000,
      cost_basis: 8000,
      as_of_date: '2026-03-02',
      linked_contribution_adjustment: 2000,
    });
  });
});
