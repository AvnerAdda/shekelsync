/**
 * Subscription Management Types
 */

export type SubscriptionFrequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'yearly'
  | 'variable';

export type SubscriptionStatus =
  | 'active'
  | 'paused'
  | 'cancelled'
  | 'keep'
  | 'review';

export type AlertType =
  | 'price_increase'
  | 'price_decrease'
  | 'missed_charge'
  | 'duplicate'
  | 'unused'
  | 'upcoming_renewal'
  | 'cancelled_still_charging';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Subscription {
  id: number | null;
  pattern_key: string;
  display_name: string;
  detected_frequency: SubscriptionFrequency;
  detected_amount: number;
  amount_is_fixed: number;
  consistency_score: number;
  user_frequency: SubscriptionFrequency | null;
  user_amount: number | null;
  billing_day: number | null;
  status: SubscriptionStatus;
  category_definition_id: number | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  parent_category_name: string | null;
  first_detected_date: string | null;
  last_charge_date: string | null;
  next_expected_date: string | null;
  is_manual: number;
  notes: string | null;
  occurrence_count: number;
  total_spent: number;
}

export interface SubscriptionAlert {
  id: number | null;
  subscription_id: number;
  subscription_name: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string | null;
  old_amount: number | null;
  new_amount: number | null;
  percentage_change: number | null;
  is_dismissed: number;
  dismissed_at: string | null;
  is_actioned: number;
  actioned_at: string | null;
  action_taken: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface CategoryBreakdown {
  name: string;
  icon: string | null;
  color: string | null;
  count: number;
  monthly_total: number;
}

export interface FrequencyBreakdown {
  frequency: SubscriptionFrequency;
  count: number;
  monthly_total: number;
}

export interface SubscriptionSummary {
  total_count: number;
  active_count: number;
  monthly_total: number;
  yearly_total: number;
  category_breakdown: CategoryBreakdown[];
  frequency_breakdown: FrequencyBreakdown[];
}

export interface CreepDataPoint {
  month: string;
  total: number;
  subscription_count: number;
  growth_percentage: number;
}

export interface SubscriptionCreep {
  data: CreepDataPoint[];
  total_creep_percentage: number;
  starting_total: number;
  current_total: number;
  months_analyzed: number;
}

export interface SubscriptionRenewal extends Subscription {
  days_until_renewal: number;
}

// API Response Types
export interface GetSubscriptionsResponse {
  subscriptions: Subscription[];
}

export interface GetSubscriptionSummaryResponse extends SubscriptionSummary {}

export interface GetSubscriptionCreepResponse extends SubscriptionCreep {}

export interface GetSubscriptionAlertsResponse {
  alerts: SubscriptionAlert[];
  total_count: number;
  critical_count: number;
  warning_count: number;
}

export interface GetUpcomingRenewalsResponse {
  renewals: SubscriptionRenewal[];
}

export interface UpdateSubscriptionRequest {
  display_name?: string;
  user_frequency?: SubscriptionFrequency | null;
  user_amount?: number | null;
  billing_day?: number | null;
  status?: SubscriptionStatus;
  category_definition_id?: number | null;
  notes?: string | null;
}

export interface AddSubscriptionRequest {
  display_name: string;
  detected_frequency?: SubscriptionFrequency;
  detected_amount?: number;
  user_frequency?: SubscriptionFrequency;
  user_amount?: number;
  billing_day?: number;
  status?: SubscriptionStatus;
  category_definition_id?: number;
  notes?: string;
}

export interface MutationResponse {
  success: boolean;
  id?: number;
  action?: string;
  created?: number;
  updated?: number;
}

// Frequency display mapping
export const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  bimonthly: 'Bi-monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  variable: 'Variable',
};

// Status display mapping
export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  keep: 'Keep',
  review: 'Review',
};

// Status colors for UI
export const STATUS_COLORS: Record<SubscriptionStatus, string> = {
  active: '#4caf50',
  paused: '#ff9800',
  cancelled: '#f44336',
  keep: '#2196f3',
  review: '#9c27b0',
};

// Alert severity colors
export const ALERT_SEVERITY_COLORS: Record<AlertSeverity, string> = {
  info: '#2196f3',
  warning: '#ff9800',
  critical: '#f44336',
};
