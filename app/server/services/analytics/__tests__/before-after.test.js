import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let service;

beforeAll(async () => {
  const module = await import('../before-after.js');
  service = module.default ?? module;
});

afterEach(() => {
  service.__resetDependencies();
});

const CATEGORIES = {
  dining: { category_id: 10, category_name: 'Restaurants', spending_category: 'reward', variability_type: 'variable' },
  rent: { category_id: 20, category_name: 'Rent', spending_category: 'essential', variability_type: 'fixed' },
  insurance: { category_id: 30, category_name: 'Insurance', spending_category: 'stability', variability_type: 'fixed' },
  gym: { category_id: 40, category_name: 'Gym', spending_category: 'reward', variability_type: 'fixed' },
  fees: { category_id: 50, category_name: 'עמלות בנק וכרטיס', category_name_en: 'Bank & Card Fees', spending_category: null, variability_type: null },
  salary: { category_id: 60, category_name: 'Salary', category_type: 'income' },
  invest: { category_id: 70, category_name: 'Brokerage', category_type: 'investment' },
};

let nextId = 1;
function row(day, price, category, overrides = {}) {
  return {
    identifier: `t${nextId++}`,
    vendor: 'synthetic-bank',
    name: overrides.name ?? `Shop ${category.category_id}`,
    merchant_name: null,
    price,
    day,
    category_type: category.category_type ?? 'expense',
    category_name_en: null,
    category_name_fr: null,
    parent_name: null,
    counted_as_income: 1,
    capital_return: 0,
    ...category,
    ...overrides,
  };
}

const BEFORE = ['2026-02', '2026-03', '2026-04'];
const AFTER = ['2026-08', '2026-09', '2026-10'];
const BASE = { frontierDay: '2026-05-10', today: '2026-11-19', coverageStart: '2026-02-03' };

// Dining is spread over ten meals, so no single one is a large one-off purchase.
function month(monthKey, { dining, income = 10000, rent = 4000 }) {
  return [
    row(`${monthKey}-01`, income, CATEGORIES.salary),
    row(`${monthKey}-02`, -rent, CATEGORIES.rent),
    ...Array.from({ length: 10 }, (_, index) => row(`${monthKey}-${String(10 + index)}`, -dining / 10, CATEGORIES.dining)),
  ];
}

describe('before/after windows', () => {
  it('compares equal full-month windows and skips the mixed first-sync month', () => {
    const windows = service.resolveWindows(BASE);
    expect(windows).toMatchObject({ status: 'ready', months: 3, frontierMonth: '2026-05', fullMonthsAfter: 5, fullMonthsBefore: 3 });
    expect(windows.before).toEqual({ months: BEFORE, start: '2026-02-01', end: '2026-04-30' });
    expect(windows.after).toEqual({ months: AFTER, start: '2026-08-01', end: '2026-10-31' });
  });

  it('caps both sides at six months', () => {
    const windows = service.resolveWindows({ frontierDay: '2025-06-15', today: '2026-11-19', coverageStart: '2024-01-01' });
    expect(windows.months).toBe(6);
    expect(windows.before.months).toEqual(['2024-12', '2025-01', '2025-02', '2025-03', '2025-04', '2025-05']);
    expect(windows.after.months).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });

  it('waits until two full months exist after the first sync', () => {
    const windows = service.resolveWindows({ frontierDay: '2026-10-05', today: '2026-11-19', coverageStart: '2026-07-01' });
    expect(windows).toMatchObject({ status: 'waiting', months: 0, readyOn: '2027-01-01', before: null, after: null });
  });

  it('reports missing history when accounts do not cover two months before the first sync', () => {
    const windows = service.resolveWindows({ frontierDay: '2026-05-10', today: '2026-11-19', coverageStart: '2026-04-01' });
    expect(windows.status).toBe('no_history');
  });

  it('only counts before-months that the accounts cover from (nearly) their first day', () => {
    expect(service.resolveWindows({ ...BASE, coverageStart: '2026-02-09' }).before.months).toEqual(BEFORE);
    expect(service.resolveWindows({ ...BASE, coverageStart: '2026-02-20' }).before.months).toEqual(['2026-03', '2026-04']);
  });
});

