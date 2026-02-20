export type AggregationPeriod = 'daily' | 'weekly' | 'monthly';

export interface DashboardHistoryEntry {
  date: string;
  income: number | null;
  expenses: number | null;
  capitalReturns?: number;
  cardRepayments?: number;
  pairedCardExpenses?: number;
  pairedCardRepayments?: number;
  bankBalance?: number;
}

export interface BankInstitutionMetadata {
  id: number;
  display_name_he: string;
  display_name_en: string;
  logo_url?: string;
}

export interface BankAccountBreakdown {
  accountId: number;
  accountName: string;
  currentBalance: number;
  asOfDate: string;
  institution?: BankInstitutionMetadata;
}

export interface DashboardData {
  dateRange: { start: Date; end: Date };
  summary: {
    totalIncome: number;
    totalCapitalReturns?: number;
    totalExpenses: number;
    netBalance: number;
    investmentOutflow: number;
    investmentInflow: number;
    netInvestments: number;
    totalAccounts: number;
    currentBankBalance?: number;
    monthStartBankBalance?: number;
    bankBalanceChange?: number;
    pendingExpenses?: number;
    pendingCount?: number;
  };
  history: DashboardHistoryEntry[];
  breakdowns: {
    byCategory: Array<{ category: string; total: number; count: number }>;
    byVendor: Array<{ vendor: string; total: number; count: number }>;
    byMonth: Array<{ month: string; income: number; expenses: number }>;
    byBankAccount?: BankAccountBreakdown[];
  };
}

export interface CumulativePoint {
  date: string;
  cumulative: number;
  netFlow: number;
  income?: number;
  expenses?: number;
  isActual: boolean;
  isPrediction: boolean;
}
