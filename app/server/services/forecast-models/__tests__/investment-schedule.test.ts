import { afterEach, describe, expect, it, vi } from 'vitest';

const { buildInvestmentSchedule, applyInvestmentSchedule } = require('../investment-schedule.js');
const engine = require('../../forecast.js')._internal;

const tx = (date: string, amount = -1000, extra: any = {}) => ({
  date, price: amount, identifier: `investment-${date}`, name: 'Broker contribution',
  vendor: 'bank', account_number: 'account-1', category_type: 'investment',
  category_definition_id: 9, category_name: 'Investments', category_name_en: 'Investments',
  ...extra,
});
const dates = (start: string, count: number) => Array.from({ length: count }, (_, index) => {
  const date = new Date(`${start}T12:00:00`);
  date.setDate(date.getDate() + index);
  return engine.formatDate(date);
});
const build = (rows: any[], start = '2026-04-01', count = 30, snapshot: any = {}) => {
  const now = new Date(`${start}T12:00:00`);
  now.setDate(now.getDate() - 1);
  return buildInvestmentSchedule(rows, dates(start, count), now, snapshot);
};
const total = (events: any[]) => events.reduce((sum, event) => sum + event.amount, 0);
const monthly = ['2026-01-07', '2026-02-07', '2026-03-07'].map(date => tx(date));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('investment schedules learned from transaction history', () => {
  it('places recurring contributions on their learned day with source metadata', () => {
    expect(build(monthly)).toEqual([
      expect.objectContaining({ date: '2026-04-07', amount: 1000, categoryDefinitionId: 9,
        category: 'Investments', transactionName: 'Broker contribution', vendor: 'bank', sourceKey: expect.any(String),
        stdDev: expect.any(Number) }),
    ]);
  });

  it('keeps sources in the same category separate by name, bank, and account', () => {
    const rows = [
      ...monthly,
      ...monthly.map(row => ({ ...row, name: 'קרן פנסיה', price: -200 })),
      ...monthly.map(row => ({ ...row, name: 'קרן השתלמות', price: -300 })),
      ...monthly.map(row => ({ ...row, vendor: 'second-bank', price: -400 })),
      ...monthly.map(row => ({ ...row, account_number: 'account-2', price: -500 })),
      ...monthly.map(row => ({ ...row, category_definition_id: 10, price: -600 })),
    ];
    const events = build(rows);
    expect(events).toHaveLength(6);
    expect(new Set(events.map(event => event.sourceKey)).size).toBe(6);
    expect(total(events)).toBe(3000);
  });

  it('carries each bank and source title through to the matching investment prediction', () => {
    const rows = [...monthly,
      ...monthly.map(row => ({ ...row, name: 'קרן פנסיה', price: -200, vendor: 'second-bank' })),
      ...monthly.map(row => ({ ...row, vendor: 'third-bank', price: -400 }))];
    const forecasts: any[] = [{ date: '2026-04-07', predictions: [], expectedIncome: 0, expectedExpenses: 0 }];
    const simulations = [{ date: '2026-04-07', monthKey: '2026-04', entries: [] }];
    applyInvestmentSchedule(forecasts, simulations, build(rows), engine);
    expect(forecasts[0].predictions).toEqual(expect.arrayContaining([
      expect.objectContaining({ transactionName: 'Broker contribution', vendor: 'bank', expectedAmount: 1000 }),
      expect.objectContaining({ transactionName: 'קרן פנסיה', vendor: 'second-bank', expectedAmount: 200 }),
      expect.objectContaining({ transactionName: 'Broker contribution', vendor: 'third-bank', expectedAmount: 400 }),
    ]));
    expect(forecasts[0].predictions).toHaveLength(3);
  });

  it('normalizes Unicode and punctuation without splitting the same source', () => {
    const rows = monthly.map((row, index) => ({ ...row,
      name: ['Ｂｒｏｋｅｒ contribution', 'broker-contribution', 'BROKER   CONTRIBUTION'][index],
    }));
    expect(total(build(rows))).toBe(1000);
    expect(build(rows)).toHaveLength(1);
  });

  it('aggregates transfers from one source on the same local day before learning amounts', () => {
    const rows = monthly.flatMap(row => [
      { ...row, price: -400, date: `${row.date}T08:00:00` },
      { ...row, price: -600, date: `${row.date}T17:00:00` },
    ]);
    expect(total(build(rows))).toBe(1000);
    expect(build(rows.slice(0, 4))).toEqual([]);
  });

  it('does not mix a one-time lump sum into recurring transfers in the same category', () => {
    expect(total(build([...monthly, tx('2026-03-25', -200000, { name: 'Property transfer' })]))).toBe(1000);
  });

  it('uses the last three amounts to resist an outlier and follow a sustained increase', () => {
    expect(total(build([tx('2026-01-07', -1000), tx('2026-02-07', -1100), tx('2026-03-07', -10000)])))
      .toBe(1100);
    expect(total(build([...monthly, tx('2026-04-07', -1400), tx('2026-05-07', -1400)], '2026-06-01')))
      .toBe(1400);
  });

  it('learns a sustained calendar-day change from the latest payments', () => {
    const events = build([...monthly, tx('2026-04-15'), tx('2026-05-15')], '2026-06-01');
    expect(events.map(event => event.date)).toEqual(['2026-06-15']);
  });

  it.each([
    { history: ['2023-11-30', '2023-12-31', '2024-01-31'], start: '2024-02-01', count: 29, expected: '2024-02-29' },
    { history: ['2025-11-30', '2025-12-31', '2026-01-31'], start: '2026-02-01', count: 28, expected: '2026-02-28' },
  ])('preserves month-end payments through February: $expected', ({ history, start, count, expected }) => {
    expect(build(history.map(date => tx(date)), start, count).map(event => event.date)).toEqual([expected]);
  });

  it('requires four observations for weekly transfers and forecasts each weekly event', () => {
    const rows = ['2026-03-05', '2026-03-12', '2026-03-19', '2026-03-26'].map(date => tx(date));
    expect(build(rows.slice(1))).toEqual([]);
    expect(build(rows).map(event => event.date))
      .toEqual(['2026-04-02', '2026-04-09', '2026-04-16', '2026-04-23', '2026-04-30']);
  });

  it('supports fortnightly and quarterly schedules without converting them to monthly', () => {
    const fortnightly = ['2026-02-19', '2026-03-05', '2026-03-19'].map(date => tx(date));
    expect(build(fortnightly).map(event => event.date)).toEqual(['2026-04-02', '2026-04-16', '2026-04-30']);
    const quarterly = ['2025-07-07', '2025-10-07', '2026-01-07'].map(date => tx(date));
    expect(build(quarterly, '2026-04-01', 91).map(event => event.date)).toEqual(['2026-04-07']);
  });

  it('skips already-paid and early cross-month occurrences', () => {
    expect(build([...monthly, tx('2026-04-07')], '2026-04-11', 20)).toEqual([]);
    const early = [...monthly, tx('2026-03-30')];
    expect(build(early)).toEqual([]);
    expect(total(build(early, '2026-05-01', 31))).toBe(1000);
  });

  it('learns withdrawals independently from contributions with the same source details', () => {
    const events = build([...monthly, ...monthly.map(row => ({ ...row, price: 300 }))]);
    expect(events.map(event => event.amount).sort((left, right) => left - right)).toEqual([-300, 1000]);
    expect(new Set(events.map(event => event.sourceKey)).size).toBe(2);
    expect(total(events)).toBe(700);
  });

  it('does not invent schedules from missing, sparse, irregular, or stale history', () => {
    expect(build([])).toEqual([]);
    expect(build(monthly.slice(0, 1))).toEqual([]);
    expect(build(monthly.slice(0, 2))).toEqual([]);
    expect(build(['2026-01-01', '2026-02-02', '2026-02-03', '2026-03-23'].map(date => tx(date)))).toEqual([]);
    expect(build(monthly, '2026-07-01')).toEqual([]);
    expect(total(build(monthly, '2026-05-01', 31))).toBe(1000);
  });

  it('ignores future evidence, invalid amounts, non-investments, and pikadon-related rows', () => {
    expect(total(build([...monthly, tx('2026-05-07', -999999), tx('bad-date'),
      tx('2026-03-20', NaN), tx('2026-03-21', 0)]))).toBe(1000);
    expect(build(monthly.map(row => ({ ...row, category_type: 'expense' })))).toEqual([]);
    expect(build(monthly.map(row => ({ ...row, is_pikadon_related: 1 })))).toEqual([]);
    expect(build([...monthly.slice(0, 2), tx('2026-04-07')])).toEqual([]);
  });

  it.each([
    { source: 'manual' }, { source: 'detected', confirmed: true },
    { source: 'legacy_subscription', confirmed: true },
    { source: 'detected', corrections: [{ action: 'override_pattern' }] },
    { source: 'detected', state: 'paused' }, { source: 'legacy_subscription', state: 'suppressed' },
  ])('preserves user control of protected categories: %j', extra => {
    const snapshot = { patterns: [{ categoryDefinitionId: 9, source: 'detected', state: 'active', ...extra }] };
    expect(build(monthly, '2026-04-01', 30, snapshot)).toEqual([]);
  });

  it.each(['detected', 'legacy_subscription'])('uses raw history for unconfirmed %s patterns despite excluded transaction keys', source => {
    const snapshot = {
      patterns: [{ categoryDefinitionId: 9, source, state: 'active', confirmed: false, corrections: [] }],
      excludedTransactionKeys: new Set(monthly.map(row => `${row.identifier}\u0000${row.vendor}`)),
    };
    expect(total(build(monthly, '2026-04-01', 30, snapshot))).toBe(1000);
  });
});

