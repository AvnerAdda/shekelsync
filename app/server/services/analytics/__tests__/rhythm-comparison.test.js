import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let service;

beforeAll(async () => {
  const module = await import('../rhythm-comparison.js');
  service = module.default ?? module;
});

afterEach(() => {
  service.__resetDependencies();
});

let nextId = 1;
function row(day, price, overrides = {}) {
  const categoryId = overrides.category_id ?? 10;
  const type = overrides.category_type ?? (price < 0 ? 'expense' : 'income');
  return {
    identifier: `t${nextId++}`,
    vendor: 'max',
    name: overrides.name ?? `Shop ${categoryId}`,
    merchant_name: null,
    date: `${day}T10:00:00.000Z`,
    price,
    day,
    category_id: categoryId,
    category_type: type,
    stored_type: overrides.stored_type ?? type,
    category_definition_type: overrides.category_definition_type ?? type,
    category_name: overrides.category_name ?? `Category ${categoryId}`,
    category_name_en: null,
    category_name_fr: null,
    counted_as_income: overrides.counted_as_income ?? 1,
    capital_return: overrides.capital_return ?? 0,
    ...overrides,
  };
}

// ₪100 on the 2nd and ₪50 on the 20th of each past month; the current month runs hot.
function monthlyHistory(months) {
  return months.flatMap((month) => [row(`${month}-02`, -100), row(`${month}-20`, -50)]);
}

