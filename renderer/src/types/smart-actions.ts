export type SmartActionType = 
  | 'anomaly' 
  | 'budget_overrun' 
  | 'optimization' 
  | 'fixed_variation' 
  | 'unusual_purchase' 
  | 'seasonal_alert'
  | 'fixed_recurring_change'
  | 'fixed_recurring_missing'
  | 'fixed_recurring_duplicate'
  | 'optimization_reallocate'
  | 'optimization_add_budget'
  | 'optimization_low_confidence'
  // Quest types
  | 'quest_reduce_spending'
  | 'quest_savings_target'
  | 'quest_budget_adherence'
  | 'quest_set_budget'
  | 'quest_reduce_fixed_cost'
  | 'quest_income_goal'
  | 'quest_merchant_limit'
  | 'quest_weekend_limit';

export type SmartActionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SmartActionStatus = 'active' | 'dismissed' | 'resolved' | 'snoozed' | 'accepted' | 'failed';
export type QuestDifficulty = 'easy' | 'medium' | 'hard';

export interface SmartActionMetadata {
  current_total?: number;
  average_monthly?: number;
  expected_monthly?: number;
  percent_increase?: number;
  percent_deviation?: number;
  historical_period_months?: number;
  budget_id?: number;
  budget_limit?: number;
  spent_amount?: number;
  forecasted?: number;
  overage?: number;
  projected_overage?: number;
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
  coefficient_of_variation?: number;
  transaction_id?: string;
  transaction_name?: string;
  transaction_date?: string;
  amount?: number;
  expected_amount?: number;
  actual_amount?: number;
  deviation_pct?: number;
  category_mean?: number;
  category_std_dev?: number;
  z_score?: number;
  pattern_confidence?: number;
  pattern_type?: string;
  months_of_history?: number;
  is_fixed_recurring?: boolean;
  status?: string;
  risk?: number;
  alert_threshold?: number;
  next_hit_date?: string;
  actions?: string[];
  expected_count?: number;
  actual_count?: number;
  total_amount?: number;
  transactions?: Array<{ date: string; amount: number; name: string }>;
  expected_day?: number;
  current_day?: number;
  change_type?: string;
  surplus?: number;
  utilization_pct?: number;
  suggested_budget?: number;
  confidence?: number;
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
  category_name_fr?: string;
  category_name_he?: string;
  parent_category_name?: string;
  parent_category_name_en?: string;
  parent_category_name_fr?: string;
  parent_category_name_he?: string;
  // Quest-specific fields
  deadline?: string;
  accepted_at?: string;
  points_reward?: number;
  points_earned?: number;
  completion_criteria?: QuestCompletionCriteria;
  completion_result?: QuestCompletionResult;
  quest_difficulty?: QuestDifficulty;
  quest_duration_days?: number;
  // Progress (calculated client-side for active quests)
  progress?: QuestProgress;
  time_remaining?: QuestTimeRemaining;
}

export interface QuestCompletionCriteria {
  type:
    | 'spending_limit'
    | 'budget_adherence'
    | 'budget_exists'
    | 'fixed_cost_reduction'
    | 'savings_transfer'
    | 'merchant_frequency_limit'
    | 'weekend_spending_limit';
  category_definition_id?: number;
  budget_id?: number;
  target_amount?: number;
  target_limit?: number;
  baseline_amount?: number;
  comparison?: 'less_than' | 'less_than_or_equal' | 'greater_than' | 'greater_than_or_equal';
  merchant_pattern?: string;
  max_transactions?: number;
  baseline_transactions?: number;
  days_of_week?: number[];
}

export interface QuestCompletionResult {
  success: boolean;
  actual_value?: number;
  achievement_pct?: number;
  points_earned: number;
  verified_at: string;
}

export interface QuestProgress {
  current: number;
  target: number;
  percentage: number;
  on_track: boolean;
}

export interface QuestTimeRemaining {
  days: number;
  expired: boolean;
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
    fixed_recurring_anomalies?: number;
    optimization_opportunities?: number;
  };
}

// Quest System Types
export interface UserQuestStats {
  id: number;
  total_points: number;
  current_streak: number;
  best_streak: number;
  quests_completed: number;
  quests_failed: number;
  quests_declined: number;
  level: number;
  last_completed_at?: string;
  streak_reset?: boolean;
  level_progress: LevelProgress;
  created_at: string;
  updated_at: string;
}

export interface LevelProgress {
  current_level: number;
  next_level?: number;
  points_for_next?: number;
  points_needed?: number;
  progress_pct?: number;
  max_level_reached?: boolean;
}

export interface QuestsResponse {
  quests: SmartAction[];
  count: number;
}

export interface GenerateQuestsResponse {
  success: boolean;
  total_generated: number;
  created: number;
  active_count: number;
  slots_remaining: number;
  message?: string;
  error?: string;
}

export interface AcceptQuestResponse {
  success: boolean;
  quest_id: number;
  deadline: string;
  points_reward: number;
}

export interface VerifyQuestResponse {
  success: boolean;
  quest_id: number;
  points_earned: number;
  achievement_pct: number;
  actual_value?: number;
  new_status: SmartActionStatus;
}

export interface CheckDeadlinesResponse {
  verified: number;
  failed: number;
  checked: number;
  active_quests: number;
  new_quests_generated: number;
  errors: Array<{ quest_id: number; error: string }>;
}

export const LEVEL_TIERS = [
  { level: 1, points: 0 },
  { level: 2, points: 100 },
  { level: 3, points: 300 },
  { level: 4, points: 600 },
  { level: 5, points: 1000 },
  { level: 6, points: 1500 },
  { level: 7, points: 2200 },
  { level: 8, points: 3000 },
  { level: 9, points: 4000 },
  { level: 10, points: 5000 },
] as const;
