import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let behavioralService;
let originalNodeEnv;

function createTransaction(overrides = {}) {
  return {
    identifier: 'txn-1',
    date: '2026-01-05',
    name: 'Netflix',
    price: -100,
    vendor: 'Netflix',
    category_type: 'expense',
    category_id: 10,
    category_name: 'בידור',
    category_name_en: 'Entertainment',
    category_name_fr: 'Divertissement',
    icon_name: 'movie',
    parent_category_id: 100,
    parent_category: 'פנאי',
    parent_category_en: 'Leisure',
    parent_category_fr: 'Loisir',
    parent_icon: 'star',
    month: '2026-01',
    week: '01',
    day_of_week: '1',
    ...overrides,
  };
}

function configureService({
  transactions = [],
  recurringPatterns = [],
  summary = { category_breakdown: [] },
  queryImpl,
  getSubscriptionSummaryImpl,
} = {}) {
  const query = vi.fn(
    queryImpl || (async () => ({ rows: transactions })),
  );
  const analyzeRecurringPatterns = vi.fn(async () => ({ patterns: recurringPatterns }));
  const getSubscriptionSummary = vi.fn(
    getSubscriptionSummaryImpl || (async () => summary),
  );

  behavioralService.__setDependencies({
    database: { query },
    analyzeRecurringPatterns,
    getSubscriptionSummary,
  });

  return {
    query,
    analyzeRecurringPatterns,
    getSubscriptionSummary,
  };
}

beforeAll(async () => {
  const module = await import('../behavioral.js');
  behavioralService = module.default ?? module;
});

