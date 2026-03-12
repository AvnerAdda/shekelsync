import { describe, expect, it } from 'vitest';
import {
  buildBudgetVariabilitySnapshot,
  buildCategoryVariabilityIndex,
  getVariabilitySummaryCounts,
  resolveBudgetDeepLinkTarget,
} from '../utils/budget-forecast-helpers';

const budgetOutlook = [
  {
    categoryDefinitionId: 1,
  },
];

const categoryVariability = [
  {
    category_id: 1,
    variability_type: 'fixed' as const,
    avg_monthly: 410,
    latest_vs_avg_percent: 20,
    confidence: 0.82,
    monthly_breakdown: [
      { month: '2025-10', amount: 380 },
      { month: '2025-11', amount: 400 },
      { month: '2025-12', amount: 420 },
      { month: '2026-01', amount: 405 },
      { month: '2026-02', amount: 410 },
      { month: '2026-03', amount: 492 },
    ],
    mom_changes: [
      { change: 20 },
      { change: 32 },
    ],
  },
];

describe('Analysis budget helpers', () => {
  it('resolves budget deep links to the details flow for an existing budget', () => {
    expect(resolveBudgetDeepLinkTarget({
      requestedTab: 'budget',
      currentTab: 3,
      categoryDefinitionParam: '1',
      budgetAction: 'details',
      budgetOutlook,
    })).toEqual({
      kind: 'details',
      categoryDefinitionId: 1,
    });
  });

  it('falls back to the add-budget flow when the deep link targets a missing or forced-add category', () => {
    expect(resolveBudgetDeepLinkTarget({
      requestedTab: 'budget',
      currentTab: 3,
      categoryDefinitionParam: '99',
      budgetAction: 'details',
      budgetOutlook,
    })).toEqual({
      kind: 'add',
      categoryDefinitionId: 99,
    });

    expect(resolveBudgetDeepLinkTarget({
      requestedTab: 'budget',
      currentTab: 3,
      categoryDefinitionParam: '1',
      budgetAction: 'add',
      budgetOutlook,
    })).toEqual({
      kind: 'add',
      categoryDefinitionId: 1,
    });
  });

  it('builds integrated variability metadata for budget outlook cards and details', () => {
    const variabilityByCategoryId = buildCategoryVariabilityIndex(categoryVariability);
    const snapshot = buildBudgetVariabilitySnapshot(1, variabilityByCategoryId);

    expect(getVariabilitySummaryCounts(categoryVariability)).toEqual({
      fixed: 1,
      variable: 0,
      seasonal: 0,
    });

    expect(snapshot).toMatchObject({
      variabilityType: 'fixed',
      avgMonthly: 410,
      latestVsAveragePercent: 20,
      confidence: 0.82,
      hasSeasonalPattern: false,
      latestMomentumChange: 32,
      hasLargeMomentumShift: true,
    });
    expect(snapshot?.sparkline).toHaveLength(6);
  });
});
