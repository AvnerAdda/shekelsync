import { type VariabilityType } from '@renderer/types/spending-categories';

export type BudgetDeepLinkKind = 'details' | 'add';

export type BudgetOutlookLike = {
  categoryDefinitionId: number | null;
};

export type CategoryVariabilityLike = {
  category_id: number;
  variability_type: VariabilityType;
  avg_monthly: number;
  latest_vs_avg_percent: number;
  confidence: number;
  monthly_breakdown: Array<{
    month: string;
    amount: number;
  }>;
  mom_changes: Array<{
    change: number;
  }>;
};

export type BudgetDeepLinkResolution = {
  kind: BudgetDeepLinkKind;
  categoryDefinitionId: number;
};

export type BudgetVariabilitySnapshot = {
  variabilityType: VariabilityType;
  avgMonthly: number;
  latestVsAveragePercent: number;
  confidence: number;
  sparkline: Array<{
    month: string;
    amount: number;
  }>;
  hasSeasonalPattern: boolean;
  latestMomentumChange: number;
  hasLargeMomentumShift: boolean;
};

export const getVariabilitySummaryCounts = (
  analyses: CategoryVariabilityLike[],
): Record<VariabilityType, number> => {
  const counts: Record<VariabilityType, number> = {
    fixed: 0,
    variable: 0,
    seasonal: 0,
  };

  analyses.forEach((item) => {
    counts[item.variability_type] += 1;
  });

  return counts;
};

export const buildCategoryVariabilityIndex = (
  analyses: CategoryVariabilityLike[],
): Map<number, CategoryVariabilityLike> => new Map(
  analyses.map((item) => [item.category_id, item]),
);

export const getLatestMomentumChange = (
  analysis: Pick<CategoryVariabilityLike, 'mom_changes'> | null | undefined,
): number => analysis?.mom_changes[analysis.mom_changes.length - 1]?.change ?? 0;

export const buildBudgetVariabilitySnapshot = (
  categoryDefinitionId: number | null | undefined,
  variabilityByCategoryId: Map<number, CategoryVariabilityLike>,
): BudgetVariabilitySnapshot | null => {
  if (categoryDefinitionId === null || categoryDefinitionId === undefined) {
    return null;
  }

  const analysis = variabilityByCategoryId.get(categoryDefinitionId);
  if (!analysis) {
    return null;
  }

  const latestMomentumChange = getLatestMomentumChange(analysis);

  return {
    variabilityType: analysis.variability_type,
    avgMonthly: analysis.avg_monthly,
    latestVsAveragePercent: analysis.latest_vs_avg_percent,
    confidence: analysis.confidence,
    sparkline: analysis.monthly_breakdown.map((point) => ({
      month: point.month,
      amount: point.amount,
    })),
    hasSeasonalPattern: analysis.variability_type === 'seasonal',
    latestMomentumChange,
    hasLargeMomentumShift: Math.abs(latestMomentumChange) >= 30,
  };
};

export const resolveBudgetDeepLinkTarget = ({
  requestedTab,
  currentTab,
  categoryDefinitionParam,
  budgetAction,
  budgetOutlook,
}: {
  requestedTab: string | null;
  currentTab: number;
  categoryDefinitionParam: string | null;
  budgetAction?: string | null;
  budgetOutlook: BudgetOutlookLike[];
}): BudgetDeepLinkResolution | null => {
  if (requestedTab !== 'budget' || currentTab !== 3 || !categoryDefinitionParam) {
    return null;
  }

  const categoryDefinitionId = Number.parseInt(categoryDefinitionParam, 10);
  if (Number.isNaN(categoryDefinitionId)) {
    return null;
  }

  const matchingBudget = budgetOutlook.find(
    (item) => item.categoryDefinitionId === categoryDefinitionId,
  );

  if (matchingBudget && budgetAction !== 'add') {
    return {
      kind: 'details',
      categoryDefinitionId,
    };
  }

  return {
    kind: 'add',
    categoryDefinitionId,
  };
};
