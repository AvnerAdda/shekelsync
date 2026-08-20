import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const getInvestmentHistoryMock = vi.fn();

let performanceService: any;
let getInvestmentPerformance: (params?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  queryMock.mockReset();
  getInvestmentHistoryMock.mockReset();

  const module = await import('../performance.js');
  performanceService = module.default ?? module;
  getInvestmentPerformance = module.getInvestmentPerformance;

  performanceService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
  performanceService.__setHistoryService({
    getInvestmentHistory: (...args: any[]) => getInvestmentHistoryMock(...args),
  });
});

afterEach(() => {
  performanceService.__resetDatabase();
});

describe('investment performance service', () => {
  it('returns an empty payload when history is empty', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [],
      accounts: [],
    });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(result).toMatchObject({
      range: '1m',
      requestedStartDate: '2026-03-01',
      startDate: null,
      valueChange: null,
      marketMove: null,
      twr: null,
      method: 'unavailable',
      quality: 'unavailable',
      confidence: expect.objectContaining({
        level: 'unavailable',
        reasons: ['insufficient_history'],
      }),
      timeline: [],
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('defaults performance history to non-real-estate accounts', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 1 }, { id: 3 }],
    });
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [],
      accounts: [],
    });

    await getInvestmentPerformance({ range: '1m' });

    expect(String(queryMock.mock.calls[0][0])).toContain("ia.account_type <> 'real_estate'");
    expect(getInvestmentHistoryMock).toHaveBeenCalledWith({
      timeRange: '1m',
      includeAccounts: true,
      accountIds: [1, 3],
    });
  });

  it('returns empty performance when a scoped request has no matching accounts', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'liquid' });

    expect(result).toMatchObject({
      range: '1m',
      valueChange: null,
      twr: null,
      confidence: expect.objectContaining({ reasons: ['no_matching_accounts'] }),
      timeline: [],
    });
    expect(getInvestmentHistoryMock).not.toHaveBeenCalled();
  });

  it('separates contributions, capital returns, income, and market move', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        { date: '2026-03-01', currentValue: 1000, costBasis: 1000 },
        { date: '2026-03-02', currentValue: 1550, costBasis: 1500 },
        { date: '2026-03-03', currentValue: 1490, costBasis: 1400 },
      ],
      accounts: [{ accountId: 7, history: [] }],
    });

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'dep-1',
            vendor: 'broker',
            date: '2026-03-02',
            name: 'Monthly deposit',
            price: '-500',
            category_type: 'investment',
            is_counted_as_income: 1,
          },
          {
            identifier: 'ret-1',
            vendor: 'bank',
            date: '2026-03-03',
            name: 'Pikadon return',
            price: '60',
            category_type: 'investment',
            is_counted_as_income: 1,
          },
          {
            identifier: 'income-1',
            vendor: 'bank',
            date: '2026-03-03',
            name: 'Investment Interest',
            price: '10',
            category_type: 'income',
            category_name_en: 'Investment Interest',
            is_counted_as_income: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            return_transaction_id: 'ret-1',
            return_transaction_vendor: 'bank',
            cost_basis: '30',
            interest_amount: '6',
          },
          {
            return_transaction_id: 'ret-1',
            return_transaction_vendor: 'bank',
            cost_basis: '20',
            interest_amount: '4',
          },
        ],
      });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(getInvestmentHistoryMock).toHaveBeenCalledWith({
      timeRange: '1m',
      includeAccounts: true,
    });
    expect(queryMock.mock.calls[0][0]).toContain('tal.account_id IN ($1)');
    expect(queryMock.mock.calls[0][1]).toEqual([7, '2026-03-01', '2026-03-03']);
    expect(result.startValue).toBe(1000);
    expect(result.endValue).toBe(1490);
    expect(result.valueChange).toBe(490);
    expect(result.netFlows).toEqual({
      contributions: 500,
      withdrawals: 0,
      netContributions: 500,
    });
    expect(result.capitalReturns).toBe(50);
    expect(result.income).toBe(20);
    expect(result.marketMove).toBe(60);
    expect(result.timeline).toHaveLength(3);
    expect(result.timeline[1]).toMatchObject({
      date: '2026-03-02',
      contributions: 500,
    });
    expect(result.timeline[2]).toMatchObject({
      date: '2026-03-03',
      capitalReturns: 50,
      income: 20,
      taxes: 0,
    });
    expect(typeof result.twr).toBe('number');
    expect(result.twr).toBeCloseTo(0.048, 12);
    expect(result).toMatchObject({
      method: 'modified_dietz',
      quality: 'estimated',
      metricSemantics: expect.objectContaining({
        outputField: 'twr',
        isTrueTwr: false,
        description: expect.stringContaining('backward compatibility'),
      }),
      confidence: expect.objectContaining({
        level: 'low',
        actualValuationPoints: null,
        reasons: ['valuation_provenance_missing'],
      }),
      attribution: {
        basis: 'snapshots_and_linked_transactions',
        returnBasis: 'gross_of_linked_fees_and_taxes',
        formula: expect.stringContaining('taxes'),
        realizedGainGross: null,
        realizedGainNet: null,
        realizedStatus: 'unavailable_without_explicit_disposal_basis',
        unrealizedGain: 90,
        unrealizedStatus: 'snapshot_estimate',
      },
    });
  });

  it('uses the first actual history point as the effective performance start', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-01-01',
      history: [
        { date: '2026-03-05', currentValue: 1000, costBasis: 1000 },
        { date: '2026-03-06', currentValue: 1010, costBasis: 1000 },
      ],
      accounts: [{ accountId: 9, history: [] }],
    });
    queryMock.mockResolvedValue({ rows: [] });

    const result = await getInvestmentPerformance({ range: '1y', assetScope: 'all' });

    expect(result.requestedStartDate).toBe('2026-01-01');
    expect(result.startDate).toBe('2026-03-05');
    const linkedTransactionsCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('FROM transaction_account_links tal'));
    expect(linkedTransactionsCall?.[1]).toEqual([9, '2026-03-05', '2026-03-06']);
    expect(String(linkedTransactionsCall?.[0])).toContain('substr(t.date, 1, 10) >= $2');
    expect(String(linkedTransactionsCall?.[0])).toContain('substr(t.date, 1, 10) <= $3');
    const pikadonReturnCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('FROM investment_holdings ih'));
    expect(String(pikadonReturnCall?.[0])).toContain('substr(rt.date, 1, 10) >= $2');
    expect(String(pikadonReturnCall?.[0])).toContain('substr(rt.date, 1, 10) <= $3');
    expect(pikadonReturnCall?.[1]).toEqual([9, '2026-03-05', '2026-03-06']);
  });

  it('does not manufacture a return from a single valuation point', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [{ date: '2026-03-15', currentValue: 1000, costBasis: 900 }],
      accounts: [],
    });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(result).toMatchObject({
      startDate: '2026-03-15',
      endDate: '2026-03-15',
      twr: null,
      mwr: null,
      method: 'unavailable',
      quality: 'unavailable',
      confidence: expect.objectContaining({
        level: 'unavailable',
        reasons: ['insufficient_history'],
      }),
    });
  });

  it('separates linked investment tax withholding from other flows', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        { date: '2026-03-01', currentValue: 1000, costBasis: 1000 },
        { date: '2026-03-02', currentValue: 970, costBasis: 1000 },
      ],
      accounts: [{ accountId: 7, history: [] }],
    });
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          identifier: 'tax-1',
          vendor: 'bank',
          date: '2026-03-02',
          name: 'Tax debit',
          price: '-30',
          category_type: 'expense',
          category_name_en: 'Investment Tax Withholding',
          is_counted_as_income: 1,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(result.taxes).toBe(30);
    expect(result.fees).toBe(0);
    expect(result.marketMove).toBe(0);
    expect(result.timeline[1]).toMatchObject({
      taxes: 30,
      valueChange: -30,
      marketMove: 0,
      netFlow: -30,
    });
    expect(result.attribution).toMatchObject({
      realizedGainGross: null,
      realizedGainNet: null,
    });
  });

  it('skips flow queries when history does not expose linked investment accounts', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        { date: '2026-03-01', currentValue: 1000, costBasis: 1000 },
        { date: '2026-03-03', currentValue: 1100, costBasis: 1000 },
      ],
      accounts: [],
    });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(queryMock).not.toHaveBeenCalled();
    expect(result.netFlows).toEqual({
      contributions: 0,
      withdrawals: 0,
      netContributions: 0,
    });
    expect(result.marketMove).toBe(100);
  });

  it('counts a transaction linked to multiple accounts only once', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        {
          date: '2026-03-01', currentValue: 1000, costBasis: 1000,
          isActualValuation: true,
        },
        {
          date: '2026-03-02', currentValue: 1100, costBasis: 1100,
          isActualValuation: true,
        },
      ],
      accounts: [
        { accountId: 7, history: [] },
        { accountId: 8, history: [] },
      ],
    });
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('FROM transaction_account_links tal')) {
        return Promise.resolve({
          rows: [
            {
              account_id: 7,
              identifier: 'shared-deposit',
              vendor: 'bank',
              date: '2026-03-02',
              name: 'Portfolio deposit',
              price: '-100',
              category_type: 'investment',
              is_counted_as_income: 1,
            },
            {
              account_id: 8,
              identifier: 'shared-deposit',
              vendor: 'bank',
              date: '2026-03-02',
              name: 'Portfolio deposit',
              price: '-100',
              category_type: 'investment',
              is_counted_as_income: 1,
            },
          ],
        });
      }
      if (text.includes('FROM investment_holdings ih')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(result.netFlows).toEqual({
      contributions: 100,
      withdrawals: 0,
      netContributions: 100,
    });
    expect(result.timeline[1]).toMatchObject({
      date: '2026-03-02',
      contributions: 100,
      marketMove: 0,
    });
    expect(result.flowCoverage).toMatchObject({
      linkedTransactionCount: 1,
      includedLinkedTransactionCount: 1,
      duplicateLinkedTransactionCount: 1,
    });
  });

  it('normalizes linked prices and position-event monetary fields with their dated FX rates', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        { date: '2026-03-01', currentValue: 1000, costBasis: 1000 },
        { date: '2026-03-02', currentValue: 1036, costBasis: 1020 },
      ],
      accounts: [{ accountId: 7, history: [] }],
      fx: { baseCurrency: 'ILS', complete: true, missing: [] },
    });
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('FROM transaction_account_links tal')) {
        return Promise.resolve({
          rows: [{
            account_id: 7,
            identifier: 'usd-deposit',
            vendor: 'broker',
            date: '2026-03-02',
            name: 'USD deposit',
            price: '-10',
            original_currency: 'USD',
            charged_currency: 'USD',
            category_type: 'investment',
            is_counted_as_income: 1,
          }],
        });
      }
      if (text.includes('FROM investment_holdings ih')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('FROM investment_position_events ipe')) {
        return Promise.resolve({
          rows: [
            {
              id: 1,
              event_type: 'deposit',
              effective_date: '2026-03-02',
              currency: 'EUR',
              amount: '5',
              principal_amount: null,
            },
            {
              id: 2,
              event_type: 'dividend',
              effective_date: '2026-03-02',
              currency: 'EUR',
              income_amount: '2',
              reinvested: 0,
            },
            {
              id: 3,
              event_type: 'fee',
              effective_date: '2026-03-02',
              currency: 'EUR',
              amount: '1',
              fee_amount: null,
            },
            {
              id: 4,
              event_type: 'tax',
              effective_date: '2026-03-02',
              currency: 'EUR',
              amount: '0.5',
              tax_amount: null,
            },
            {
              id: 5,
              event_type: 'sell',
              effective_date: '2026-03-02',
              currency: 'EUR',
              proceeds_amount: '6',
              disposed_cost_basis: '2.5',
              realized_gain_loss: '3.5',
              fee_amount: '1',
              tax_amount: '0.5',
            },
          ],
        });
      }
      if (text.includes('FROM investment_fx_rates') && text.includes('rate_date <= $3')) {
        const fromCurrency = params?.[0];
        const rate = fromCurrency === 'USD' ? 3 : 4;
        return Promise.resolve({
          rows: [{
            rate_date: params?.[2],
            from_currency: fromCurrency,
            to_currency: params?.[1],
            rate,
            source: 'test dated rate',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await getInvestmentPerformance({
      range: '1m',
      assetScope: 'all',
      normalizeCurrencies: true,
      includePositionEvents: true,
    });

    expect(result.baseCurrency).toBe('ILS');
    expect(result.netFlows).toEqual({
      contributions: 50,
      withdrawals: 0,
      netContributions: 50,
    });
    expect(result).toMatchObject({
      income: 8,
      dividends: 8,
      fees: 8,
      taxes: 4,
      marketMove: 6,
      flowCoverage: {
        linkedTransactionCount: 1,
        includedLinkedTransactionCount: 1,
        duplicateLinkedTransactionCount: 0,
        positionEventCount: 5,
        missingFxCount: 0,
      },
      attribution: {
        realizedGainGross: 20,
        realizedGainNet: 14,
        realizedStatus: 'explicit_position_events',
      },
    });
    expect(result.timeline[1]).toMatchObject({
      contributions: 50,
      income: 8,
      fees: 8,
      taxes: 4,
      marketMove: 6,
    });

    const rateLookups = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('FROM investment_fx_rates') && String(sql).includes('rate_date <= $3'));
    expect(rateLookups.map(([, params]) => params)).toEqual([
      ['USD', 'ILS', '2026-03-02'],
      ['EUR', 'ILS', '2026-03-02'],
    ]);
  });

  it('returns unavailable performance instead of partial results when flow FX is missing', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        { date: '2026-03-01', currentValue: 1000, costBasis: 1000 },
        { date: '2026-03-02', currentValue: 1100, costBasis: 1050 },
      ],
      accounts: [{ accountId: 7, history: [] }],
      fx: { baseCurrency: 'ILS', complete: true, missing: [] },
    });
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('FROM transaction_account_links tal')) {
        return Promise.resolve({
          rows: [{
            account_id: 7,
            identifier: 'missing-usd-rate',
            vendor: 'broker',
            date: '2026-03-02',
            name: 'USD deposit',
            price: '-10',
            charged_currency: 'USD',
            category_type: 'investment',
          }],
        });
      }
      if (text.includes('FROM investment_holdings ih')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('FROM investment_position_events ipe')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            event_type: 'dividend',
            effective_date: '2026-03-02',
            currency: 'EUR',
            income_amount: '2',
            reinvested: 0,
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await getInvestmentPerformance({
      range: '1m',
      assetScope: 'all',
      normalizeCurrencies: true,
      includePositionEvents: true,
    });

    expect(result).toMatchObject({
      requestedStartDate: '2026-03-01',
      startDate: null,
      endDate: null,
      startValue: null,
      endValue: null,
      valueChange: null,
      marketMove: null,
      twr: null,
      mwr: null,
      method: 'unavailable',
      quality: 'unavailable',
      confidence: expect.objectContaining({
        level: 'unavailable',
        reasons: ['missing_fx_rates'],
      }),
      fx: {
        baseCurrency: 'ILS',
        complete: false,
        missingCount: 2,
        missing: expect.arrayContaining([
          { kind: 'linked_transaction', currency: 'USD', date: '2026-03-02', status: 'missing' },
          { kind: 'position_event', currency: 'EUR', date: '2026-03-02', status: 'missing' },
        ]),
      },
      timeline: [],
    });
    expect(result.netFlows).toEqual({
      contributions: 0,
      withdrawals: 0,
      netContributions: 0,
    });
  });

  it('deduplicates an event-linked transaction before requiring its FX rate', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        {
          date: '2026-03-01', currentValue: 1000, costBasis: 1000,
          isActualValuation: true,
        },
        {
          date: '2026-03-02', currentValue: 1100, costBasis: 1100,
          isActualValuation: true,
        },
      ],
      accounts: [{ accountId: 7, history: [] }],
      fx: { baseCurrency: 'ILS', complete: true, missing: [] },
    });
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('FROM transaction_account_links tal')) {
        return Promise.resolve({
          rows: [{
            account_id: 7,
            identifier: 'event-backed-deposit',
            vendor: 'broker',
            date: '2026-03-02',
            name: 'Foreign deposit transaction',
            price: '-25',
            charged_currency: 'USD',
            category_type: 'investment',
          }],
        });
      }
      if (text.includes('FROM investment_holdings ih')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('FROM investment_position_events ipe')) {
        return Promise.resolve({
          rows: [{
            id: 1,
            event_type: 'deposit',
            effective_date: '2026-03-02',
            currency: 'ILS',
            principal_amount: '100',
            linked_transaction_identifier: 'event-backed-deposit',
            linked_transaction_vendor: 'broker',
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await getInvestmentPerformance({
      range: '1m',
      assetScope: 'all',
      normalizeCurrencies: true,
      includePositionEvents: true,
    });

    expect(result).toMatchObject({
      method: 'daily_linked_return',
      netFlows: {
        contributions: 100,
        withdrawals: 0,
        netContributions: 100,
      },
      marketMove: 0,
      flowCoverage: {
        linkedTransactionCount: 1,
        includedLinkedTransactionCount: 0,
        duplicateLinkedTransactionCount: 0,
        positionEventCount: 1,
        missingFxCount: 0,
      },
    });
    expect(queryMock.mock.calls.some(([sql]) =>
      String(sql).includes('FROM investment_fx_rates') && String(sql).includes('rate_date <= $3')))
      .toBe(false);
  });

  it('counts only the earliest legacy position event for a duplicated transaction key', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        {
          date: '2026-03-01', currentValue: 1000, costBasis: 1000,
          isActualValuation: true,
        },
        {
          date: '2026-03-02', currentValue: 1100, costBasis: 1100,
          isActualValuation: true,
        },
      ],
      accounts: [{ accountId: 7, history: [] }],
    });
    queryMock.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes('FROM investment_position_events ipe')) {
        return Promise.resolve({
          rows: [
            {
              id: 7,
              event_type: 'deposit',
              effective_date: '2026-03-02',
              currency: 'ILS',
              principal_amount: '250',
              linked_transaction_identifier: 'legacy-duplicate',
              linked_transaction_vendor: 'broker',
            },
            {
              id: 3,
              event_type: 'deposit',
              effective_date: '2026-03-02',
              currency: 'ILS',
              principal_amount: '100',
              linked_transaction_identifier: 'legacy-duplicate',
              linked_transaction_vendor: 'broker',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await getInvestmentPerformance({
      range: '1m',
      assetScope: 'all',
      includePositionEvents: true,
    });

    expect(result).toMatchObject({
      netFlows: {
        contributions: 100,
        withdrawals: 0,
        netContributions: 100,
      },
      marketMove: 0,
      flowCoverage: {
        positionEventCount: 1,
        duplicatePositionEventCount: 1,
      },
    });
  });

  it('uses Modified Dietz when a cash flow lacks observed valuation boundaries', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        {
          date: '2026-03-01', currentValue: 1000, costBasis: 1000,
          isActualValuation: true,
        },
        {
          date: '2026-03-02', currentValue: 1000, costBasis: 1000,
          isActualValuation: false,
        },
        {
          date: '2026-03-03', currentValue: 1150, costBasis: 1100,
          isActualValuation: true,
        },
      ],
      accounts: [{ accountId: 7, history: [] }],
    });
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('FROM transaction_account_links tal')) {
        return Promise.resolve({
          rows: [{
            account_id: 7,
            identifier: 'mid-period-deposit',
            vendor: 'bank',
            date: '2026-03-02',
            name: 'Deposit',
            price: '-100',
            category_type: 'investment',
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(result.twr).toBeCloseTo(50 / 1050, 12);
    expect(result).toMatchObject({
      method: 'modified_dietz',
      quality: 'estimated',
      metricSemantics: expect.objectContaining({
        outputField: 'twr',
        isTrueTwr: false,
      }),
      confidence: expect.objectContaining({
        level: 'low',
        actualValuationPoints: 2,
        cashFlowDays: 1,
        flowBoundaryCoverage: 0,
        reasons: ['flow_boundaries_not_observed'],
      }),
    });
    expect(result.timeline[1]).toMatchObject({
      contributions: 100,
      marketMove: -100,
    });
  });

  it('keeps a true daily-linked TWR when period and cash-flow boundaries are observed', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        {
          date: '2026-03-01', currentValue: 1000, costBasis: 1000,
          isActualValuation: true,
        },
        {
          date: '2026-03-02', currentValue: 1150, costBasis: 1100,
          isActualValuation: true,
        },
      ],
      accounts: [{ accountId: 7, history: [] }],
    });
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('FROM transaction_account_links tal')) {
        return Promise.resolve({
          rows: [{
            account_id: 7,
            identifier: 'observed-deposit',
            vendor: 'bank',
            date: '2026-03-02',
            name: 'Deposit',
            price: '-100',
            category_type: 'investment',
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(result.twr).toBeCloseTo(0.05, 12);
    expect(result).toMatchObject({
      method: 'daily_linked_return',
      quality: 'observed',
      metricSemantics: expect.objectContaining({
        outputField: 'twr',
        isTrueTwr: true,
      }),
      confidence: {
        level: 'high',
        score: 1,
        reasons: [],
        historyPoints: 2,
        actualValuationPoints: 2,
        cashFlowDays: 1,
        flowBoundaryCoverage: 1,
      },
    });
  });

  it('returns unavailable when the Modified Dietz capital base is non-positive', async () => {
    getInvestmentHistoryMock.mockResolvedValue({
      startDate: '2026-03-01',
      history: [
        { date: '2026-03-01', currentValue: 100, costBasis: 100 },
        { date: '2026-03-02', currentValue: 100, costBasis: 100 },
        { date: '2026-03-03', currentValue: 0, costBasis: 0 },
      ],
      accounts: [{ accountId: 7, history: [] }],
    });
    queryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('FROM transaction_account_links tal')) {
        return Promise.resolve({
          rows: [{
            account_id: 7,
            identifier: 'large-withdrawal',
            vendor: 'bank',
            date: '2026-03-02',
            name: 'Withdrawal',
            price: '300',
            category_type: 'investment',
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await getInvestmentPerformance({ range: '1m', assetScope: 'all' });

    expect(result).toMatchObject({
      twr: null,
      method: 'unavailable',
      quality: 'unavailable',
      metricSemantics: expect.objectContaining({ isTrueTwr: false }),
      confidence: expect.objectContaining({
        level: 'unavailable',
        reasons: [
          'valuation_provenance_missing',
          'invalid_modified_dietz_denominator',
        ],
      }),
    });
  });
});
