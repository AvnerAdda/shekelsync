export type MoneyReviewGroup = 'data' | 'cash' | 'improve';
export type MoneyReviewStatus = 'active' | 'accepted' | 'snoozed' | 'resolved' | 'dismissed';
export type SnoozePreset = '1_week' | '1_month' | '3_months';

export interface MoneyReviewAction {
  label?: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface MoneyReviewItem {
  id: number;
  source: string;
  sourceKey: string;
  group: MoneyReviewGroup;
  actionType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  status: MoneyReviewStatus;
  detectedAt: string;
  updatedAt: string;
  snoozedUntil: string | null;
  potentialImpact: number;
  confidence: number;
  priority: number;
  primaryAction: MoneyReviewAction | null;
  metadata: Record<string, unknown>;
}

export interface MoneyReviewSummary {
  open: number;
  snoozed: number;
  completed: number;
  estimatedMinutes: number;
  potentialImpact: number;
  byGroup: Record<MoneyReviewGroup, number>;
}

export interface ForecastAccuracySummary {
  available: boolean;
  evaluationWindowDays: number;
  readiness: 'collecting' | 'provisional' | 'established';
  observedDays: number;
  evaluatedFrom: string | null;
  evaluatedThrough: string | null;
  sampleCount: number;
  expenseMae: number | null;
  expenseMape: number | null;
  cashFlowMae: number | null;
  cashFlowBias: number | null;
  intervalCoverage: number | null;
}

export interface MoneyReviewResponse {
  success: boolean;
  generatedAt: string;
  truthRevision?: number;
  refreshState?: 'pending' | 'ready';
  forecastAccuracy?: ForecastAccuracySummary | null;
  summary: MoneyReviewSummary;
  items: MoneyReviewItem[];
}

export interface MoneyReviewUpdateResponse {
  success: boolean;
  item: MoneyReviewItem;
}
