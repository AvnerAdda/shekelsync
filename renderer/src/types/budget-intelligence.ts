export interface BudgetSuggestion {
  id: number;
  category_definition_id: number;
  period_type: 'weekly' | 'monthly' | 'yearly';
  suggested_limit: number;
  confidence_score: number;
  variability_coefficient?: number;
  based_on_months: number;
  is_active: boolean;
  activated_at?: string;
  deactivated_at?: string;
  created_at: string;
  updated_at: string;
  historical_data?: {
    monthly_amounts: number[];
    months: string[];
  };
  calculation_metadata?: {
    mean: number;
    median: number;
    min: number;
    max: number;
    std_dev: number;
    coefficient_of_variation: number;
  };
  category_name: string;
  category_name_en?: string;
  parent_category_name?: string;
  active_budget_id?: number;
  active_budget_limit?: number;
  has_active_budget: boolean;
}

export interface BudgetSuggestionsResponse {
  suggestions: BudgetSuggestion[];
}

export interface GenerateBudgetSuggestionsResponse {
  success: boolean;
  total_suggestions: number;
  suggestions: Array<{
    category_id: number;
    category_name: string;
    suggested_limit: number;
    confidence: number;
    based_on_months: number;
  }>;
}

export interface BudgetTrajectory {
  budget_id: number;
  category_definition_id: number;
  period_start: string;
  period_end: string;
  budget_limit: number;
  spent_amount: number;
  remaining_amount: number;
  percent_used: number;
  days_total: number;
  days_passed: number;
  days_remaining: number;
  daily_avg: number;
  daily_limit: number;
  projected_total: number;
  is_on_track: boolean;
  overrun_risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

export interface BudgetTrajectoryResponse {
  trajectory: BudgetTrajectory;
}

export interface BudgetHealthItem {
  budget_id: number;
  category_id: number;
  category_name: string;
  category_name_en?: string;
  budget_limit: number;
  current_spent: number;
  percentage_used: number;
  days_remaining: number;
  projected_total: number;
  daily_limit: number;
  daily_avg?: number;
  status: 'on_track' | 'warning' | 'exceeded';
}

export interface BudgetHealthSummary {
  total_budgets: number;
  on_track: number;
  warning: number;
  exceeded: number;
  total_budget: number;
  total_spent: number;
}

export interface BudgetHealthResponse {
  success: boolean;
  budgets: BudgetHealthItem[];
  summary: BudgetHealthSummary;
  overall_status: 'good' | 'warning' | 'critical';
}
