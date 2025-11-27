export interface BudgetUsageSummary {
  percentage: number;
  [key: string]: unknown;
}

export type BudgetUsageResponse = BudgetUsageSummary[];