describe('new mortgage payment inference', () => {
  it.each(['דסק-משכנתא חיוב', 'Mortgage payment'])('infers a monthly payment from the specific description %s', name => {
    expect(build([tx('2026-03-10', -5469, { name })])).toEqual([
      expect.objectContaining({ date: '2026-04-10', amount: 5469, transactionName: name }),
    ]);
  });

  it.each(['Property transfer', 'Mortgage fee', 'Mortgage payoff', 'Mortgage insurance'])
    ('does not infer a monthly schedule from a single %s transaction', name => {
      expect(build([tx('2026-03-10', -5469, { name })])).toEqual([]);
    });

  it('uses the Israeli local payment date when a UTC timestamp crosses midnight', () => {
    vi.stubEnv('TZ', 'Asia/Jerusalem');
    const rows = [tx('2026-09-09T21:00:00.000Z', -5469, { name: 'דסק-משכנתא חיוב' })];
    expect(build(rows, '2026-10-01', 31).map(event => event.date)).toEqual(['2026-10-10']);
  });

  it('does not repeat stale one-off mortgage payments or classify a withdrawal as a payment', () => {
    expect(build([tx('2026-03-10', -5469, { name: 'Mortgage payment' })], '2026-07-01')).toEqual([]);
    expect(build([tx('2026-03-10', 5469, { name: 'Mortgage payment' })])).toEqual([]);
  });
});

