export type SmartActionType = 'anomaly' | 'budget_overrun' | 'optimization' | 'fixed_variation' | 'unusual_purchase' | 'seasonal_alert';
export type SmartActionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SmartActionStatus = 'active' | 'dismissed' | 'resolved' | 'snoozed';

export interface SmartActionMetadata {
  current_total?: number;
  average_monthly?: number;
  percent_increase?: number;
  historical_period_months?: number;
  budget_id?: number;
  budget_limit?: number;
  spent_amount?: number;
  overage?: number;
  percent_used?: number;
  days_remaining?: number;
  daily_avg?: number;
  projected_total?: number;
  will_exceed?: boolean;
  recommended_daily_limit?: number;
  avg_amount?: number;
  min_amount?: number;
  max_amount?: number;
  variation_coefficient?: number;
  transaction_id?: string;
  transaction_name?: string;
  transaction_date?: string;
  amount?: number;
  category_mean?: number;
  category_std_dev?: number;
  z_score?: number;
}

export interface SmartAction {
  id: number;
  action_type: SmartActionType;
  trigger_category_id?: number;
  severity: SmartActionSeverity;
  title: string;
  description?: string;
  detected_at: string;
  resolved_at?: string;
  dismissed_at?: string;
  snoozed_until?: string;
  user_status: SmartActionStatus;
  metadata?: SmartActionMetadata;
  potential_impact?: number;
  detection_confidence: number;
  is_recurring: boolean;
  recurrence_key?: string;
  created_at: string;
  updated_at: string;
  category_name?: string;
  category_name_en?: string;
  parent_category_name?: string;
}

export interface SmartActionsSummary {
  total: number;
  by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  by_type: {
    anomaly: number;
    budget_overrun: number;
    fixed_variation: number;
    unusual_purchase: number;
  };
  total_potential_impact: number;
}

export interface SmartActionsResponse {
  actions: SmartAction[];
  summary: SmartActionsSummary;
}

export interface GenerateSmartActionsResponse {
  success: boolean;
  total_detected: number;
  created: number;
  skipped: number;
  breakdown: {
    anomalies: number;
    fixed_variations: number;
    unusual_purchases: number;
    budget_overruns: number;
  };
}
