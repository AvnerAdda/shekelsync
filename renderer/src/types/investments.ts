export interface PortfolioBreakdownItem {
  name: string;
  value: number;
  percentage: number;
  category: string;
}

export interface InvestmentSummaryTotals {
  totalPortfolioValue?: number;
  liquid?: { totalValue?: number };
  restricted?: { totalValue?: number };
}

export interface InvestmentBreakdownEntry {
  category: string;
  name?: string;
  type?: string;
  totalValue: number;
}

export interface InvestmentSummaryResponse {
  summary?: InvestmentSummaryTotals | null;
  breakdown?: InvestmentBreakdownEntry[] | null;
}
