import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();

let summaryService: any;
let getInvestmentSummary: (params?: Record<string, unknown>) => Promise<any>;
let clearInstitutionsCache: () => void;

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
  clearInstitutionsCache();
});

describe('investment summary service', () => {
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

  it('returns zeroed summary when accounts and history are empty', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM investment_accounts ia')) return { rows: [] };
      if (sql.includes('FROM investment_assets iasset')) return { rows: [] };
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
});