describe('rhythm comparison', () => {
  it('compares this month so far with past months at the same day', () => {
    const rows = [
      ...monthlyHistory(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']),
      row('2026-11-02', -100),
      row('2026-11-05', -400, { category_id: 20, category_name: 'Furniture' }),
      row('2026-11-12', -999), // after today: not shown
    ];

    const result = service.buildRhythmComparison({ rows, today: '2026-11-10', granularity: 'month' });

    expect(result.pace).toMatchObject({
      x: 10, current: 500, median: 100, status: 'above', deltaAmount: 400, deltaPercent: 400,
      typicalTotal: 150, projectedTotal: 550,
    });
    expect(result.points.find((point) => point.x === 10)).toMatchObject({ current: 500, previous: 100, median: 100 });
    expect(result.points.find((point) => point.x === 11).current).toBeNull();
    expect(result.drivers).toEqual([
      expect.objectContaining({ categoryId: 20, name: 'Furniture', current: 400, typical: 0, delta: 400 }),
    ]);
    expect(result.newMerchants).toEqual([{
      merchant: 'Shop 20', amount: 400, count: 1,
      category: { categoryId: 20, name: 'Furniture', nameEn: null, nameFr: null },
    }]);
    expect(result.periods.map((period) => [period.key, period.total])).toEqual([
      ['2026-05', 150], ['2026-06', 150], ['2026-07', 150], ['2026-08', 150], ['2026-09', 150], ['2026-10', 150],
      ['2026-11', 500],
    ]);
  });

  it('only compares with periods that every main account fully covers', () => {
    const rows = monthlyHistory(['2026-08', '2026-09', '2026-10']);
    const result = service.buildRhythmComparison({
      rows, today: '2026-11-10', granularity: 'month', coverageStart: '2026-08-15',
    });
    expect(result.periods.map((period) => period.key)).toEqual(['2026-09', '2026-10', '2026-11']);

    const tooShort = service.buildRhythmComparison({
      rows, today: '2026-11-10', granularity: 'month', coverageStart: '2026-10-15',
    });
    expect(tooShort.pace.status).toBe('insufficient');
    expect(tooShort.drivers).toEqual([]);
  });

  it('ignores small institutions when finding where full history starts', () => {
    expect(service.resolveCoverageStart([
      { vendor: 'discount', first_day: '2026-05-03', recent_count: 70 },
      { vendor: 'max', first_day: '2026-03-24', recent_count: 260 },
      { vendor: 'visaCal', first_day: '2026-09-10', recent_count: 9 },
    ])).toBe('2026-05-03');
  });

  it('counts income by its category, not by a stale stored type, and flags the mismatch', () => {
    const salary = (day, price) => row(day, price, {
      category_id: 90, category_name: 'משכורת', category_type: 'income', category_definition_type: 'income',
    });
    const rows = [
      salary('2026-09-05', 17000), salary('2026-10-05', 17000),
      salary('2026-11-05', 17000),
      { ...salary('2026-11-08', 7000), stored_type: 'expense' },
      row('2026-11-06', 500, { category_id: 91, category_type: 'income', capital_return: 1 }),
      row('2026-11-07', 300, { category_id: 92, category_type: 'income', counted_as_income: 0 }),
      row('2026-11-07', -80),
    ];

    const result = service.buildRhythmComparison({
      rows, today: '2026-11-10', granularity: 'month', metric: 'income', coverageStart: '2026-09-01',
    });

    expect(result.pace).toMatchObject({ current: 24000, median: 17000, status: 'above' });
    expect(result.checks.find((check) => check.type === 'type_mismatch')).toMatchObject({
      count: 1,
      transactions: [expect.objectContaining({ amount: 7000, storedType: 'expense', categoryType: 'income' })],
    });
  });

  it('leaves recurring payments out of the everyday view', () => {
    const rows = [
      ...['2026-08', '2026-09', '2026-10', '2026-11'].map((month) => row(`${month}-01`, -6000, { name: 'Mortgage' })),
      ...monthlyHistory(['2026-08', '2026-09', '2026-10']),
      row('2026-11-02', -100),
    ];
    const isRecurring = vi.fn((transaction) => transaction.name === 'Mortgage');

    const all = service.buildRhythmComparison({ rows, today: '2026-11-10', granularity: 'month' });
    const everyday = service.buildRhythmComparison({
      rows, today: '2026-11-10', granularity: 'month', scope: 'everyday', isRecurring, coverageStart: '2026-08-01',
    });

    expect(all.pace.current).toBe(6100);
    expect(everyday.pace).toMatchObject({ current: 100, median: 100, status: 'within' });
  });

  it('compares weeks from Sunday and marks unusual days against the same weekday', () => {
    // Every Wednesday (and the following Thursday) has ₪100, except one ₪900 Wednesday.
    const wednesdays = Array.from({ length: 10 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 8, 2 + index * 7)).toISOString().slice(0, 10);
      return row(date, -100);
    });
    const rows = [...wednesdays, row('2026-11-11', -900)];

    const week = service.buildRhythmComparison({ rows, today: '2026-11-11', granularity: 'week' });
    expect(week.current).toMatchObject({ start: '2026-11-08', end: '2026-11-14' });
    expect(week.pace).toMatchObject({ x: 4, current: 900, median: 100, status: 'above' });

    const day = service.buildRhythmComparison({ rows, today: '2026-11-11', granularity: 'day' });
    const today = day.days.at(-1);
    expect(today).toMatchObject({ date: '2026-11-11', weekday: 3, value: 900, median: 100, unusual: true });
    expect(today.transactions[0]).toMatchObject({ amount: 900 });
    expect(day.days.filter((entry) => entry.unusual)).toHaveLength(1);
    expect(day.unusualDays).toBe(1);
  });

  it('flags a merchant filed under a different category than usual, and accounts that stopped syncing', () => {
    const coffee = (day, categoryId, categoryName) => row(day, -20, { name: 'Aroma', category_id: categoryId, category_name: categoryName });
    const rows = [
      coffee('2026-08-01', 5, 'Restaurants'), coffee('2026-08-15', 5, 'Restaurants'), coffee('2026-09-01', 5, 'Restaurants'),
      coffee('2026-11-09', 3, 'Groceries'),
    ];
    const result = service.buildRhythmComparison({
      rows,
      today: '2026-11-11',
      accounts: [
        { vendor: 'visaCal', nickname: 'Cal', last_scrape_success: '2026-11-08 07:25:28', last_scrape_status: 'failed' },
        { vendor: 'max', nickname: 'Max', last_scrape_success: '2026-11-11 07:26:23', last_scrape_status: 'success' },
      ],
    });

    expect(result.checks).toEqual([
      expect.objectContaining({ type: 'stale_account', vendor: 'visaCal', days: 3, lastStatus: 'failed' }),
      expect.objectContaining({
        type: 'category_drift', merchant: 'Aroma', date: '2026-11-09',
        category: expect.objectContaining({ categoryId: 3 }),
        usualCategory: expect.objectContaining({ categoryId: 5, count: 3 }),
      }),
    ]);
  });

  it.each([
    { today: ['2026-11-11'] },
    { today: ['2026-11-11', '2026-11-12'] },
    { today: [] },
    { today: { value: '2026-11-11' } },
    { today: 20261111 },
  ])('rejects a non-string date before querying transactions: $today', async ({ today }) => {
    const query = vi.fn();
    service.__setDatabase({ query });

    await expect(service.getRhythmComparison({ today })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('reads counted spending only and rejects unknown options', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    service.__setDatabase({ query });

    await service.getRhythmComparison({ granularity: 'week', today: '2026-11-11' });
    const sql = query.mock.calls.map(([text]) => String(text)).find((text) => text.includes('AS stored_type'));
    expect(sql).toContain('transaction_pairing_exclusions');
    expect(sql).toContain('is_pikadon_related');
    expect(sql).toContain('פרעון כרטיס אשראי');

    await expect(service.getRhythmComparison({ granularity: 'year' })).rejects.toMatchObject({ status: 400 });
    await expect(service.getRhythmComparison({ today: '11/11/2026' })).rejects.toMatchObject({ status: 400 });
  });
});
