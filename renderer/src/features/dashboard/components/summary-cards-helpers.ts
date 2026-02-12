export const computeEffectiveNetInvestments = (
  netInvestments: number,
  totalCapitalReturns: number,
): number => Math.max(0, netInvestments - totalCapitalReturns);

export const computeNetSavings = (
  totalIncome: number,
  totalExpenses: number,
  effectiveNetInvestments: number,
): number => totalIncome - (totalExpenses + effectiveNetInvestments);

export const computePendingExpenseImpact = ({
  netSavings,
  pendingExpenses,
  currentBankBalance,
}: {
  netSavings: number;
  pendingExpenses: number;
  currentBankBalance?: number;
}) => {
  const netSavingsAfterPending = netSavings - pendingExpenses;
  const hasPendingExpenses = pendingExpenses > 0;
  const projectedBankBalanceAfterPending =
    currentBankBalance !== undefined ? currentBankBalance - pendingExpenses : null;
  const pendingCreatesCashFlowDeficit = netSavingsAfterPending < 0;
  const pendingOverdrawsBank =
    projectedBankBalanceAfterPending !== null ? projectedBankBalanceAfterPending < 0 : null;

  return {
    netSavingsAfterPending,
    hasPendingExpenses,
    projectedBankBalanceAfterPending,
    pendingCreatesCashFlowDeficit,
    pendingOverdrawsBank,
    showPendingDeficitWarning:
      pendingCreatesCashFlowDeficit &&
      (pendingOverdrawsBank === null || pendingOverdrawsBank),
    showPendingDeficitCovered:
      pendingCreatesCashFlowDeficit && pendingOverdrawsBank === false,
    pendingDeficitAmount: Math.abs(netSavingsAfterPending),
    pendingOverdraftAmount:
      projectedBankBalanceAfterPending !== null && projectedBankBalanceAfterPending < 0
        ? Math.abs(projectedBankBalanceAfterPending)
        : 0,
  };
};

export const computeSummaryHealthMetrics = ({
  totalIncome,
  totalExpenses,
  currentBankBalance,
  topCategories,
  categoryCount,
}: {
  totalIncome: number;
  totalExpenses: number;
  currentBankBalance?: number;
  topCategories: Array<{ name: string; amount: number }>;
  categoryCount: number;
}) => {
  const absExpenses = Math.abs(totalExpenses);
  const absTopCategoryAmount =
    topCategories.length > 0 ? Math.abs(topCategories[0]?.amount || 0) : 0;
  const absCurrentBalance =
    currentBankBalance !== undefined ? Math.abs(currentBankBalance) : 0;
  const hasRealBreakdownData =
    categoryCount > 0 &&
    topCategories.length > 0 &&
    topCategories[0]?.name !== 'Total Expenses';

  const rawSavingsRate = totalIncome > 0 ? (totalIncome - absExpenses) / totalIncome : 0;
  const savingsScore = Math.max(0, Math.min(100, rawSavingsRate * 200));
  const diversityScore =
    hasRealBreakdownData && absExpenses > 0
      ? Math.round((1 - absTopCategoryAmount / absExpenses) * 100)
      : undefined;
  const impulseControl = diversityScore;
  const dailyBurnRate = absExpenses / 30;
  const runwayDays = dailyBurnRate > 0 ? absCurrentBalance / dailyBurnRate : 0;
  const runwayScore = Math.max(0, Math.min(100, (runwayDays / 60) * 100));

  return {
    absExpenses,
    absTopCategoryAmount,
    absCurrentBalance,
    hasRealBreakdownData,
    rawSavingsRate,
    savingsScore,
    diversityScore,
    impulseControl,
    runwayDays,
    runwayScore,
  };
};
