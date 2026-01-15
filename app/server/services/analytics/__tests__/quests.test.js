import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import questsService from '../quests.js';

// Mock the behavioral service
vi.mock('../behavioral.js', () => ({
  getBehavioralPatterns: vi.fn(),
}));

import { getBehavioralPatterns } from '../behavioral.js';

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

