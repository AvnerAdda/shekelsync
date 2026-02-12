import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../behavioral.js', () => ({
  getBehavioralPatterns: vi.fn(),
}));

import { getBehavioralPatterns } from '../behavioral.js';

let questsService;

function normalizeSql(sql) {
  return String(sql || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(handler, text, params) {
  if (typeof handler.match === 'function') {
    return handler.match(text, params);
  }
  if (handler.match instanceof RegExp) {
    return handler.match.test(text);
  }
  return text.includes(String(handler.match));
}

function createDbClient(handlers = []) {
  return {
    query: vi.fn(async (sql, params = []) => {
      const text = normalizeSql(sql);
      for (const handler of handlers) {
        if (!matches(handler, text, params)) continue;
        return typeof handler.result === 'function'
          ? handler.result(text, params)
          : handler.result;
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

const CLEANUP_HANDLERS = [
  { match: "SELECT name, type, sql, tbl_name FROM sqlite_master", result: { rows: [] } },
  {
    match: (text) => text.includes("SELECT name, sql FROM sqlite_master") && text.includes("type = 'trigger'"),
    result: { rows: [] },
  },
  { match: "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'smart_action_items'", result: { rows: [] } },
  {
    match: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'action_item_history'",
    result: { rows: [{ sql: 'CREATE TABLE action_item_history (id INTEGER)' }] },
  },
  { match: "SELECT name, type, sql FROM sqlite_master WHERE sql LIKE '%smart_action_items_old%'", result: { rows: [] } },
  { match: /DROP TRIGGER IF EXISTS/i, result: { rows: [] } },
  { match: /CREATE TRIGGER IF NOT EXISTS update_smart_action_items_timestamp/i, result: { rows: [] } },
  { match: /CREATE TRIGGER IF NOT EXISTS log_smart_action_item_status_change/i, result: { rows: [] } },
];

function withCleanupHandlers(handlers = []) {
  return [...handlers, ...CLEANUP_HANDLERS];
}

function setMockDatabase(client) {
  questsService.__setDatabase({
    getClient: vi.fn().mockResolvedValue(client),
    query: vi.fn(),
  });
}

beforeAll(async () => {
  const questsModule = await import('../quests.js');
  questsService = questsModule.default;
});

afterEach(() => {
  if (questsService) {
    questsService.__resetDatabase();
  }
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('quest helpers coverage', () => {
  it('covers median and number coercion helpers', () => {
    const { median, coerceNumber } = questsService._internal;
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);

    expect(coerceNumber('12.5')).toBe(12.5);
    expect(coerceNumber('bad')).toBe(0);
  });

  it('covers occurrence, duration and baseline calculations', () => {
    const {
      resolveAvgOccurrencesPerWeek,
      resolveAvgOccurrencesPerMonth,
      resolveQuestDurationDays,
      estimateMonthlySpend,
      computeBaselineSpend,
      isBaselineMeaningful,
    } = questsService._internal;

    expect(resolveAvgOccurrencesPerWeek({ avgOccurrencesPerWeek: 2 })).toBe(2);
    expect(resolveAvgOccurrencesPerWeek({ avgOccurrencesPerMonth: 8.66 })).toBeCloseTo(2, 2);
    expect(resolveAvgOccurrencesPerMonth({ avgOccurrencesPerMonth: 9 })).toBe(9);
    expect(resolveAvgOccurrencesPerMonth({ avgOccurrencesPerWeek: 3 })).toBeCloseTo(12.99, 2);

    expect(resolveQuestDurationDays({ patternType: 'monthly' })).toBe(30);
    expect(resolveQuestDurationDays({ patternType: 'weekly' })).toBe(7);

    expect(estimateMonthlySpend({ avgOccurrencesPerMonth: 5, avgAmount: 20 })).toBe(100);
    expect(computeBaselineSpend({ avgOccurrencesPerWeek: 2, avgOccurrencesPerMonth: 8, avgAmount: 100 }, 7)).toBe(200);
    expect(computeBaselineSpend({ avgOccurrencesPerWeek: 2, avgOccurrencesPerMonth: 8, avgAmount: 100 }, 30)).toBe(800);

    expect(isBaselineMeaningful(149, 7)).toBe(false);
    expect(isBaselineMeaningful(150, 7)).toBe(true);
    expect(isBaselineMeaningful(399, 30)).toBe(false);
    expect(isBaselineMeaningful(400, 30)).toBe(true);
  });

  it('covers stale pattern and category resolution helpers', () => {
    const { isPatternStale, normalizeCategoryKey, resolveCategoryId } = questsService._internal;
    const categoryIdByName = new Map([
      ['dining', 11],
      ['restaurants', 22],
    ]);

    expect(isPatternStale({ patternType: 'weekly', daysSinceLastOccurrence: 22 })).toBe(true);
    expect(isPatternStale({ patternType: 'monthly', daysSinceLastOccurrence: 60 })).toBe(false);
    expect(isPatternStale({ patternType: 'monthly', daysSinceLastOccurrence: 61 })).toBe(true);
    expect(isPatternStale({ patternType: 'bi-monthly', daysSinceLastOccurrence: 91 })).toBe(true);

    expect(normalizeCategoryKey('  ReStAuRaNtS ')).toBe('restaurants');
    expect(normalizeCategoryKey('')).toBe('');

    expect(resolveCategoryId({ categoryDefinitionId: 9 }, categoryIdByName)).toBe(9);
    expect(resolveCategoryId({ categoryName: 'Dining' }, categoryIdByName)).toBe(11);
    expect(resolveCategoryId({ categoryNameEn: 'Restaurants' }, categoryIdByName)).toBe(22);
    expect(resolveCategoryId({ category: 'Unknown' }, categoryIdByName)).toBe(null);
  });

  it('covers reduction, days remaining and period stability helpers', () => {
    const { computeReductionPct, getDaysRemainingInMonth, computePeriodStability } = questsService._internal;

    expect(computeReductionPct({ coefficientOfVariation: 0.9, confidence: 0.9, monthsOfHistory: 6 })).toBe(18);
    expect(computeReductionPct({ coefficientOfVariation: 0.2, confidence: 0.1, monthsOfHistory: 1, patternType: 'sporadic' })).toBe(5);
    expect(computeReductionPct({ coefficientOfVariation: 5, confidence: 1, monthsOfHistory: 36 })).toBeLessThanOrEqual(20);

    expect(getDaysRemainingInMonth(new Date(2026, 1, 10))).toBe(19);
    expect(getDaysRemainingInMonth(new Date(2026, 1, 28))).toBe(1);

    const stable = computePeriodStability([200, 210, 195, 205, 198, 202]);
    expect(stable.isStable).toBe(true);
    expect(stable.spendShare).toBe(1);

    const unstable = computePeriodStability([0, 0, 0, 1000, 0, 1000]);
    expect(unstable.isStable).toBe(false);

    const empty = computePeriodStability([]);
    expect(empty).toMatchObject({ isStable: false, mean: 0, stdDev: 0 });
  });

  it('covers week/month key and totals builders', () => {
    const {
      getWeekStart,
      getWeekKey,
      getMonthKey,
      buildWeekKeys,
      buildMonthKeys,
      buildTotalsByCategory,
    } = questsService._internal;

    expect(getWeekStart('not-a-date')).toBe(null);
    expect(getWeekKey('not-a-date')).toBe(null);
    expect(getMonthKey('not-a-date')).toBe(null);

    const sampleDate = new Date(2026, 1, 11);
    const weekStart = getWeekStart(sampleDate);
    expect(weekStart.getDay()).toBe(1);
    expect(weekStart.getHours()).toBe(0);
    expect(getWeekKey(sampleDate)).toBe(weekStart.toISOString().slice(0, 10));
    expect(getMonthKey(sampleDate)).toBe('2026-02');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T12:00:00Z'));
    const weekKeys = buildWeekKeys(3);
    const monthKeys = buildMonthKeys(3);
    expect(weekKeys).toHaveLength(3);
    expect(monthKeys).toEqual(['2025-12', '2026-01', '2026-02']);
    vi.useRealTimers();

    const totals = buildTotalsByCategory(
      [
        { category_definition_id: 1, date: '2026-02-05', price: -100 },
        { category_definition_id: 1, date: '2026-03-05', price: -50 },
        { category_definition_id: 2, date: '2026-03-06', price: -20 },
        { category_definition_id: null, date: '2026-03-06', price: -999 },
      ],
      ['2026-02', '2026-03'],
      getMonthKey,
      [1, 2, 3],
    );

    expect(totals.get(1)).toEqual([100, 50]);
    expect(totals.get(2)).toEqual([0, 20]);
    expect(totals.get(3)).toEqual([0, 0]);
  });

  it('covers exclusion, level, points and difficulty helpers', () => {
    const {
      isExcludedCategoryName,
      isExcludedMerchant,
      calculateLevel,
      calculateQuestPoints,
      determineQuestDifficulty,
    } = questsService._internal;

    expect(isExcludedCategoryName('פרעון כרטיס אשראי', null)).toBe(true);
    expect(isExcludedCategoryName('Rent', 'Rent')).toBe(true);
    expect(isExcludedCategoryName('Groceries', 'Groceries')).toBe(false);

    expect(isExcludedMerchant('Supermarket Big')).toBe(true);
    expect(isExcludedMerchant('')).toBe(true);
    expect(isExcludedMerchant('Aroma Cafe')).toBe(false);

    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(100)).toBe(2);
    expect(calculateLevel(5200)).toBe(10);

    expect(calculateQuestPoints(7, 'easy', 0)).toBe(50);
    expect(calculateQuestPoints(30, 'medium', 25)).toBe(450);
    expect(calculateQuestPoints(365, 'hard', 25)).toBe(2000);

    expect(determineQuestDifficulty(5, 0.95)).toBe('easy');
    expect(determineQuestDifficulty(15, 0.8)).toBe('medium');
    expect(determineQuestDifficulty(35, 0.4)).toBe('hard');
  });

  it('covers quest text parameter rebuilding for each known action type', () => {
    const { buildQuestTextParams } = questsService._internal;

    expect(
      buildQuestTextParams(
        'quest_reduce_spending',
        { baseline_period: 'month', reduction_pct: 15, baseline_amount: 900, target_amount: 765 },
        'Dining',
        'en',
      ),
    ).toMatchObject({ categoryName: 'Dining', reductionPct: 15, baseline: 900, target: 765 });

    expect(
      buildQuestTextParams(
        'quest_budget_adherence',
        { budget_limit: 1000, remaining: 200, days_remaining: 6 },
        'Groceries',
        'en',
      ),
    ).toMatchObject({ categoryName: 'Groceries', limit: 1000, remaining: 200, daysRemaining: 6 });

    expect(
      buildQuestTextParams(
        'quest_set_budget',
        { avg_monthly: 450, min_amount: 200, max_amount: 700, suggested_budget: 500 },
        'Dining',
        'en',
      ),
    ).toMatchObject({ categoryName: 'Dining', suggestedBudget: 500 });

    expect(
      buildQuestTextParams(
        'quest_reduce_fixed_cost',
        { current_amount: 320 },
        'Subscriptions',
        'en',
      ),
    ).toMatchObject({ categoryName: 'Subscriptions', avgAmount: 320 });

    expect(
      buildQuestTextParams('quest_savings_target', { target_amount: 800 }, null, 'en'),
    ).toMatchObject({ savingsTarget: 800 });

    expect(
      buildQuestTextParams(
        'quest_merchant_limit',
        { merchant_name: 'Cafe', target_visits: 4, baseline_visits: 8, avg_transaction: 30 },
        null,
        'en',
      ),
    ).toMatchObject({ merchantName: 'Cafe', potentialSavings: 120 });

    expect(
      buildQuestTextParams(
        'quest_weekend_limit',
        { target_weekend_spend: 350, avg_weekend_spend: 500 },
        null,
        'en',
      ),
    ).toMatchObject({ targetAmount: 350, avgWeekendSpend: 500 });

    expect(buildQuestTextParams('unknown_action', {}, null, 'en')).toBe(null);
  });
});

describe('quest generation and lifecycle coverage', () => {
  it('gets active accepted quest count from the database', async () => {
    const client = createDbClient([
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 3 }] } },
    ]);
    expect(await questsService._internal.getActiveQuestCount(client)).toBe(3);
  });

  it('returns early when active quest cap is reached', async () => {
    const client = createDbClient([
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 5 }] } },
    ]);
    setMockDatabase(client);

    const result = await questsService.generateQuests();
    expect(result.success).toBe(true);
    expect(result.created).toBe(0);
    expect(result.message).toContain('Maximum active quests');
  });

  it('generates and inserts multiple quest types from actionable data', async () => {
    getBehavioralPatterns.mockResolvedValue({ recurringPatterns: [] });
    const client = createDbClient([
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 4 }] } },
      {
        match: /FROM spending_category_mappings/,
        result: {
          rows: [
            { category_definition_id: 1, variability_type: 'variable', name: 'Dining', name_en: 'Dining' },
            { category_definition_id: 2, variability_type: 'fixed', name: 'Groceries', name_en: 'Groceries' },
          ],
        },
      },
      { match: (text) => text.includes('FROM transactions t') && text.includes('t.category_definition_id IN'), result: { rows: [] } },
      { match: /avg_weekend_spend/, result: { rows: [{ avg_weekend_spend: 200, weeks_analyzed: 4 }] } },
      { match: /WHERE recurrence_key = \$1/, result: { rows: [] } },
      { match: /INSERT INTO smart_action_items \(/, result: { rows: [] } },
    ]);
    setMockDatabase(client);

    const result = await questsService.generateQuests({
      locale: 'en',
      force: true,
      forecastData: {
        patterns: [
          {
            categoryDefinitionId: 1,
            categoryName: 'Dining',
            categoryNameEn: 'Dining',
            categoryType: 'expense',
            patternType: 'weekly',
            avgAmount: 200,
            avgOccurrencesPerWeek: 2,
            avgOccurrencesPerMonth: 8,
            monthsOfHistory: 4,
            confidence: 0.85,
            coefficientOfVariation: 0.7,
            isFixedAmount: false,
            isFixedRecurring: false,
            daysSinceLastOccurrence: 2,
          },
        ],
        budgetOutlook: [
          {
            budgetId: 12,
            status: 'at_risk',
            risk: 0.7,
            limit: 1000,
            actualSpent: 780,
            projectedTotal: 1150,
            categoryName: 'Groceries',
            categoryNameEn: 'Groceries',
            categoryDefinitionId: 2,
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.created).toBeGreaterThan(0);
    const insertCalls = client.query.mock.calls.filter(([sql]) =>
      normalizeSql(sql).includes('INSERT INTO smart_action_items ('),
    );
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  it('skips creating duplicate recurrence keys when not forced', async () => {
    getBehavioralPatterns.mockResolvedValue({ recurringPatterns: [] });
    const client = createDbClient([
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 4 }] } },
      {
        match: /FROM spending_category_mappings/,
        result: { rows: [{ category_definition_id: 1, variability_type: 'variable', name: 'Dining', name_en: 'Dining' }] },
      },
      { match: (text) => text.includes('FROM transactions t') && text.includes('t.category_definition_id IN'), result: { rows: [] } },
      { match: /avg_weekend_spend/, result: { rows: [{ avg_weekend_spend: 150, weeks_analyzed: 4 }] } },
      { match: /WHERE recurrence_key = \$1/, result: { rows: [{ id: 99 }] } },
    ]);
    setMockDatabase(client);

    const result = await questsService.generateQuests({
      locale: 'en',
      forecastData: {
        patterns: [
          {
            categoryDefinitionId: 1,
            categoryName: 'Dining',
            categoryNameEn: 'Dining',
            categoryType: 'expense',
            patternType: 'weekly',
            avgAmount: 250,
            avgOccurrencesPerWeek: 2,
            avgOccurrencesPerMonth: 8,
            monthsOfHistory: 4,
            confidence: 0.8,
            coefficientOfVariation: 0.7,
            isFixedAmount: false,
            isFixedRecurring: false,
            daysSinceLastOccurrence: 2,
          },
        ],
        budgetOutlook: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.total_generated).toBeGreaterThan(0);
    expect(result.created).toBe(0);
  });

  it('generates merchant-limit and weekend-limit quests from actionable inputs', async () => {
    getBehavioralPatterns.mockResolvedValue({
      recurringPatterns: [
        {
          name: 'Aroma Cafe',
          frequency: 'daily',
          avgAmount: 32,
          occurrences: 40,
          occurrencesPerMonth: 20,
          monthsObserved: 4,
        },
        {
          name: 'Supermarket Big',
          frequency: 'daily',
          avgAmount: 50,
          occurrences: 30,
          occurrencesPerMonth: 15,
          monthsObserved: 3,
        },
      ],
    });
    const client = createDbClient([
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 0 }] } },
      { match: /FROM spending_category_mappings/, result: { rows: [] } },
      { match: /avg_weekend_spend/, result: { rows: [{ avg_weekend_spend: 700, weeks_analyzed: 4 }] } },
      { match: /WHERE recurrence_key = \$1/, result: { rows: [] } },
      { match: /INSERT INTO smart_action_items \(/, result: { rows: [] } },
    ]);
    setMockDatabase(client);

    const result = await questsService.generateQuests({
      locale: 'en',
      force: true,
      forecastData: { patterns: [], budgetOutlook: [] },
    });

    expect(result.success).toBe(true);
    expect(result.created).toBeGreaterThanOrEqual(1);

    const insertCalls = client.query.mock.calls.filter(([sql]) =>
      normalizeSql(sql).includes('INSERT INTO smart_action_items ('),
    );
    const actionTypes = insertCalls.map(([, params]) => params?.[0]).filter(Boolean);
    expect(actionTypes).toContain('quest_weekend_limit');
  });

  it('returns an error payload when quest generation fails unexpectedly', async () => {
    questsService.__setDatabase({
      getClient: vi.fn().mockRejectedValue(new Error('db exploded')),
      query: vi.fn(),
    });

    const result = await questsService.generateQuests();
    expect(result).toEqual({ success: false, error: 'db exploded' });
  });

  it('accepts a quest and sets accepted state with deadline', async () => {
    const client = createDbClient(
      withCleanupHandlers([
        { match: /SELECT \* FROM smart_action_items WHERE id = \$1/, result: { rows: [{ id: 12, action_type: 'quest_reduce_spending', user_status: 'active', quest_duration_days: 7, points_reward: 90 }] } },
        { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 2 }] } },
        { match: /SELECT name, tbl_name, sql FROM sqlite_master/, result: { rows: [] } },
      ]),
    );
    setMockDatabase(client);

    const result = await questsService.acceptQuest(12);
    expect(result).toMatchObject({ success: true, quest_id: 12, points_reward: 90 });
    expect(client.query.mock.calls.some(([sql]) => normalizeSql(sql).includes("SET user_status = 'accepted'"))).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('runs full trigger cleanup once and skips cleanup on subsequent accept calls', async () => {
    const client = createDbClient([
      {
        match: "SELECT name, type, sql, tbl_name FROM sqlite_master",
        result: {
          rows: [
            {
              name: 'legacy_trigger',
              type: 'trigger',
              tbl_name: 'smart_action_items',
              sql: 'CREATE TRIGGER legacy_trigger AFTER UPDATE ON smart_action_items_old BEGIN SELECT 1; END',
            },
          ],
        },
      },
      {
        match: (text) => text.includes("SELECT name, sql FROM sqlite_master") && text.includes("type = 'trigger'"),
        result: {
          rows: [
            {
              name: 'old_trigger',
              sql: 'CREATE TRIGGER old_trigger AFTER UPDATE ON smart_action_items_old BEGIN SELECT 1; END',
            },
          ],
        },
      },
      {
        match: "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'smart_action_items'",
        result: { rows: [{ name: 'update_smart_action_items_timestamp' }] },
      },
      {
        match: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'action_item_history'",
        result: {
          rows: [{ sql: 'CREATE TABLE action_item_history (smart_action_item_id INTEGER REFERENCES smart_action_items_old(id))' }],
        },
      },
      {
        match: "SELECT name, type, sql FROM sqlite_master WHERE sql LIKE '%smart_action_items_old%'",
        result: { rows: [{ name: 'leftover_view', type: 'view', sql: 'SELECT * FROM smart_action_items_old' }] },
      },
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: (_text, params) => ({
          rows: [{
            id: params[0],
            action_type: 'quest_reduce_spending',
            user_status: 'active',
            quest_duration_days: 7,
            points_reward: 90,
          }],
        }),
      },
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 1 }] } },
      { match: /SELECT name, tbl_name, sql FROM sqlite_master[\s\S]*tbl_name = 'smart_action_items'/, result: { rows: [] } },
      { match: /DROP TRIGGER IF EXISTS/i, result: { rows: [] } },
      { match: /PRAGMA foreign_keys = OFF/i, result: { rows: [] } },
      { match: /PRAGMA foreign_keys = ON/i, result: { rows: [] } },
      { match: /CREATE TABLE IF NOT EXISTS action_item_history_new/i, result: { rows: [] } },
      { match: /INSERT INTO action_item_history_new/i, result: { rows: [] } },
      { match: /DROP TABLE action_item_history/i, result: { rows: [] } },
      { match: /ALTER TABLE action_item_history_new RENAME TO action_item_history/i, result: { rows: [] } },
      { match: /CREATE INDEX IF NOT EXISTS idx_action_item_history_item_id/i, result: { rows: [] } },
      { match: /CREATE TRIGGER IF NOT EXISTS update_smart_action_items_timestamp/i, result: { rows: [] } },
      { match: /CREATE TRIGGER IF NOT EXISTS log_smart_action_item_status_change/i, result: { rows: [] } },
      { match: /UPDATE smart_action_items[\s\S]*SET user_status = 'accepted'/, result: { rows: [] } },
      { match: /INSERT INTO action_item_history[\s\S]*'accepted'/, result: { rows: [] } },
    ]);
    setMockDatabase(client);

    const first = await questsService.acceptQuest(120);
    const second = await questsService.acceptQuest(121);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const cleanupCalls = client.query.mock.calls.filter(([sql]) =>
      normalizeSql(sql).includes('SELECT name, type, sql, tbl_name FROM sqlite_master'),
    );
    expect(cleanupCalls).toHaveLength(1);
    expect(
      client.query.mock.calls.some(([sql]) => normalizeSql(sql).includes('DROP TRIGGER IF EXISTS old_trigger')),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) => normalizeSql(sql).includes('CREATE TABLE IF NOT EXISTS action_item_history_new')),
    ).toBe(true);
  });

  it('fails accept when quest does not exist', async () => {
    const client = createDbClient(
      withCleanupHandlers([{ match: /SELECT \* FROM smart_action_items WHERE id = \$1/, result: { rows: [] } }]),
    );
    setMockDatabase(client);

    await expect(questsService.acceptQuest(404)).rejects.toThrow('Quest not found');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('fails accept for non-quest actions and max-cap violations', async () => {
    const nonQuestClient = createDbClient(
      withCleanupHandlers([
        { match: /SELECT \* FROM smart_action_items WHERE id = \$1/, result: { rows: [{ id: 1, action_type: 'smart_action', user_status: 'active' }] } },
      ]),
    );
    setMockDatabase(nonQuestClient);
    await expect(questsService.acceptQuest(1)).rejects.toThrow('not a quest');

    const limitClient = createDbClient(
      withCleanupHandlers([
        { match: /SELECT \* FROM smart_action_items WHERE id = \$1/, result: { rows: [{ id: 2, action_type: 'quest_reduce_spending', user_status: 'active', quest_duration_days: 7 }] } },
        { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 5 }] } },
      ]),
    );
    setMockDatabase(limitClient);
    await expect(questsService.acceptQuest(2)).rejects.toThrow('Maximum active quests reached');
  });

  it('declines a quest and updates decline counters/history', async () => {
    const client = createDbClient(
      withCleanupHandlers([
        { match: /SELECT \* FROM smart_action_items WHERE id = \$1/, result: { rows: [{ id: 9, action_type: 'quest_set_budget', user_status: 'active' }] } },
      ]),
    );
    setMockDatabase(client);

    const result = await questsService.declineQuest(9);
    expect(result).toEqual({ success: true, quest_id: 9 });
    expect(client.query.mock.calls.some(([sql]) => normalizeSql(sql).includes("SET user_status = 'dismissed'"))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => normalizeSql(sql).includes('quests_declined = quests_declined + 1'))).toBe(true);
  });

  it('fails decline for non-quest actions', async () => {
    const client = createDbClient(
      withCleanupHandlers([{ match: /SELECT \* FROM smart_action_items WHERE id = \$1/, result: { rows: [{ id: 3, action_type: 'smart_action', user_status: 'active' }] } }]),
    );
    setMockDatabase(client);

    await expect(questsService.declineQuest(3)).rejects.toThrow('not a quest');
  });

  it('verifies spending-limit quests with bonus points for overachievement', async () => {
    const client = createDbClient([
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: {
          rows: [
            {
              id: 7,
              action_type: 'quest_reduce_spending',
              user_status: 'accepted',
              points_reward: 100,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-15T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'spending_limit',
                category_definition_id: 5,
                target_amount: 100,
              }),
            },
          ],
        },
      },
      { match: /SELECT COALESCE\(SUM\(ABS\(price\)\), 0\) as total_spent[\s\S]*date >= \$2 AND date <= \$3/, result: { rows: [{ total_spent: 40 }] } },
      { match: /SELECT total_points FROM user_quest_stats WHERE id = 1/, result: { rows: [{ total_points: 360 }] } },
    ]);
    setMockDatabase(client);

    const result = await questsService.verifyQuestCompletion(7);
    expect(result).toMatchObject({
      success: true,
      quest_id: 7,
      points_earned: 125,
      new_status: 'resolved',
    });
    expect(client.query.mock.calls.some(([sql]) => normalizeSql(sql).includes('SET level = $1'))).toBe(true);
  });

  it('gives partial credit for near misses and marks unresolved failures correctly', async () => {
    const partialClient = createDbClient([
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: {
          rows: [
            {
              id: 8,
              action_type: 'quest_reduce_spending',
              user_status: 'accepted',
              points_reward: 100,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-15T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'spending_limit',
                category_definition_id: 5,
                target_amount: 100,
              }),
            },
          ],
        },
      },
      { match: /SELECT COALESCE\(SUM\(ABS\(price\)\), 0\) as total_spent[\s\S]*date >= \$2 AND date <= \$3/, result: { rows: [{ total_spent: 110 }] } },
      { match: /SELECT total_points FROM user_quest_stats WHERE id = 1/, result: { rows: [{ total_points: 180 }] } },
    ]);
    setMockDatabase(partialClient);
    const partial = await questsService.verifyQuestCompletion(8);
    expect(partial).toMatchObject({ success: false, points_earned: 50, new_status: 'resolved' });

    const failClient = createDbClient([
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: {
          rows: [
            {
              id: 9,
              action_type: 'quest_reduce_spending',
              user_status: 'accepted',
              points_reward: 100,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-15T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'spending_limit',
                category_definition_id: 5,
                target_amount: 100,
              }),
            },
          ],
        },
      },
      { match: /SELECT COALESCE\(SUM\(ABS\(price\)\), 0\) as total_spent[\s\S]*date >= \$2 AND date <= \$3/, result: { rows: [{ total_spent: 200 }] } },
    ]);
    setMockDatabase(failClient);
    const failed = await questsService.verifyQuestCompletion(9);
    expect(failed).toMatchObject({ success: false, points_earned: 0, new_status: 'failed' });
    expect(failClient.query.mock.calls.some(([sql]) => normalizeSql(sql).includes('quests_failed = quests_failed + 1'))).toBe(true);
  });

  it('supports manual verification override and rejects invalid verification states', async () => {
    const manualClient = createDbClient([
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: {
          rows: [
            {
              id: 33,
              action_type: 'quest_savings_target',
              user_status: 'accepted',
              points_reward: 80,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-20T00:00:00.000Z',
              completion_criteria: JSON.stringify({ type: 'savings_transfer', target_amount: 300 }),
            },
          ],
        },
      },
      { match: /SELECT total_points FROM user_quest_stats WHERE id = 1/, result: { rows: [{ total_points: 800 }] } },
    ]);
    setMockDatabase(manualClient);

    const manualResult = await questsService.verifyQuestCompletion(33, {
      success: true,
      actualValue: 420,
      achievementPct: 130,
    });
    expect(manualResult).toMatchObject({ success: true, points_earned: 100, new_status: 'resolved' });

    const invalidClient = createDbClient([
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: { rows: [{ id: 34, action_type: 'quest_set_budget', user_status: 'active', completion_criteria: '{}' }] },
      },
    ]);
    setMockDatabase(invalidClient);
    await expect(questsService.verifyQuestCompletion(34)).rejects.toThrow('cannot be verified');
  });

  it('verifies merchant/weekend completion criteria and updates status accordingly', async () => {
    const merchantClient = createDbClient([
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: {
          rows: [
            {
              id: 55,
              action_type: 'quest_merchant_limit',
              user_status: 'accepted',
              points_reward: 80,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-15T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'merchant_frequency_limit',
                merchant_pattern: 'aroma',
                max_transactions: 2,
                baseline_transactions: 4,
              }),
            },
          ],
        },
      },
      { match: /SELECT COUNT\(\*\) as cnt[\s\S]*LOWER\(name\) LIKE/, result: { rows: [{ cnt: 1 }] } },
      { match: /SELECT total_points FROM user_quest_stats WHERE id = 1/, result: { rows: [{ total_points: 420 }] } },
    ]);
    setMockDatabase(merchantClient);

    const merchantResult = await questsService.verifyQuestCompletion(55);
    expect(merchantResult.success).toBe(true);
    expect(merchantResult.points_earned).toBe(100);
    expect(merchantResult.actual_value).toBe(1);

    const weekendClient = createDbClient([
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: {
          rows: [
            {
              id: 56,
              action_type: 'quest_weekend_limit',
              user_status: 'accepted',
              points_reward: 90,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-15T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'weekend_spending_limit',
                target_amount: 200,
              }),
            },
          ],
        },
      },
      {
        match: /SELECT COALESCE\(SUM\(ABS\(price\)\), 0\) as total[\s\S]*CAST\(strftime\('%w', date\) AS INTEGER\) IN \(0, 5, 6\)/,
        result: { rows: [{ total: 250 }] },
      },
    ]);
    setMockDatabase(weekendClient);

    const weekendResult = await questsService.verifyQuestCompletion(56);
    expect(weekendResult.success).toBe(false);
    expect(weekendResult.new_status).toBe('failed');
    expect(weekendResult.points_earned).toBe(0);
    expect(weekendResult.actual_value).toBe(250);
  });
});

