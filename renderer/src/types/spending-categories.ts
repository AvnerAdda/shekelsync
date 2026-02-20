export type SpendingCategory = 'growth' | 'stability' | 'essential' | 'reward';
export type VariabilityType = 'fixed' | 'variable' | 'seasonal';
export type SpendingAllocation = SpendingCategory | 'unallocated';

// Allocation type descriptions
export const ALLOCATION_DESCRIPTIONS: Record<SpendingCategory, string> = {
  essential: 'Fixed costs: rent, utilities, groceries, transport',
  growth: 'Investments, savings, education, deposits',
  stability: 'Insurance, emergency funds, debt payments',
  reward: 'Entertainment, dining, travel, hobbies',
};

// Category with spending data for display
export interface CategoryWithSpending {
  category_definition_id: number;
  category_name: string;
  category_name_en?: string;
  category_name_fr?: string;
  icon?: string | null;
  spending_category: SpendingCategory | null;
  total_amount: number;
  percentage_of_income: number;
  transaction_count: number;
}

export interface SpendingCategoryMapping {
  id: number;
  category_definition_id: number;
  spending_category: SpendingCategory;
  variability_type: VariabilityType;
  is_auto_detected: boolean;
  target_percentage?: number;
  detection_confidence: number;
  user_overridden: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
  category_name: string;
  category_name_en?: string;
  category_name_fr?: string;
  category_type: string;
  parent_category_name?: string;
  parent_category_name_en?: string;
  parent_category_name_fr?: string;
}

export interface SpendingCategoryTarget {
  spending_category: SpendingCategory;
  target_percentage: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpendingCategoryBreakdownItem {
  spending_category: SpendingAllocation;
  transaction_count: number;
  total_amount: number;
  avg_transaction: number;
  first_transaction_date: string;
  last_transaction_date: string;
  actual_percentage: number;
  target_percentage: number;
  variance: number;
  status: 'over' | 'under' | 'on_track';
}

export interface SpendingCategoryBreakdownResponse {
  period: {
    start: string;
    end: string;
  };
  breakdown: SpendingCategoryBreakdownItem[];
  total_spending: number;
  total_income: number;
  total_salary: number;
  targets: Record<SpendingCategory, number>;
  categories_by_allocation: Record<SpendingAllocation, CategoryWithSpending[]>;
}

export interface SpendingCategoryTransactionItem {
  identifier: string;
  vendor: string;
  name: string;
  date: string;
  price: number;
  account_number: string | null;
  category_definition_id: number | null;
  category_type: string | null;
  status: string | null;
  category_name: string | null;
  category_name_en: string | null;
  category_name_fr: string | null;
}

export interface SpendingCategoryTransactionsResponse {
  period: {
    start: string;
    end: string;
  };
  spending_category: SpendingAllocation;
  transactions: SpendingCategoryTransactionItem[];
  total_count: number;
  total_amount: number;
  limit: number;
  offset: number;
}

export interface SpendingCategoryMappingsResponse {
  mappings: SpendingCategoryMapping[];
}

export interface InitializeSpendingCategoriesResponse {
  success: boolean;
  created: number;
  skipped: number;
  total: number;
}
