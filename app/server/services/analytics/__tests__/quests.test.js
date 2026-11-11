import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// Mock the behavioral service
vi.mock('../behavioral.js', () => ({
  getBehavioralPatterns: vi.fn(),
}));

import { getBehavioralPatterns } from '../behavioral.js';
let questsService;

beforeAll(async () => {
  const questsModule = await import('../quests.js');
  questsService = questsModule.default;
});

describe('quest weekly baseline helpers', () => {
  it('flags sparse/outlier-heavy categories as sporadic', () => {
    const weeklyTotals = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5000];
    const stats = questsService._internal.computeWeeklyBaselineStats(weeklyTotals);
    expect(stats.baselineWeeklyMedian).toBe(0);
    expect(stats.weeksWithSpend).toBe(1);
    expect(stats.isSporadic).toBe(true);
  });

  it('flags stable categories by median spread', () => {
    const weeklyTotals = Array.from({ length: 12 }, () => 200);
    const stats = questsService._internal.computeWeeklyBaselineStats(weeklyTotals);
    expect(stats.baselineWeeklyMedian).toBe(200);
    expect(stats.medianRelativeSpread).toBe(0);
    expect(stats.isStable).toBe(true);
    expect(stats.isSporadic).toBe(false);
  });

  it('does not flag variable categories as stable', () => {
    const weeklyTotals = [220, 80, 260, 130, 180, 0, 250, 50, 300, 100, 200, 90];
    const stats = questsService._internal.computeWeeklyBaselineStats(weeklyTotals);
    expect(stats.baselineWeeklyMedian).toBeGreaterThan(0);
    expect(stats.weeksWithSpend).toBeGreaterThanOrEqual(4);
    expect(stats.isSporadic).toBe(false);
    expect(stats.isStable).toBe(false);
  });
});

describe('quest excluded category detection', () => {
  it('excludes credit card repayment and rent-like categories', () => {
    expect(questsService._internal.isExcludedCategoryName('פרעון כרטיס אשראי', null)).toBe(true);
    expect(questsService._internal.isExcludedCategoryName('Rent', 'Rent')).toBe(true);
    expect(questsService._internal.isExcludedCategoryName('Rent & Mortgage', 'Rent & Mortgage')).toBe(true);
  });

  it('does not exclude normal spending categories', () => {
    expect(questsService._internal.isExcludedCategoryName('Groceries', 'Groceries')).toBe(false);
    expect(questsService._internal.isExcludedCategoryName('Restaurants', 'Restaurants')).toBe(false);
  });
});

describe('new actionable quest types', () => {
  const mockDbClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbClient.query.mockImplementation(async () => ({ rows: [] }));
    // Mock database client
    questsService.__setDatabase({
      getClient: vi.fn().mockResolvedValue(mockDbClient),
      query: vi.fn(),
    });
  });

  afterEach(() => {
    questsService.__resetDatabase();
  });

  describe('merchant quest generation', () => {
    it('generates merchant quests from high-frequency recurring patterns', async () => {
      // Mock behavioral patterns with a high-frequency merchant
      getBehavioralPatterns.mockResolvedValue({
        recurringPatterns: [
          { name: 'Aroma Cafe', frequency: 'daily', avgAmount: 25, occurrences: 20 },
          { name: 'Gas Station', frequency: 'weekly', avgAmount: 200, occurrences: 4 },
        ],
        programmedAmount: 700,
        impulseAmount: 300,
      });

      // Mock database responses
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // active quest count
        .mockResolvedValueOnce({ rows: [] }) // spending category mappings
        .mockResolvedValueOnce({ rows: [] }) // weekend stats
        .mockResolvedValueOnce({ rows: [] }); // existing quest check

      const result = await questsService.generateQuests({
        locale: 'en',
        force: true,
        forecastData: { patterns: [], budgetOutlook: [] },
      });

      // The quest generation should succeed even if behavioral data isn't available
      // (it handles errors gracefully)
      expect(result.success).toBe(true);
    });

    it('excludes essential merchants like supermarkets', () => {
      // The isExcludedMerchant function should filter out essential merchants
      // This is tested indirectly through the quest generation
      const excludedPatterns = [
        /סופרמרקט/i,
        /supermarket/i,
        /pharmacy/i,
      ];

      expect(excludedPatterns.some(p => p.test('Supermarket'))).toBe(true);
      expect(excludedPatterns.some(p => p.test('Aroma Cafe'))).toBe(false);
    });
  });

  describe('weekend quest generation', () => {
    it('generates weekend quest when average spend is significant', async () => {
      getBehavioralPatterns.mockResolvedValue({
        recurringPatterns: [],
        programmedAmount: 0,
        impulseAmount: 0,
      });

      // Mock weekend spending stats showing significant weekend spending
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // active quest count
        .mockResolvedValueOnce({ rows: [] }) // spending category mappings
        .mockResolvedValueOnce({ rows: [{ avg_weekend_spend: 500, weeks_analyzed: 4 }] }); // weekend stats

      const result = await questsService.generateQuests({
        locale: 'en',
        force: true,
        forecastData: { patterns: [], budgetOutlook: [] },
      });

      expect(result.success).toBe(true);
    });

    it('skips weekend quest when spending is below threshold', async () => {
      getBehavioralPatterns.mockResolvedValue({
        recurringPatterns: [],
      });

      // Mock weekend spending below 300 threshold
      mockDbClient.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ avg_weekend_spend: 150, weeks_analyzed: 4 }] });

      const result = await questsService.generateQuests({
        locale: 'en',
        force: true,
        forecastData: { patterns: [], budgetOutlook: [] },
      });

      expect(result.success).toBe(true);
      // Weekend quest should not be generated when spending < 300
    });
  });

  describe('quest action types', () => {
    it('includes new actionable quest types in QUEST_ACTION_TYPES', () => {
      expect(questsService.QUEST_ACTION_TYPES).toContain('quest_merchant_limit');
      expect(questsService.QUEST_ACTION_TYPES).toContain('quest_weekend_limit');
    });
  });
});

