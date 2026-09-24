export const PLANNING_CHANGED_EVENT = 'planningChanged';

export interface SavingsGoalInput {
  name: string;
  target_amount: number;
  saved_amount: number;
  monthly_contribution: number;
  target_date: string | null;
  reserve_location: 'included_cash' | 'external';
}

export interface SavingsGoal extends SavingsGoalInput {
  id: number;
  remaining_amount: number;
  required_monthly_contribution: number | null;
  on_track: boolean | null;
  months_until_target: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioChange {
  id: string;
  label: string;
  amount: number;
  date: string;
  frequency: 'one_time' | 'monthly';
  end_date?: string | null;
}

export interface CashScenarioInput {
  name: string;
  changes: ScenarioChange[];
}

export interface CashScenario extends CashScenarioInput {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningSettings {
  cash_buffer: number;
  next_income_date: string | null;
  card_commitments_amount: number | null;
  card_commitments_confirmed_at: string | null;
}

export interface PlanningData {
  goals: SavingsGoal[];
  scenarios: CashScenario[];
  settings: PlanningSettings;
}

export interface PlanningProjection {
  status: 'ready' | 'incomplete';
  currency: 'ILS';
  generated_at: string;
  as_of_date: string;
  horizon_days: number;
  next_income_date: string | null;
  next_income_source?: 'detected' | 'manual' | null;
  spending_period_end?: string;
  spending_source?: 'forecast' | 'recent_spending';
  spending_history_days?: number | null;
  card_commitments_source?: 'imported' | 'estimated' | 'manual' | 'unavailable';
  available_spend: number | null;
  shortfall: number | null;
  cash_balance: number | null;
  cash_buffer: number;
  reserved_cash: number;
  planned_contributions: number;
  card_commitments: number | null;
  card_confirmation_required: boolean;
  latest_balance_date: string | null;
  forecast_expenses_until_income: number | null;
  lowest_balance: number | null;
  ending_balance: number | null;
  daily: Array<{ date: string; income: number; expenses: number; contributions: number; scenario_change: number; balance: number | null }>;
  monthly: Array<{ month: string; income: number; expenses: number; contributions: number; scenario_change: number; ending_balance: number | null }>;
  reasons: Array<{ code: string; message: string }>;
  assumptions: string[];
}

export interface ScenarioPreview {
  baseline: PlanningProjection;
  scenario: PlanningProjection;
  comparison: {
    end_balance_delta: number | null;
    lowest_balance_delta: number | null;
    available_spend_delta: number | null;
  };
}
