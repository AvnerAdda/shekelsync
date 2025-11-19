export type BreakdownType = 'expense' | 'income' | 'investment';

export interface WaterfallSummary {
  totalIncome: number;
  totalExpenses: number;
  netInvestments: number;
  netBalance: number;
  totalTransactions: number;
}

export interface WaterfallDataPoint {
  name: string;
  value: number;
  type: 'income' | 'expense' | 'investment' | 'net';
  cumulative: number;
  startValue: number;
  color: string;
  count: number;
}

export interface WaterfallBreakdownSections {
  income: any[];
  expenses: any[];
  investments: any[];
}

export interface WaterfallFlowData {
  summary: WaterfallSummary;
  waterfallData: WaterfallDataPoint[];
  breakdown: WaterfallBreakdownSections;
}
