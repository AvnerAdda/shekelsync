type DashboardSummaryLike = {
  totalIncome?: number;
  totalExpenses?: number;
  netInvestments?: number;
  totalCapitalReturns?: number;
};

export const hasDashboardSummaryActivity = (summary?: DashboardSummaryLike | null): boolean =>
  (summary?.totalIncome ?? 0) !== 0 ||
  (summary?.totalExpenses ?? 0) !== 0 ||
  (summary?.netInvestments ?? 0) !== 0 ||
  (summary?.totalCapitalReturns ?? 0) !== 0;

export const buildDashboardTopCategories = (
  breakdownData: Record<string, any>,
  totalExpenses: number,
  fallbackCategory: string,
): Array<{ name: string; amount: number }> => {
  if (breakdownData['expense'] && Array.isArray(breakdownData['expense']?.breakdowns)) {
    return breakdownData['expense'].breakdowns.slice(0, 3).map((cat: any) => ({
      name: cat.name,
      amount: cat.value,
    }));
  }

  if (totalExpenses > 0) {
    return [{ name: fallbackCategory, amount: totalExpenses }];
  }

  return [];
};

export const getDashboardCategoryCount = (breakdownData: Record<string, any>): number =>
  breakdownData['expense'] && Array.isArray(breakdownData['expense']?.breakdowns)
    ? breakdownData['expense'].breakdowns.length
    : 0;