describe('before/after metrics', () => {
  it('compares only controllable spending, with medians, and as a share of income', () => {
    const rows = [
      ...month('2026-02', { dining: 2000 }),
      ...month('2026-03', { dining: 2200, rent: 4500 }),
      ...month('2026-04', { dining: 2100 }),
      // The first-sync month is not compared.
      ...month('2026-05', { dining: 9000 }),
      ...month('2026-08', { dining: 1500 }),
      ...month('2026-09', { dining: 6000 }), // one trip abroad must not decide the result
      ...month('2026-10', { dining: 1400 }),
      row('2026-09-03', -900, CATEGORIES.insurance),
      // A single purchase of 10% of income or more is shown apart, not compared.
      row('2026-08-21', -5000, CATEGORIES.dining, { name: 'Sofa Store' }),
    ];

    const result = service.buildBeforeAfter({ ...BASE, rows });

    expect(result.status).toBe('ready');
    expect(result.metrics.controllableSpend).toMatchObject({
      before: 2100, after: 1500, delta: -600, deltaPercent: -29, verdict: 'better', shareBefore: 21, shareAfter: 15,
    });
    expect(result.monthly.map((entry) => [entry.month, entry.phase, entry.controllableSpend, entry.largeOneOffs, entry.neededSpend])).toEqual([
      ['2026-02', 'before', 2000, 0, 4000],
      ['2026-03', 'before', 2200, 0, 4500],
      ['2026-04', 'before', 2100, 0, 4000],
      ['2026-08', 'after', 1500, 5000, 4000],
      ['2026-09', 'after', 6000, 0, 4900],
      ['2026-10', 'after', 1400, 0, 4000],
    ]);
    expect(result.metrics.controllableSpend.largeOneOffs).toMatchObject({
      threshold: 1000, beforeTotal: 0, afterTotal: 5000, beforeCount: 0, afterCount: 1,
      items: [expect.objectContaining({ day: '2026-08-21', phase: 'after', name: 'Sofa Store', amount: 5000, categoryId: 10 })],
    });
    expect(result.categories.find((category) => category.key === '20')).toMatchObject({ needed: true, defaultReason: 'essential' });
    expect(result.categories.find((category) => category.key === '30')).toMatchObject({ needed: true, defaultReason: 'stability' });
    expect(result.categories.find((category) => category.key === '10')).toMatchObject({ needed: false, defaultReason: null });
  });

  it('reports a change for the worse just like an improvement', () => {
    const rows = [
      ...month('2026-02', { dining: 1000 }), ...month('2026-03', { dining: 1100 }), ...month('2026-04', { dining: 1050 }),
      ...month('2026-08', { dining: 1600 }), ...month('2026-09', { dining: 1700 }), ...month('2026-10', { dining: 1650 }),
    ];
    const { metrics } = service.buildBeforeAfter({ ...BASE, rows });
    expect(metrics.controllableSpend).toMatchObject({ before: 1050, after: 1650, verdict: 'worse' });
    expect(metrics.kept).toMatchObject({ before: 4950, after: 4350, verdict: 'worse', rateBefore: 49.5, rateAfter: 43.5 });
  });

  it('calls changes within the usual month-to-month swing unchanged', () => {
    const rows = [
      ...month('2026-02', { dining: 1000 }), ...month('2026-03', { dining: 1800 }), ...month('2026-04', { dining: 1400 }),
      ...month('2026-08', { dining: 1100 }), ...month('2026-09', { dining: 1300 }), ...month('2026-10', { dining: 1700 }),
    ];
    const { metrics } = service.buildBeforeAfter({ ...BASE, rows });
    expect(metrics.controllableSpend).toMatchObject({ before: 1400, after: 1300, threshold: 400, verdict: 'unchanged' });
  });

  it('treats a fixed cost as a choice, and lets the user decide what counts as needed', () => {
    const rows = [
      ...month('2026-02', { dining: 2000 }), ...month('2026-03', { dining: 2000 }), ...month('2026-04', { dining: 2000 }),
      ...month('2026-08', { dining: 2000 }), ...month('2026-09', { dining: 2000 }), ...month('2026-10', { dining: 2000 }),
      ...BEFORE.map((m) => row(`${m}-05`, -300, CATEGORIES.gym)),
    ];
    const byDefault = service.buildBeforeAfter({ ...BASE, rows });
    expect(byDefault.categories.find((category) => category.key === '40')).toMatchObject({ needed: false, defaultReason: null });
    expect(byDefault.metrics.controllableSpend).toMatchObject({ before: 2300, after: 2000, verdict: 'better' });

    const overridden = service.buildBeforeAfter({ ...BASE, rows, overrides: { 40: true } });
    expect(overridden.categories.find((category) => category.key === '40')).toMatchObject({ needed: true, overridden: true });
    expect(overridden.metrics.controllableSpend).toMatchObject({ before: 2000, after: 2000, verdict: 'unchanged' });
  });

  it('classifies categories without a saved mapping from their names', () => {
    const unmapped = { category_id: 80, category_name: 'סופרמרקט', category_name_en: 'Supermarket', spending_category: null, variability_type: null };
    const rows = [...BEFORE, ...AFTER].map((m) => row(`${m}-08`, -1500, unmapped));
    const result = service.buildBeforeAfter({ ...BASE, rows });
    expect(result.categories[0]).toMatchObject({ key: '80', needed: true, defaultReason: 'essential' });
  });

  it('tracks money kept, investments and fees per month', () => {
    const rows = [
      ...month('2026-02', { dining: 1000 }), ...month('2026-03', { dining: 1000 }), ...month('2026-04', { dining: 1000 }),
      ...month('2026-08', { dining: 1000 }), ...month('2026-09', { dining: 1000 }), ...month('2026-10', { dining: 1000 }),
      ...BEFORE.map((m) => row(`${m}-28`, -45, CATEGORIES.fees)),
      ...AFTER.map((m) => row(`${m}-28`, -15, { category_id: null, category_name: null, spending_category: null }, { name: 'עמלת פעולה' })),
      ...AFTER.map((m) => row(`${m}-15`, -2000, CATEGORIES.invest)),
      row('2026-09-20', -30, CATEGORIES.dining, { name: 'Coffee shop' }), // not a fee
    ];
    const result = service.buildBeforeAfter({ ...BASE, rows });
    expect(result.metrics.fees).toMatchObject({ before: 45, after: 15, verdict: 'better' });
    expect(result.monthly.find((entry) => entry.month === '2026-08')).toMatchObject({ invested: 2000, kept: 4985 });
    expect(result.metrics.income).toMatchObject({ before: 10000, after: 10000, delta: 0 });
  });

  it('lists subscriptions that stopped after the first sync and new ones that started', () => {
    const streaming = { category_id: 90, category_name: 'Streaming', spending_category: 'reward', variability_type: 'fixed' };
    const rows = [
      ...month('2026-02', { dining: 1000 }), ...month('2026-03', { dining: 1000 }), ...month('2026-04', { dining: 1000 }),
      ...month('2026-08', { dining: 1000 }), ...month('2026-09', { dining: 1000 }), ...month('2026-10', { dining: 1000 }),
      // Ran until the first sync, then cancelled.
      ...['2026-02', '2026-03', '2026-04', '2026-05'].map((m) => row(`${m}-07`, -59.9, streaming, { merchant_name: 'StreamCo' })),
      // Started after the first sync and still running.
      ...['2026-08', '2026-09', '2026-10', '2026-11'].map((m) => row(`${m}-03`, -39, streaming, { merchant_name: 'MusicCo' })),
      // Stopped long before the first sync: not credited.
      row('2025-12-07', -25, streaming, { merchant_name: 'OldCo' }),
      // Still charged recently: not stopped.
      ...['2026-02', '2026-03', '2026-04', '2026-09', '2026-10'].map((m) => row(`${m}-11`, -80, streaming, { merchant_name: 'PhoneCo' })),
      // Only two charges before the first sync: too short a run to credit a cancellation.
      ...['2026-03', '2026-04'].map((m) => row(`${m}-09`, -45, streaming, { merchant_name: 'ShortCo' })),
      // Needed spending and payments as large as a one-off are not subscriptions.
      ...['2026-02', '2026-03', '2026-04'].map((m) => row(`${m}-06`, -150, CATEGORIES.insurance, { merchant_name: 'InsureCo' })),
      ...['2026-02', '2026-03', '2026-04'].map((m) => row(`${m}-08`, -3000, streaming, { merchant_name: 'LenderCo' })),
    ];

    const { subscriptions } = service.buildBeforeAfter({ ...BASE, rows }).metrics;
    expect(subscriptions.stopped).toEqual([
      { name: 'StreamCo', monthlyAmount: 59.9, yearlyAmount: 718.8, lastCharge: '2026-05-07' },
    ]);
    expect(subscriptions.started).toEqual([
      { name: 'MusicCo', monthlyAmount: 39, yearlyAmount: 468, firstCharge: '2026-08-03' },
    ]);
    expect(subscriptions).toMatchObject({ stoppedYearly: 718.8, startedYearly: 468, netYearly: 250.8, verdict: 'better' });
  });

  it('explains why there is nothing to compare yet', () => {
    expect(service.buildBeforeAfter({ today: '2026-11-19' })).toMatchObject({ status: 'no_sync', metrics: null });
    expect(service.buildBeforeAfter({ frontierDay: '2026-10-05', today: '2026-11-19', coverageStart: '2026-07-01' }))
      .toMatchObject({ status: 'waiting', metrics: null, windows: { readyOn: '2027-01-01' } });
  });
});

