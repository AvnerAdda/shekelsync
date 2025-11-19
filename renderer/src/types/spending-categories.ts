export type SpendingCategory = 'growth' | 'stability' | 'essential' | 'reward' | 'other';
export type VariabilityType = 'fixed' | 'variable' | 'seasonal';

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
  category_type: string;
  parent_category_name?: string;
  parent_category_name_en?: string;
}

export interface SpendingCategoryTarget {
  spending_category: SpendingCategory;
  target_percentage: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpendingCategoryBreakdownItem {
  spending_category: SpendingCategory;
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
  targets: Record<SpendingCategory, number>;
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
