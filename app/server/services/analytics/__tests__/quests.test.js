import { describe, expect, it } from 'vitest';
import questsService from '../quests.js';

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

