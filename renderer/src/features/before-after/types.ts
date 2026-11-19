export type BeforeAfterStatus = 'ready' | 'waiting' | 'no_history' | 'no_sync';
export type BeforeAfterVerdict = 'better' | 'worse' | 'unchanged' | 'insufficient';
export type NeededReason = 'essential' | 'stability' | 'growth' | null;

export interface BeforeAfterWindow {
  months: string[];
  start: string;
  end: string;
}

export interface BeforeAfterWindows {
  status: BeforeAfterStatus;
  months: number;
  frontierMonth: string;
  readyOn: string | null;
  fullMonthsAfter: number;
  fullMonthsBefore: number;
  historyStart: string | null;
  before: BeforeAfterWindow | null;
  after: BeforeAfterWindow | null;
}

export interface SideComparison {
  before: number | null;
  after: number | null;
  delta: number | null;
  deltaPercent: number | null;
  threshold?: number;
  verdict: BeforeAfterVerdict;
}

export interface RecurringChange {
  name: string;
  monthlyAmount: number;
  yearlyAmount: number;
  lastCharge?: string;
  firstCharge?: string;
}

export interface LargeOneOff {
  day: string;
  phase: 'before' | 'after';
  name: string | null;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  categoryNameEn: string | null;
  categoryNameFr: string | null;
}

export interface BeforeAfterMetrics {
  controllableSpend: SideComparison & {
    shareBefore: number | null;
    shareAfter: number | null;
    largeOneOffs: {
      threshold: number;
      beforeTotal: number;
      afterTotal: number;
      beforeCount: number;
      afterCount: number;
      items: LargeOneOff[];
    };
  };
  subscriptions: {
    stopped: RecurringChange[];
    started: RecurringChange[];
    stoppedYearly: number;
    startedYearly: number;
    netYearly: number;
    verdict: BeforeAfterVerdict;
  };
  kept: SideComparison & { rateBefore: number | null; rateAfter: number | null };
  fees: SideComparison;
  income: Pick<SideComparison, 'before' | 'after' | 'delta' | 'deltaPercent'>;
}

export interface BeforeAfterCategory {
  key: string;
  categoryId: number | null;
  name: string | null;
  nameEn: string | null;
  nameFr: string | null;
  defaultReason: NeededReason;
  defaultNeeded: boolean;
  needed: boolean;
  overridden: boolean;
  beforeMonthly: number;
  afterMonthly: number;
}

export interface BeforeAfterMonth {
  month: string;
  phase: 'before' | 'after';
  income: number;
  spend: number;
  controllableSpend: number;
  largeOneOffs: number;
  neededSpend: number;
  invested: number;
  fees: number;
  kept: number;
  keptRate: number | null;
  controllableShare: number | null;
}

export interface BeforeAfterResponse {
  status: BeforeAfterStatus;
  frontier: { day: string; source: 'sync' | 'saved' | 'install' | null } | null;
  windows: BeforeAfterWindows | null;
  coverageStart?: string | null;
  metrics: BeforeAfterMetrics | null;
  categories: BeforeAfterCategory[];
  monthly: BeforeAfterMonth[];
}