describe('analytics behavioral service', () => {
  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-10T12:00:00.000Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    behavioralService.__resetDependencies();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    behavioralService.__resetDependencies();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('normalizes category keys and maps frequency thresholds', () => {
    const { normalizeCategoryKey, detectFrequency } = behavioralService._internal;

    expect(normalizeCategoryKey('  Travel  ')).toBe('travel');
    expect(normalizeCategoryKey('')).toBe('');
    expect(normalizeCategoryKey(null)).toBe('');

    expect(detectFrequency(25).name).toBe('daily');
    expect(detectFrequency(4).name).toBe('weekly');
    expect(detectFrequency(2).name).toBe('biweekly');
    expect(detectFrequency(1).name).toBe('monthly');
    expect(detectFrequency(0.5).name).toBe('bimonthly');
    expect(detectFrequency(6).name).toBe('variable');
  });

  it('calculates interval consistency including boundary cases', () => {
    const { calculateIntervalConsistency } = behavioralService._internal;

    expect(calculateIntervalConsistency([], 7)).toBe(0);
    expect(calculateIntervalConsistency(['2026-01-01'], 7)).toBe(0);

    const perfect = calculateIntervalConsistency(
      ['2026-01-01', '2026-01-08', '2026-01-15'],
      7,
    );
    expect(perfect).toBe(1);

    const noisy = calculateIntervalConsistency(
      ['2026-01-01', '2026-01-04', '2026-01-20'],
      7,
    );
    expect(noisy).toBeGreaterThanOrEqual(0);
    expect(noisy).toBeLessThan(1);
  });

  it('groups patterns by frequency buckets and ignores unknown frequency', () => {
    const { groupPatternsByFrequency } = behavioralService._internal;
    const grouped = groupPatternsByFrequency(
      [{ name: 'A', frequency: 'weekly' }, { name: 'B', frequency: 'variable' }],
      [{ category: 'Food', frequency: 'monthly' }],
      [{ subcategory: 'Streaming', frequency: 'daily' }],
    );

    expect(grouped.weekly.transactions).toHaveLength(1);
    expect(grouped.monthly.categories).toHaveLength(1);
    expect(grouped.daily.subcategories).toHaveLength(1);
    expect(grouped.biweekly.transactions).toHaveLength(0);
  });

  it('detects category and subcategory patterns from localized transactions', () => {
    const { detectCategoryPatterns, detectSubcategoryPatterns } = behavioralService._internal;
    const transactions = [
      createTransaction({
        localizedParentCategory: 'Leisure',
        localizedCategory: 'Streaming',
        price: -80,
        month: '2026-01',
        date: '2026-01-05',
      }),
      createTransaction({
        identifier: 'txn-2',
        localizedParentCategory: 'Leisure',
        localizedCategory: 'Streaming',
        price: -90,
        month: '2026-01',
        date: '2026-01-12',
      }),
      createTransaction({
        identifier: 'txn-3',
        localizedParentCategory: 'Transport',
        localizedCategory: 'Fuel',
        parent_icon: null,
        icon_name: 'fuel',
        price: -50,
        month: '2026-02',
        date: '2026-02-03',
      }),
      createTransaction({
        identifier: 'txn-4',
        localizedParentCategory: null,
        localizedCategory: 'Misc',
        price: -20,
      }),
    ];

    const categoryPatterns = detectCategoryPatterns(transactions);
    expect(categoryPatterns[0].category).toBe('Leisure');
    expect(categoryPatterns[0].totalAmount).toBe(170);
    expect(categoryPatterns[0].iconName).toBe('star');

    const subcategoryPatterns = detectSubcategoryPatterns(transactions);
    expect(subcategoryPatterns).toHaveLength(1);
    expect(subcategoryPatterns[0].category).toBe('Leisure');
    expect(subcategoryPatterns[0].subcategory).toBe('Streaming');
  });

  it('calculates category averages, recurring percentage, and recurring classification', () => {
    const { calculateCategoryAverages } = behavioralService._internal;
    const transactions = [
      createTransaction({
        identifier: 'txn-1',
        name: ' Netflix ',
        localizedParentCategory: 'Leisure',
        localizedCategory: 'Streaming',
        parent_icon: null,
        icon_name: null,
        price: -50,
        month: '2026-01',
        date: '2026-01-01',
      }),
      createTransaction({
        identifier: 'txn-2',
        name: 'Netflix',
        localizedParentCategory: 'Leisure',
        localizedCategory: 'Streaming',
        parent_icon: 'sparkles',
        icon_name: null,
        price: -50,
        month: '2026-02',
        date: '2026-02-01',
      }),
      createTransaction({
        identifier: 'txn-3',
        name: 'Cinema',
        localizedParentCategory: 'Leisure',
        localizedCategory: 'Streaming',
        parent_icon: null,
        icon_name: null,
        price: -50,
        month: '2026-02',
        date: '2026-02-08',
      }),
    ];
    const recurringPatterns = [{ pattern_key: 'netflix' }];

    const result = calculateCategoryAverages(transactions, recurringPatterns);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('Leisure');
    expect(result[0].iconName).toBe('sparkles');
    expect(result[0].recurringPercentage).toBe(67);
    expect(result[0].isRecurring).toBe(true);
  });

  it('returns ISO week-year for year-boundary dates', () => {
    const { getWeekNumber } = behavioralService._internal;

    expect(getWeekNumber(new Date('2021-01-01T00:00:00.000Z'))).toEqual({
      year: 2020,
      week: 53,
    });
  });

  it('returns summary-mode response for empty transactions', async () => {
    const deps = configureService({
      transactions: [],
      recurringPatterns: [],
    });

    const result = await behavioralService.getBehavioralPatterns('en', { mode: 'summary' });

    expect(result).toEqual({
      programmedAmount: 0,
      impulseAmount: 0,
      programmedPercentage: 0,
      impulsePercentage: 0,
      recurringCount: 0,
      topCategoryWeekly: null,
      topCategoryName: null,
    });
    expect(deps.getSubscriptionSummary).not.toHaveBeenCalled();
  });

  it('caches summary-mode responses outside test NODE_ENV', async () => {
    process.env.NODE_ENV = 'production';
    const deps = configureService({
      transactions: [
        createTransaction({
          identifier: 'txn-1',
          date: '2026-01-03',
          month: '2026-01',
          localizedParentCategory: 'Leisure',
          localizedCategory: 'Streaming',
          price: -100,
        }),
      ],
      recurringPatterns: [
        {
          pattern_key: 'netflix',
          display_name: 'Netflix',
          detected_amount: 100,
          occurrence_count: 1,
          occurrences_per_month: 1,
          months_span: 1,
          detected_frequency: 'monthly',
          amount_is_fixed: 1,
          consistency_score: 0.9,
        },
      ],
    });

    const first = await behavioralService.getBehavioralPatterns('en', { summary: 'true' });
    const second = await behavioralService.getBehavioralPatterns('en', { summary: 'true' });

    expect(first).toEqual(second);
    expect(deps.query).toHaveBeenCalledTimes(1);
    expect(deps.analyzeRecurringPatterns).toHaveBeenCalledTimes(1);
  });

  it('bypasses cache when noCache flag is enabled', async () => {
    process.env.NODE_ENV = 'production';
    const deps = configureService({
      transactions: [
        createTransaction({
          identifier: 'txn-1',
          localizedParentCategory: 'Leisure',
          price: -70,
        }),
      ],
      recurringPatterns: [],
    });

    await behavioralService.getBehavioralPatterns('en', { summary: true, noCache: true });
    await behavioralService.getBehavioralPatterns('en', { summary: true, noCache: '1' });

    expect(deps.query).toHaveBeenCalledTimes(2);
  });

  it('returns full response with frequency fallback and subscription counts', async () => {
    const deps = configureService({
      transactions: [
        createTransaction({
          identifier: 'txn-1',
          name: 'Gym',
          parent_category: 'בריאות',
          parent_category_en: 'Health',
          parent_category_fr: 'Sante',
          category_name: 'כושר',
          category_name_en: 'Gym',
          category_name_fr: 'Salle',
          parent_icon: 'health',
          month: '2026-01',
          date: '2026-01-05',
          price: -120,
        }),
        createTransaction({
          identifier: 'txn-2',
          name: 'Gym',
          parent_category: 'בריאות',
          parent_category_en: 'Health',
          parent_category_fr: 'Sante',
          category_name: 'כושר',
          category_name_en: 'Gym',
          category_name_fr: 'Salle',
          parent_icon: 'health',
          month: '2026-02',
          date: '2026-02-05',
          price: -120,
        }),
        createTransaction({
          identifier: 'txn-3',
          name: 'Taxi',
          parent_category: 'תחבורה',
          parent_category_en: 'Transport',
          parent_category_fr: 'Transport',
          category_name: 'מונית',
          category_name_en: 'Taxi',
          category_name_fr: 'Taxi',
          parent_icon: 'car',
          month: '2026-02',
          date: '2026-02-09',
          price: -80,
        }),
      ],
      recurringPatterns: [
        {
          pattern_key: 'gym',
          display_name: 'Gym',
          detected_amount: 120,
          occurrence_count: 2,
          occurrences_per_month: 1,
          months_span: 2,
          detected_frequency: 'monthly',
          amount_is_fixed: 1,
          consistency_score: 0.92,
          category_name: 'בריאות',
          category_name_en: 'Health',
          category_name_fr: 'Sante',
          parent_category_name: 'חיים',
          parent_category_name_en: 'Lifestyle',
          parent_category_name_fr: 'Style',
          category_icon: 'health',
        },
        {
          pattern_key: 'taxi',
          display_name: 'Taxi',
          detected_amount: 80,
          occurrence_count: 1,
          occurrences_per_month: 0.5,
          months_span: 2,
          detected_frequency: 'custom',
          amount_is_fixed: 0,
          consistency_score: 0.2,
          category_name: 'תחבורה',
          category_name_en: 'Transport',
          category_name_fr: 'Transport',
          parent_category_name: 'נסיעות',
          parent_category_name_en: 'Trips',
          parent_category_name_fr: 'Voyages',
          category_icon: 'car',
        },
      ],
      summary: {
        category_breakdown: [
          { name: 'health', count: 2 },
          { name: 'transport', count: 1 },
        ],
      },
    });

    const result = await behavioralService.getBehavioralPatterns('en', {});

    expect(deps.getSubscriptionSummary).toHaveBeenCalledTimes(1);
    expect(result.recurringPatterns).toHaveLength(2);
    expect(result.recurringPatterns[0].frequencyColor).toBe('#2196f3');
    expect(result.recurringPatterns[1].frequency).toBe('variable');
    expect(result.recurringPatterns[1].frequencyColor).toBe('#607d8b');
    expect(result.patternsByFrequency.monthly.transactions).toHaveLength(1);
    expect(result.categoryAverages.find((entry) => entry.category === 'Health')?.subscriptionCount).toBe(2);
    expect(result.categoryAverages.find((entry) => entry.category === 'Transport')?.subscriptionCount).toBe(1);
  });

  it('continues when subscription summary lookup fails', async () => {
    configureService({
      transactions: [
        createTransaction({
          identifier: 'txn-1',
          localizedParentCategory: 'Leisure',
          localizedCategory: 'Streaming',
          month: '2026-01',
          date: '2026-01-05',
          price: -50,
        }),
        createTransaction({
          identifier: 'txn-2',
          localizedParentCategory: 'Leisure',
          localizedCategory: 'Streaming',
          month: '2026-02',
          date: '2026-02-05',
          price: -50,
        }),
      ],
      recurringPatterns: [],
      getSubscriptionSummaryImpl: async () => {
        throw new Error('summary unavailable');
      },
    });

    const result = await behavioralService.getBehavioralPatterns('en', {});

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(result.categoryAverages[0].subscriptionCount).toBe(0);
  });
});