function createDatabase({ firstSuccess = null, settings = null, installDate = null } = {}) {
  const state = { settings, writes: [] };
  return {
    state,
    async query(sql, params = []) {
      if (/FROM before_after_settings/.test(sql)) return { rows: state.settings ? [state.settings] : [] };
      if (/INSERT INTO before_after_settings/.test(sql)) {
        state.settings = { first_sync_at: params[0], category_overrides: params[1] };
        state.writes.push(state.settings);
        return { rows: [] };
      }
      if (/FROM scrape_events/.test(sql)) return { rows: [{ earliest: firstSuccess }] };
      if (/FROM license/.test(sql)) return { rows: installDate ? [{ earliest: installDate }] : [] };
      if (/GROUP BY t.vendor/.test(sql)) return { rows: [{ vendor: 'synthetic-bank', first_day: '2026-02-01', recent_count: 40 }] };
      if (/FROM transactions t/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

describe('before/after first-sync date', () => {
  it('saves the first successful sync so deleting an account cannot move it', async () => {
    const db = createDatabase({ firstSuccess: '2026-05-10 08:00:00' });
    service.__setDatabase(db);
    const first = await service.getBeforeAfter({ today: '2026-11-19' });
    expect(first.frontier).toEqual({ day: '2026-05-10', source: 'sync' });
    expect(db.state.writes).toHaveLength(1);

    // The account and its sync history were deleted and re-added later.
    service.__setDatabase(Object.assign(createDatabase({ firstSuccess: '2026-09-01 08:00:00', settings: db.state.settings }), {}));
    const later = await service.getBeforeAfter({ today: '2026-11-19' });
    expect(later.frontier).toEqual({ day: '2026-05-10', source: 'saved' });
    expect(later.status).toBe('ready');
  });

  it('falls back to the install date when no successful sync is on record', async () => {
    service.__setDatabase(createDatabase({ installDate: '2026-05-12 09:00:00' }));
    const result = await service.getBeforeAfter({ today: '2026-11-19' });
    expect(result.frontier).toEqual({ day: '2026-05-12', source: 'install' });
  });

  it('validates category overrides', async () => {
    const db = createDatabase({ firstSuccess: '2026-05-10 08:00:00' });
    service.__setDatabase(db);
    await expect(service.updateCategoryOverrides({ overrides: { abc: true } })).rejects.toMatchObject({ status: 400 });
    await expect(service.updateCategoryOverrides({ overrides: { 10: 'yes' } })).rejects.toMatchObject({ status: 400 });
    await expect(service.updateCategoryOverrides({ overrides: { 10: true, none: false } })).resolves.toEqual({ overrides: { 10: true, none: false } });
    expect(JSON.parse(db.state.settings.category_overrides)).toEqual({ 10: true, none: false });
  });
});
