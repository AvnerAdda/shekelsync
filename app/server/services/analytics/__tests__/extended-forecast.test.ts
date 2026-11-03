import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
const service = require('../extended-forecast.js');
const { buildExtendedForecastPayload: build } = service._internal;
const forecast = () => ({
  modelId: 'pattern-v5', truthRevision: 4, forecastPeriod: { start: '2026-10-02', end: '2026-10-03' },
  dailyForecasts: [
    { date: '2026-10-02', expectedIncome: 100, expectedExpenses: 30, predictions: [
      { categoryType: 'income', categoryDefinitionId: 1, transactionName: 'Employer payroll', vendor: 'bank', probabilityWeightedAmount: 100, expectedPaymentDate: '2026-10-01', awaitingReceipt: true },
      { categoryType: 'expense', categoryDefinitionId: 2, category: 'Utilities', probabilityWeightedAmount: 30, predictionKind: 'recurring_expense' },
    ] },
    { date: '2026-10-03', expectedIncome: 0, expectedExpenses: 50, predictions: [
      { categoryType: 'expense', categoryDefinitionId: 3, category: 'Repairs', probabilityWeightedAmount: 40, forecastBasis: 'irregular_allowance' },
      { categoryType: 'expense', categoryDefinitionId: 2, category: 'Utilities', probabilityWeightedAmount: 10 },
    ] },
  ],
  // The median of each cumulative distribution differs from the expected value.
  predictionIntervals: { daily: [
    { date: '2026-10-02', cumulativeCashFlow: { p10: -10, p50: 60, p90: 100 } },
    { date: '2026-10-03', cumulativeCashFlow: { p10: -60, p50: 10, p90: 90 } },
  ] },
  scenarios: { p50: { dailyForecasts: [{ date: '2026-10-03', cumulativeCashFlow: 999999 }] } },
  categoryPatterns: [{ categoryDefinitionId: 2, categoryNameEn: 'Utilities' }, { categoryDefinitionId: 3, categoryNameEn: 'Repairs' }],
});
const history = [{ date: '2026-10-01', historicalCumulative: 1000, income: 0, expenses: 0 }];
const generate = vi.fn();
const query = vi.fn();
const snapshot = vi.fn();
const convertAmount = vi.fn();
const bank = (current_value: unknown = 1000, currency = 'ILS') => ({ account_id: 1, current_value, currency });
let oldEnvironment: string | undefined;

