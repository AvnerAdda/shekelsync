export interface BudgetUsageSummary {
  percentage: number;
  [key: string]: unknown;
}

export interface BudgetUsageResponse extends Array<BudgetUsageSummary> {}
