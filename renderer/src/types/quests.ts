/**
 * Quest System Types
 */

export type QuestActionType = 
  | 'quest_reduce_spending'
  | 'quest_savings_target'
  | 'quest_budget_adherence'
  | 'quest_set_budget'
  | 'quest_reduce_fixed_cost'
  | 'quest_income_goal';

export type QuestStatus = 'active' | 'dismissed' | 'resolved' | 'accepted' | 'failed';
export type QuestDifficulty = 'easy' | 'medium' | 'hard';
export type QuestSeverity = 'low' | 'medium' | 'high';

export interface QuestMetadata {
  quest_type?: string;
  target_amount?: number;
  current_average?: number;
  reduction_pct?: number;
  pattern_confidence?: number;
  variability_type?: string;
  budget_id?: number;
  budget_limit?: number;
  current_spent?: number;
  remaining?: number;
  risk_score?: number;
  suggested_budget?: number;
  avg_monthly?: number;
  min_amount?: number;
  max_amount?: number;
  coefficient_of_variation?: number;
  current_amount?: number;
  is_fixed_recurring?: boolean;
  total_surplus?: number;
  contributing_categories?: Array<{
    id: number;
    name: string;
    surplus: number;
  }>;
}

export interface QuestCompletionCriteria {
  type: 'spending_limit' | 'budget_adherence' | 'budget_exists' | 'fixed_cost_reduction' | 'savings_transfer';
  category_definition_id?: number;
  budget_id?: number;
  target_amount?: number;
  target_limit?: number;
  baseline_amount?: number;
  comparison?: 'less_than' | 'less_than_or_equal' | 'greater_than' | 'greater_than_or_equal';
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

export interface Quest {
  id: number;
  action_type: QuestActionType;
  trigger_category_id?: number;
  severity: QuestSeverity;
  title: string;
  description?: string;
  detected_at: string;
  resolved_at?: string;
  dismissed_at?: string;
  user_status: QuestStatus;
  metadata?: QuestMetadata;
  potential_impact?: number;
  detection_confidence: number;
  is_recurring: boolean;
  recurrence_key?: string;
  created_at: string;
  updated_at: string;
  category_name?: string;
  category_name_en?: string;
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

// Keep SmartAction as an alias for backward compatibility with existing code
export type SmartAction = Quest;

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
  quests: Quest[];
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
  new_status: QuestStatus;
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