beforeEach(() => {
  oldEnvironment = process.env.NODE_ENV;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 1, 12));
  generate.mockReset().mockResolvedValue(forecast());
  query.mockReset().mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions') ? [] : [bank()] }));
  convertAmount.mockReset().mockResolvedValue({ complete: true, baseAmount: 3700 });
  snapshot.mockReset().mockReturnValue({ truthRevision: 4 });
  service.__setDependencies({ database: { query }, forecast: { generateDailyForecast: generate }, financialTruth: { getProjectionSnapshot: snapshot }, fx: { convertAmount } });
});
afterEach(() => {
  service.__resetDependencies();
  vi.useRealTimers();
  if (oldEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = oldEnvironment;
});

describe('extended forecast', () => {
  it('reconciles the expected curve, cash-flow change and closing position', () => {
    const result = build(forecast(), history, 1000);
    expect(result.combinedData.map((day: any) => day.expectedCumulative)).toEqual([1000, 1070, 1020]);
    expect(result.summaries.base).toEqual({ income: 100, expenses: 80, netCashFlow: 20, endingBalance: 1020 });
    expect(result.startingBalance).toBe(1000);
    expect(result.forecastPeriod.end).toBe('2026-10-03');
  });

  it('uses pointwise cumulative quantiles and does not invent income/expenses for range bounds', () => {
    const result = build(forecast(), history, 1000);
    expect(result.combinedData.map((day: any) => day.p50Cumulative)).toEqual([1000, 1060, 1010]);
    expect(result.summaries.pessimistic).toEqual({ netCashFlow: -60, endingBalance: 940 });
    expect(result.summaries.optimistic).toEqual({ netCashFlow: 90, endingBalance: 1090 });
    expect(result.scenarios.p50.at(-1).forecastCumulative).toBe(1010);
    expect(result.scenarios.p50.at(-1)).not.toHaveProperty('income');
    expect(history[0]).not.toHaveProperty('p50Cumulative');
  });

  it.each([null, { p10: -1, p50: 0, p90: NaN }, { p10: 20, p50: 10, p90: 30 }])('leaves unavailable or invalid ranges absent (%j)', range => {
    const input = forecast();
    input.predictionIntervals.daily[1].cumulativeCashFlow = range as any;
    const result = build(input, history, 1000);
    expect(result.combinedData.at(-1).p10Cumulative).toBeNull();
    expect(result.summaries.pessimistic.endingBalance).toBeNull();
    expect(result.summaries.base.endingBalance).toBe(1020);
  });

  it('aggregates expense drivers by actual contribution and distinguishes their assumptions', () => {
    const result = build(forecast(), history, 1000);
    expect(result.expenseDrivers).toEqual([
      { categoryDefinitionId: 2, category: 'Utilities', categoryNameEn: 'Utilities', amount: 40, scheduled: 30, typical: 10, occasional: 0 },
      { categoryDefinitionId: 3, category: 'Repairs', categoryNameEn: 'Repairs', amount: 40, scheduled: 0, typical: 0, occasional: 40 },
    ]);
    expect(result.expenseDrivers.reduce((sum: number, driver: any) => sum + driver.amount, 0)).toBe(result.summaries.base.expenses);
  });

  it('shows each income source and keeps a due receipt visible without relabeling it as actual cash', () => {
    const result = build(forecast(), history, 1000);
    expect(result.incomeDrivers).toEqual([
      { source: 'Employer payroll', amount: 100, nextDate: '2026-10-02', expectedPaymentDate: '2026-10-01', awaitingReceipt: true },
    ]);
    expect(result.incomeDrivers.reduce((sum: number, driver: any) => sum + driver.amount, 0)).toBe(result.summaries.base.income);
    expect(result.startingBalance).toBe(1000);
  });

  it('deducts planned investments from every path after investing', () => {
    const input = forecast();
    (input.dailyForecasts[0] as any).expectedInvestments = 50;
    const result = build(input, history, 1000, { includeInvestments: true });
    expect(result.combinedData.map((day: any) => day.expectedCumulative)).toEqual([1000, 1020, 970]);
    expect(result.combinedData.map((day: any) => day.p10Cumulative)).toEqual([1000, 940, 890]);
    expect(result.summaries.base).toEqual({ income: 100, expenses: 80, investments: 50, netCashFlow: -30, endingBalance: 970 });
    expect(result.summaries.pessimistic).toEqual({ netCashFlow: -110, endingBalance: 890 });
    expect(build(input, history, 1000).summaries.base.endingBalance).toBe(1020);
  });

  it('returns both investment views, defaulting to after investing, anchored at the same balance', async () => {
    const input = forecast();
    (input.dailyForecasts[0] as any).expectedInvestments = 50;
    generate.mockResolvedValue(input);
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions')
      ? [{ date: '2026-09-29', income: '100', expenses: '30', investments: 0 }, { date: '2026-09-30', income: 0, expenses: 0, investments: '50' }]
      : [bank('1000')] }));
    const result = await service.getExtendedForecast();
    const history = (basis: string) => result.investmentBases[basis].combinedData.slice(0, 3).map((day: any) => day.historicalCumulative);
    expect(history('after')).toEqual([1050, 1000, 1000]);
    expect(history('before')).toEqual([1000, 1000, 1000]);
    expect(result.investmentBases.after.summaries.base.endingBalance).toBe(970);
    expect(result.investmentBases.before.summaries.base.endingBalance).toBe(1020);
    expect(result.summaries).toEqual(result.investmentBases.after.summaries);
    expect(result.combinedData).toEqual(result.investmentBases.after.combinedData);
    expect(result).toMatchObject({ hasInvestments: true, startingBalance: 1000 });
  });

  it('reports no investment activity when neither history nor forecast moves money', async () => {
    expect((await service.getExtendedForecast()).hasInvestments).toBe(false);
  });

  it('anchors history to the current balance including expense refunds', async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions')
      ? [{ date: '2026-09-29', income: '100', expenses: '30' }, { date: '2026-09-30', income: 0, expenses: -20 }]
      : [bank('1000')] }));
    const result = await service.getExtendedForecast();
    expect(result.combinedData.slice(0, 3).map((day: any) => [day.date, day.historicalCumulative])).toEqual([
      ['2026-09-29', 980], ['2026-09-30', 1000], ['2026-10-01', 1000],
    ]);
    expect(result.hasCurrentBalance).toBe(true);
    expect(result.summaries.base.endingBalance).toBe(1020);
  });

  it.each([null, 0])('distinguishes an unknown bank balance from an actual zero (%j)', async balance => {
    // No history rows: the history query and balance query have different responses.
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions') ? [] : [bank(balance)] }));
    const result = await service.getExtendedForecast();
    expect(result.hasCurrentBalance).toBe(balance !== null);
    expect(result.startingBalance).toBe(0);
    expect(result.summaries.base.endingBalance).toBe(20);
  });

  it('converts foreign bank balances to shekels before anchoring the forecast', async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions')
      ? [] : [bank(10000), { ...bank(1000, 'USD'), account_id: 2 }] }));
    const result = await service.getExtendedForecast();
    expect(convertAmount).toHaveBeenCalledWith({ amount: 1000, currency: 'USD', baseCurrency: 'ILS', date: '2026-10-01' });
    expect(result).toMatchObject({ hasCurrentBalance: true, balanceStatus: 'ready', startingBalance: 13700 });
    expect(result.summaries.base.endingBalance).toBe(13720);
  });

  it.each(['missing', 'stale'])('withholds a partial balance when an exchange rate is %s', async status => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions')
      ? [] : [bank(10000), bank(1000, 'USD')] }));
    convertAmount.mockResolvedValue({ complete: false, baseAmount: null, status });
    const result = await service.getExtendedForecast();
    expect(result).toMatchObject({ hasCurrentBalance: false, balanceStatus: 'missing_exchange_rate', startingBalance: 0 });
    expect(result.summaries.base.endingBalance).toBe(result.summaries.base.netCashFlow);
  });

  it.each([null, '', 'invalid', Infinity])('withholds a partial balance when one account has invalid value %j', async value => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions')
      ? [] : [bank(10000), bank(value)] }));
    expect(await service.getExtendedForecast()).toMatchObject({ hasCurrentBalance: false, balanceStatus: 'incomplete', startingBalance: 0 });
  });

  it('accepts shekel aliases, preserves overdrafts and detects unknown currencies', async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions')
      ? [] : [bank(100.10, '₪'), bank(-50.05, 'NIS')] }));
    expect(await service.getExtendedForecast()).toMatchObject({ hasCurrentBalance: true, startingBalance: 50.05 });
    expect(convertAmount).not.toHaveBeenCalled();
    query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FROM transactions') ? [] : [bank(1000, '')] }));
    expect(await service.getExtendedForecast()).toMatchObject({ hasCurrentBalance: false, balanceStatus: 'incomplete' });
  });

  it('keeps accounts without snapshots visible and selects one latest cash snapshot per active bank', async () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`
        CREATE TABLE transactions(identifier TEXT, vendor TEXT, date TEXT, price REAL, status TEXT, category_type TEXT, category_definition_id INTEGER);
        CREATE TABLE category_definitions(id INTEGER, name TEXT, category_type TEXT);
        CREATE TABLE transaction_pairing_exclusions(transaction_identifier TEXT, transaction_vendor TEXT);
        CREATE TABLE investment_accounts(id INTEGER PRIMARY KEY, currency TEXT, account_type TEXT, is_active INTEGER);
        CREATE TABLE investment_holdings(id INTEGER PRIMARY KEY, account_id INTEGER, current_value REAL, as_of_date TEXT, holding_type TEXT);
        INSERT INTO investment_accounts VALUES (1, 'ILS', 'bank_balance', 1), (2, 'USD', 'bank_balance', 1),
          (3, 'ILS', 'bank_balance', 0), (4, 'ILS', 'savings', 1);
        INSERT INTO investment_holdings VALUES (1, 1, 9000, '2026-09-30', 'standard'),
          (2, 1, 9500, '2026-10-01', 'standard'), (3, 1, 10000, '2026-10-01', 'standard'),
          (4, 1, 50000, '2026-10-01', 'pikadon'), (5, 3, 50000, '2026-10-01', 'standard'),
          (6, 4, 50000, '2026-10-01', 'standard');
      `);
      query.mockImplementation(async (sql: string, params: any[] = []) => ({
        rows: sqlite.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
      }));
      expect(await service.getExtendedForecast()).toMatchObject({ hasCurrentBalance: false, balanceStatus: 'incomplete', startingBalance: 0 });
      sqlite.exec("INSERT INTO investment_holdings VALUES (7, 2, 1000, '2026-10-01', 'standard')");
      expect(await service.getExtendedForecast()).toMatchObject({ hasCurrentBalance: true, startingBalance: 13700 });
      sqlite.exec('DELETE FROM investment_accounts');
      expect(await service.getExtendedForecast()).toMatchObject({ hasCurrentBalance: false, balanceStatus: 'missing', startingBalance: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('uses the financial truth revision in the cache and forwards explicit refresh', async () => {
    process.env.NODE_ENV = 'development';
    await service.getExtendedForecast();
    await service.getExtendedForecast();
    expect(generate).toHaveBeenCalledTimes(1);
    snapshot.mockReturnValue({ truthRevision: 5 });
    generate.mockResolvedValue({ ...forecast(), truthRevision: 5 });
    await service.getExtendedForecast();
    expect(generate).toHaveBeenCalledTimes(2);
    await service.getExtendedForecast({ noCache: 'true' });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate).toHaveBeenLastCalledWith({ includeToday: false, forecastMonths: 6, verbose: false, noCache: true });
  });

  it('retries once when assumptions change during generation and rejects repeatedly stale responses', async () => {
    snapshot.mockReturnValue({ truthRevision: 5 });
    generate.mockResolvedValueOnce(forecast()).mockResolvedValueOnce({ ...forecast(), truthRevision: 5 });
    expect((await service.getExtendedForecast()).truthRevision).toBe(5);
    expect(generate).toHaveBeenCalledTimes(2);
    generate.mockResolvedValue(forecast());
    await expect(service.getExtendedForecast()).rejects.toThrow('Financial truth changed');
  });
});