describe('quest query views and stats coverage', () => {
  it('returns active quests with progress for spending-limit criteria', async () => {
    const client = createDbClient([
      {
        match: /FROM smart_action_items sai/,
        result: {
          rows: [
            {
              id: 1,
              action_type: 'quest_reduce_spending',
              user_status: 'accepted',
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2099-02-20T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'spending_limit',
                category_definition_id: 9,
                target_amount: 100,
              }),
              metadata: JSON.stringify({
                baseline_period: 'week',
                reduction_pct: 15,
                baseline_amount: 120,
                target_amount: 100,
              }),
              title: 'old title',
              description: 'old desc',
              category_name: 'Dining',
              category_name_en: 'Dining',
            },
            {
              id: 2,
              action_type: 'quest_set_budget',
              user_status: 'active',
              completion_criteria: null,
              metadata: JSON.stringify({ avg_monthly: 300, suggested_budget: 320 }),
              title: 'active title',
              description: 'active desc',
              category_name: 'Groceries',
              category_name_en: 'Groceries',
            },
          ],
        },
      },
      { match: /SELECT COALESCE\(SUM\(ABS\(price\)\), 0\) as total_spent[\s\S]*category_definition_id = \$1/, result: { rows: [{ total_spent: 50 }] } },
    ]);
    setMockDatabase(client);

    const result = await questsService.getActiveQuests({ locale: 'en' });
    expect(result.count).toBe(2);
    const accepted = result.quests.find((q) => q.id === 1);
    expect(accepted.progress).toMatchObject({ current: 50, target: 100, on_track: true, percentage: 50 });
    expect(typeof accepted.title).toBe('string');
    expect(accepted.time_remaining.days).toBeGreaterThanOrEqual(0);
    const active = result.quests.find((q) => q.id === 2);
    expect(active.progress).toBeNull();
  });

  it('calculates merchant and weekend progress in active quest view', async () => {
    const merchantClient = createDbClient([
      {
        match: /FROM smart_action_items sai/,
        result: {
          rows: [
            {
              id: 10,
              action_type: 'quest_merchant_limit',
              user_status: 'accepted',
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2099-02-20T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'merchant_frequency_limit',
                merchant_pattern: 'aroma',
                max_transactions: 2,
              }),
              metadata: JSON.stringify({ merchant_name: 'Aroma', baseline_visits: 4, target_visits: 2, avg_transaction: 30 }),
              title: 'merchant title',
              description: 'merchant desc',
              category_name: null,
              category_name_en: null,
            },
          ],
        },
      },
      { match: /SELECT COUNT\(\*\) as cnt[\s\S]*LOWER\(name\) LIKE/, result: { rows: [{ cnt: 3 }] } },
    ]);
    setMockDatabase(merchantClient);

    const merchantResult = await questsService.getActiveQuests({ locale: 'en' });
    expect(merchantResult.quests[0].progress).toMatchObject({
      current: 3,
      target: 2,
      on_track: false,
      percentage: 150,
    });

    const weekendClient = createDbClient([
      {
        match: /FROM smart_action_items sai/,
        result: {
          rows: [
            {
              id: 11,
              action_type: 'quest_weekend_limit',
              user_status: 'accepted',
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2099-02-20T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'weekend_spending_limit',
                target_amount: 100,
              }),
              metadata: JSON.stringify({ target_weekend_spend: 100, avg_weekend_spend: 180 }),
              title: 'weekend title',
              description: 'weekend desc',
              category_name: null,
              category_name_en: null,
            },
          ],
        },
      },
      { match: /SELECT COALESCE\(SUM\(ABS\(price\)\), 0\) as total_spent[\s\S]*CAST\(strftime\('%w', date\) AS INTEGER\) IN \(0, 5, 6\)/, result: { rows: [{ total_spent: 130 }] } },
    ]);
    setMockDatabase(weekendClient);

    const weekendResult = await questsService.getActiveQuests({ locale: 'en' });
    expect(weekendResult.quests[0].progress).toMatchObject({
      current: 130,
      target: 100,
      on_track: false,
      percentage: 130,
    });
  });

  it('resets stale quest streaks and computes next level progress', async () => {
    const staleDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const client = createDbClient([
      { match: /INSERT OR IGNORE INTO user_quest_stats/, result: { rows: [] } },
      {
        match: /SELECT \* FROM user_quest_stats WHERE id = 1/,
        result: {
          rows: [
            {
              id: 1,
              total_points: 150,
              current_streak: 4,
              best_streak: 9,
              quests_completed: 3,
              quests_failed: 1,
              quests_declined: 1,
              level: 2,
              last_completed_at: staleDate,
            },
          ],
        },
      },
      { match: /UPDATE user_quest_stats SET current_streak = 0 WHERE id = 1/, result: { rows: [] } },
    ]);
    setMockDatabase(client);

    const stats = await questsService.getUserQuestStats();
    expect(stats.current_streak).toBe(0);
    expect(stats.streak_reset).toBe(true);
    expect(stats.level_progress).toMatchObject({
      current_level: 2,
      next_level: 3,
      points_for_next: 300,
      points_needed: 150,
    });
  });

  it('returns max-level payload when there is no next level', async () => {
    const client = createDbClient([
      { match: /INSERT OR IGNORE INTO user_quest_stats/, result: { rows: [] } },
      {
        match: /SELECT \* FROM user_quest_stats WHERE id = 1/,
        result: {
          rows: [
            {
              id: 1,
              total_points: 6000,
              current_streak: 1,
              best_streak: 5,
              quests_completed: 20,
              quests_failed: 2,
              quests_declined: 1,
              level: 10,
              last_completed_at: null,
            },
          ],
        },
      },
    ]);
    setMockDatabase(client);

    const stats = await questsService.getUserQuestStats();
    expect(stats.level_progress).toMatchObject({ current_level: 10, max_level_reached: true });
  });

  it('checks deadlines with no expired quests and no auto-generation trigger', async () => {
    const client = createDbClient([
      { match: /SELECT id FROM smart_action_items[\s\S]*deadline < datetime\('now'\)/, result: { rows: [] } },
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 4 }] } },
    ]);
    setMockDatabase(client);

    const result = await questsService.checkQuestDeadlines();
    expect(result).toMatchObject({
      checked: 0,
      verified: 0,
      failed: 0,
      active_quests: 4,
      new_quests_generated: 0,
    });
  });

  it('triggers on-demand quest generation when active quests are below threshold', async () => {
    let activeCountCalls = 0;
    const client = createDbClient([
      { match: /SELECT id FROM smart_action_items[\s\S]*deadline < datetime\('now'\)/, result: { rows: [] } },
      {
        match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/,
        result: () => {
          activeCountCalls += 1;
          return activeCountCalls === 1
            ? { rows: [{ count: 2 }] } // checkQuestDeadlines threshold branch
            : { rows: [{ count: 5 }] }; // generateQuests early return
        },
      },
    ]);
    setMockDatabase(client);

    const result = await questsService.checkQuestDeadlines();
    expect(result.checked).toBe(0);
    expect(result.active_quests).toBe(2);
    expect(result.new_quests_generated).toBe(0);
    expect(activeCountCalls).toBe(2);
  });

  it('verifies expired quests and tracks verification errors from nested checks', async () => {
    const verifiedClient = createDbClient([
      { match: /SELECT id FROM smart_action_items[\s\S]*deadline < datetime\('now'\)/, result: { rows: [{ id: 40 }] } },
      {
        match: /SELECT \* FROM smart_action_items WHERE id = \$1/,
        result: {
          rows: [
            {
              id: 40,
              action_type: 'quest_reduce_spending',
              user_status: 'accepted',
              points_reward: 80,
              accepted_at: '2026-02-01T00:00:00.000Z',
              deadline: '2026-02-08T00:00:00.000Z',
              completion_criteria: JSON.stringify({
                type: 'spending_limit',
                category_definition_id: 2,
                target_amount: 100,
              }),
            },
          ],
        },
      },
      { match: /SELECT COALESCE\(SUM\(ABS\(price\)\), 0\) as total_spent[\s\S]*date >= \$2 AND date <= \$3/, result: { rows: [{ total_spent: 60 }] } },
      { match: /SELECT total_points FROM user_quest_stats WHERE id = 1/, result: { rows: [{ total_points: 220 }] } },
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 3 }] } },
    ]);
    setMockDatabase(verifiedClient);

    const verified = await questsService.checkQuestDeadlines();
    expect(verified.verified).toBe(1);
    expect(verified.failed).toBe(0);
    expect(verified.checked).toBe(1);

    const errorClient = createDbClient([
      { match: /SELECT id FROM smart_action_items[\s\S]*deadline < datetime\('now'\)/, result: { rows: [{ id: 77 }] } },
      { match: /SELECT \* FROM smart_action_items WHERE id = \$1/, result: { rows: [] } },
      { match: /SELECT COUNT\(\*\) as count[\s\S]*user_status = 'accepted'/, result: { rows: [{ count: 4 }] } },
    ]);
    setMockDatabase(errorClient);

    const errored = await questsService.checkQuestDeadlines();
    expect(errored.verified).toBe(0);
    expect(errored.failed).toBe(0);
    expect(errored.errors).toHaveLength(1);
    expect(errored.errors[0]).toMatchObject({ quest_id: 77 });
  });
});
