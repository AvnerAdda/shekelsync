import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let investmentsModule: any;
let getInvestmentsAnalytics: any;

beforeAll(async () => {
  investmentsModule = await import('../investments.js');
  getInvestmentsAnalytics =
    investmentsModule.getInvestmentsAnalytics ?? investmentsModule.default.getInvestmentsAnalytics;
});

beforeEach(() => {
  queryMock.mockReset();
  investmentsModule.__setDatabase?.({ query: queryMock });
});

afterEach(() => {
  investmentsModule.__resetDatabase?.();
});

describe('analytics investments service', () => {
  it('separates pikadon principal from income and aggregates investment flows', async () => {
    // 1) Investment transactions (includes pikadon return + deposit)
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'ret-1',
          vendor: 'bank-a',
          date: '2025-02-01',
          name: 'Pikadon Return',
          price: '1100',
          account_number: '123',
          category_definition_id: 1,
          category_name: 'Investments',
          category_name_en: 'Investments',
          parent_id: null,
          parent_name: null,
          parent_name_en: null,
        },
        {
          identifier: 'dep-1',
          vendor: 'bank-a',
          date: '2024-08-01',
          name: 'Pikadon Deposit',
          price: '-1000',
          account_number: '123',
          category_definition_id: 1,
          category_name: 'Investments',
          category_name_en: 'Investments',
          parent_id: null,
          parent_name: null,
          parent_name_en: null,
        },
      ],
    });

    // 2) Pikadon returns map (principal vs. interest)
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          return_transaction_id: 'ret-1',
          return_transaction_vendor: 'bank-a',
          principal: '1000',
          interest: '100',
          status: 'matured',
          child_principal: null,
        },
      ],
    });

    // 3) Timeline aggregation
    queryMock.mockResolvedValueOnce({
      rows: [
        { month: '2025-02-01', outflow: '0', inflow: '1100', count: '1' },
        { month: '2024-08-01', outflow: '1000', inflow: '0', count: '1' },
      ],
    });

    const result = await getInvestmentsAnalytics({
      startDate: '2024-01-01',
      endDate: '2025-12-31',
    });

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(result.summary).toMatchObject({
      totalMovement: 2100,
      investmentOutflow: 1000,
      investmentInflow: 1100,
      adjustedInflow: 100, // only interest counts as income
      netInvestments: -100,
      totalCount: 2,
      pikadonPrincipalReturned: 1000,
      pikadonInterestEarned: 100,
    });

    expect(result.byCategory).toEqual([
      {
        name: 'Investments',
        name_en: 'Investments',
        total: 2100,
        count: 2,
        outflow: 1000,
        inflow: 1100,
      },
    ]);

    expect(result.timeline).toEqual([
      { month: '2025-02-01', outflow: 0, inflow: 1100, net: -1100, count: 1 },
      { month: '2024-08-01', outflow: 1000, inflow: 0, net: 1000, count: 1 },
    ]);
  });
});