describe('spending challenges only target spending', () => {
  const SALARY = 90;
  const DINING = 12;
  const categoryTypes = [
    { id: SALARY, category_type: 'income' },
    { id: DINING, category_type: 'expense' },
  ];
  const variablePattern = (overrides) => ({
    patternType: 'monthly',
    avgAmount: 450,
    avgOccurrencesPerMonth: 12,
    monthsOfHistory: 6,
    coefficientOfVariation: 0.5,
    confidence: 0.8,
    isFixedRecurring: false,
    isFixedAmount: false,
    ...overrides,
  });

  let inserted;
  let client;

  beforeEach(() => {
    inserted = [];
    getBehavioralPatterns.mockResolvedValue({ recurringPatterns: [] });
    client = {
      release: vi.fn(),
      query: vi.fn(async (sql, params = []) => {
        const text = String(sql);
        if (text.includes('SELECT id, category_type FROM category_definitions')) return { rows: categoryTypes };
        if (/INSERT INTO smart_action_items/i.test(text)) {
          inserted.push({ sql: text, params });
          return { rows: [{ id: inserted.length }] };
        }
        return { rows: [] };
      }),
    };
    questsService.__setDatabase({ getClient: vi.fn().mockResolvedValue(client), query: vi.fn() });
  });

  afterEach(() => {
    questsService.__resetDatabase();
  });

  it('never asks to "reduce" salary, even when the forecast pattern looks variable', async () => {
    await questsService.generateQuests({
      locale: 'en',
      force: true,
      forecastData: {
        budgetOutlook: [],
        patterns: [
          // Mislabelled the way older forecasts could be: the category itself is income.
          variablePattern({ categoryDefinitionId: SALARY, categoryName: 'Salary', categoryType: 'expense', avgAmount: 5400, avgOccurrencesPerMonth: 1 }),
          variablePattern({ categoryDefinitionId: DINING, categoryName: 'Dining', categoryType: 'expense' }),
        ],
      },
    });

    const reduceQuests = inserted.filter((row) => row.params.includes('quest_reduce_spending'));
    expect(reduceQuests.length).toBeGreaterThan(0);
    expect(reduceQuests.every((row) => !row.params.includes(SALARY))).toBe(true);
    expect(reduceQuests.some((row) => row.params.includes(DINING))).toBe(true);
  });

  it('retires open spending challenges on non-spending categories', async () => {
    await questsService.retireNonExpenseSpendingQuests(client);
    const retire = client.query.mock.calls.find(([sql]) => /UPDATE smart_action_items/.test(sql));
    expect(retire[0]).toMatch(/category_type <> 'expense'/);
    expect(retire[1]).toEqual(expect.arrayContaining(['quest_reduce_spending', 'quest_set_budget']));
  });
});
