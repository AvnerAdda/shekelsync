export type RhythmGranularity = 'month' | 'week' | 'day';
export type RhythmMetric = 'spend' | 'income';
export type RhythmScope = 'all' | 'everyday';
export type PaceStatus = 'above' | 'below' | 'within' | 'insufficient';

export interface LocalizedCategory {
  categoryId: number | null;
  name: string | null;
  nameEn: string | null;
  nameFr: string | null;
}

export interface RhythmPace {
  x: number;
  length: number;
  current: number;
  median: number | null;
  low: number | null;
  high: number | null;
  status: PaceStatus;
  deltaAmount: number | null;
  deltaPercent: number | null;
  typicalTotal?: number | null;
  projectedTotal?: number | null;
}

export interface RhythmPoint {
  x: number;
  current: number | null;
  previous: number | null;
  median: number | null;
  low: number | null;
  high: number | null;
}

export interface RhythmDriver extends LocalizedCategory {
  current: number;
  typical: number;
  delta: number;
}

export interface RhythmNewMerchant {
  merchant: string;
  amount: number;
  count: number;
  category: LocalizedCategory;
}

export interface RhythmPeriodTotal {
  key: string;
  start: string;
  end: string;
  isCurrent: boolean;
  total: number;
  projected?: number | null;
}

export interface RhythmDayTransaction {
  identifier: string;
  vendor: string;
  name: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  categoryNameEn: string | null;
  categoryNameFr: string | null;
}

export interface RhythmDay {
  date: string;
  weekday: number;
  value: number;
  median: number | null;
  low: number | null;
  high: number | null;
  unusual: boolean;
  transactions: RhythmDayTransaction[];
}

export interface TypeMismatchCheck {
  type: 'type_mismatch';
  count: number;
  transactions: Array<{
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    amount: number;
    storedType: string;
    categoryType: string;
    categoryName: string | null;
    categoryNameEn: string | null;
    categoryNameFr: string | null;
  }>;
}

export interface StaleAccountCheck {
  type: 'stale_account';
  vendor: string;
  nickname: string | null;
  lastSuccess: string | null;
  days: number | null;
  lastStatus: string | null;
}

export interface CategoryDriftCheck {
  type: 'category_drift';
  merchant: string;
  date: string;
  amount: number;
  count: number;
  identifier: string;
  vendor: string;
  category: LocalizedCategory & { type: string };
  usualCategory: LocalizedCategory & { type: string; count: number };
}

export type RhythmCheck = TypeMismatchCheck | StaleAccountCheck | CategoryDriftCheck;

export interface RhythmComparison {
  granularity: RhythmGranularity;
  metric: RhythmMetric;
  scope: RhythmScope;
  asOf: string;
  coverageStart: string | null;
  pace: RhythmPace;
  checks: RhythmCheck[];
  current?: { key: string; start: string; end: string };
  points?: RhythmPoint[];
  drivers?: RhythmDriver[];
  newMerchants?: RhythmNewMerchant[];
  periods?: RhythmPeriodTotal[];
  days?: RhythmDay[];
  unusualDays?: number;
}