describe('investment schedule forecast and simulation reconciliation', () => {
  const makeDay = (date: string) => ({
    date, expectedIncome: 5000, expectedExpenses: 100, expectedInvestments: 999,
    predictions: [
      { patternKey: 'salary', categoryType: 'income', incomeType: 'operating', probability: 1, probabilityWeightedAmount: 5000 },
      { patternKey: 'food', categoryType: 'expense', expenseType: 'operating', probability: 1, probabilityWeightedAmount: 100 },
      { patternKey: 'automatic-investment', categoryType: 'investment', probability: 1, probabilityWeightedAmount: 999 },
      { patternKey: 'saved-investment', categoryType: 'investment', probability: 1, probabilityWeightedAmount: 50, isUserResolvedPattern: true },
    ],
  });
  const makeSimulation = (date: string) => ({
    date, monthKey: date.slice(0, 7), entries: [
      { patternKey: 'salary', categoryType: 'income', incomeType: 'operating', probability: 1, avgAmount: 5000, stdDev: 0 },
      { patternKey: 'food', categoryType: 'expense', expenseType: 'operating', probability: 1, avgAmount: 100, stdDev: 0 },
      { patternKey: 'automatic-investment', categoryType: 'investment', probability: 1, avgAmount: 999, stdDev: 0 },
      { patternKey: 'saved-investment', categoryType: 'investment', probability: 1, avgAmount: 50, stdDev: 0, isUserResolvedPattern: true },
    ],
  });

  it('replaces automatic investments, preserves saved schedules, and nets contributions and withdrawals once', () => {
    const dailyForecasts: any[] = [makeDay('2026-04-07'), makeDay('2026-04-08')];
    const simulations: any[] = dailyForecasts.map(day => makeSimulation(day.date));
    const events = [
      { date: '2026-04-07', sourceKey: 'contribution', amount: 1000, categoryDefinitionId: 9,
        category: 'Investments', transactionName: 'Broker contribution', stdDev: 0 },
      { date: '2026-04-08', sourceKey: 'withdrawal', amount: -300, categoryDefinitionId: 9,
        category: 'Investments', transactionName: 'Broker withdrawal', stdDev: 0 },
    ];
    const refresh = vi.spyOn(engine, 'refreshForecastDayPredictions');
    applyInvestmentSchedule(dailyForecasts, simulations, events, engine);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(dailyForecasts.map(day => day.expectedInvestments)).toEqual([1050, -250]);
    for (const day of dailyForecasts) {
      expect(day).toMatchObject({ expectedIncome: 5000, expectedExpenses: 100, expectedCashFlow: 4900 });
      expect(day.predictions.some((prediction: any) => prediction.patternKey === 'automatic-investment')).toBe(false);
      expect(day.predictions.filter((prediction: any) => prediction.patternKey === 'saved-investment')).toHaveLength(1);
    }
    const injected = dailyForecasts.flatMap(day => day.predictions)
      .filter(prediction => prediction.categoryType === 'investment' && !prediction.isUserResolvedPattern);
    expect(injected.map(prediction => prediction.probabilityWeightedAmount)).toEqual([1000, -300]);
    const investmentEntries = simulations.flatMap(day => day.entries).filter(entry => entry.categoryType === 'investment');
    expect(investmentEntries.some(entry => entry.patternKey === 'automatic-investment')).toBe(false);
    expect(investmentEntries.filter(entry => entry.patternKey === 'saved-investment')).toHaveLength(2);
    expect(investmentEntries.filter(entry => entry.patternKey !== 'saved-investment')).toEqual([
      expect.objectContaining({ avgAmount: 1000, investmentDirection: 1 }),
      expect.objectContaining({ avgAmount: 300, investmentDirection: -1 }),
    ]);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const scenario = engine.simulateScenario(simulations, {});
    expect(scenario).toMatchObject({ totalInvestments: 800, totalIncome: 10000,
      totalExpenses: 200, totalCashFlow: 9800 });
    expect(scenario.dailyResults.map((day: any) => day.investments)).toEqual([1050, -250]);
  });

  it('clears unsupported automatic projections even when no schedule is inferred', () => {
    const day: any = makeDay('2026-04-07');
    const simulation: any = makeSimulation(day.date);
    applyInvestmentSchedule([day], [simulation], [], engine);
    expect(day.expectedInvestments).toBe(50);
    expect(day.predictions.filter((prediction: any) => prediction.categoryType === 'investment'))
      .toEqual([expect.objectContaining({ patternKey: 'saved-investment', isUserResolvedPattern: true })]);
    expect(simulation.entries.filter((entry: any) => entry.categoryType === 'investment'))
      .toEqual([expect.objectContaining({ patternKey: 'saved-investment' })]);
  });
});
