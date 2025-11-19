/**
 * TypeScript types for Manual Matching feature
 */

export interface ProcessedDate {
  processedDate: string;
  expenseCount: number;
  totalAmount: number;
  earliestExpenseDate: string;
  latestExpenseDate: string;
}

export interface BankRepaymentForDate {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  accountNumber: string | null;
}

export interface BankRepaymentsForDateResponse {
  processedDate: string;
  repayments: BankRepaymentForDate[];
  totalRepaymentAmount: number;
  repaymentCount: number;
}

export interface ExpenseWithProcessedDate {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  accountNumber: string | null;
  categoryId: number | null;
  categoryName: string | null;
  processedDate?: string | null;
  isMatched?: boolean;
}

export interface SmartMatchingSuggestion {
  processedDate: string;
  ccExpenseCount: number;
  ccTotalAmount: number;
  bankRepaymentCount: number;
  bankTotalAmount: number;
  difference: number;
  matchQuality: 'perfect' | 'good' | 'fair' | 'poor';
  suggestedFees?: number;
}
