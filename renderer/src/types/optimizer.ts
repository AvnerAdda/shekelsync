export type OptimizerFactStatus = 'detected' | 'confirmed' | 'edited' | 'unknown' | 'skipped';
export type OptimizerRecommendationStatus = 'active' | 'done' | 'dismissed';
export type OptimizerHassleLevel = 'low' | 'medium' | 'high';

export interface OptimizerFact {
  id?: number;
  factKey: string;
  section: string;
  label: string;
  value: unknown;
  valueText: string | null;
  status: OptimizerFactStatus;
  source: string;
  confidence: number | null;
  evidence?: unknown;
  inputType: OptimizerQuestion['inputType'];
  options?: string[];
  persisted?: boolean;
  confirmedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface OptimizerQuestion {
  factKey: string;
  section: string;
  label: string;
  prompt: string;
  inputType: 'text' | 'number' | 'currency' | 'select';
  options?: string[];
}

export interface OptimizerRun {
  id: number;
  runUuid: string;
  status: 'complete' | 'failed';
  promptVersion: string;
  model: string;
  generatedAt: string;
  errorMessage?: string | null;
}

export interface OptimizerRecommendation {
  id: number;
  runId: number;
  smartActionItemId: number | null;
  title: string;
  section: string;
  rationale: string | null;
  evidence: string[];
  estimatedMonthlyImpact: number;
  hassleLevel: OptimizerHassleLevel;
  confidence: number;
  nextAction: string | null;
  caveat: string | null;
  status: OptimizerRecommendationStatus;
  userNote: string | null;
  realizedMonthlySavings: number | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OptimizerHistoryRun extends OptimizerRun {
  recommendationCount: number;
  activeCount: number;
  doneCount: number;
  dismissedCount: number;
  estimatedMonthlyImpact: number;
  realizedMonthlySavings: number;
}

export interface OptimizerHistoryResponse {
  runs: OptimizerHistoryRun[];
}

export interface OptimizerStatusResponse {
  facts: OptimizerFact[];
  detectedFacts: OptimizerFact[];
  questions: OptimizerQuestion[];
  missingFields: string[];
  progress: {
    totalQuestions: number;
    resolvedQuestions: number;
    unresolvedQuestions: number;
  };
  latestRun: OptimizerRun | null;
  recommendations: OptimizerRecommendation[];
  isStale: boolean;
}

export type OptimizerV2ReviewStatus = 'pending' | 'confirmed' | 'excluded';
export type OptimizerV2Scope = 'general' | 'spending_subscriptions' | 'banking_cards'
  | 'cash_deposits' | 'investments_retirement' | 'real_estate_mortgage';
export type OptimizerV2Lifecycle = 'candidate' | 'added' | 'started' | 'snoozed' | 'done' | 'dismissed';

export interface OptimizerV2ReviewFact {
  key: string;
  label: string;
  value: unknown;
  kind: 'text' | 'currency' | 'count' | 'percent' | 'list' | 'mapping' | 'category_list';
  source: string | null;
  asOf: string | null;
  sensitive: boolean;
}

export interface OptimizerV2ReviewGroup {
  key: 'household' | 'cash_flow' | 'banking' | 'investments' | 'real_estate';
  title: string;
  facts: OptimizerV2ReviewFact[];
  provenance: string[];
  recorded: boolean;
  stale: boolean;
  freshnessDays: number | null;
  fingerprint: string;
  sourceRoute: { path: string; search?: string; hash?: string };
  status: OptimizerV2ReviewStatus;
  confirmedAt: string | null;
  confirmationExpiresAt: string | null;
}

export interface OptimizerV2ScopeSelection {
  primary: OptimizerV2Scope;
  extras: OptimizerV2Scope[];
  change: 'negotiate_only' | 'switch_selected' | 'broader_changes';
  effort: 'low' | 'medium' | 'high';
  liquidity: 'no_lockup' | 'up_to_3_months' | 'up_to_12_months';
  selectedProviders: string[];
}

export interface OptimizerV2EligibilityCondition {
  id: string;
  label: string;
  factKey: string;
  operator: string;
  expected: unknown;
}

export interface OptimizerV2Candidate {
  id: number;
  runId: number;
  actionId: string;
  smartActionItemId: number | null;
  scope: OptimizerV2Scope;
  provider: string | null;
  product: string | null;
  title: string;
  rationale: string;
  nextAction: string;
  caveat: string | null;
  eligibility: {
    status: 'matched' | 'possible' | 'ineligible';
    matchedFacts: OptimizerV2EligibilityCondition[];
    failedFacts: OptimizerV2EligibilityCondition[];
    missingConditions: OptimizerV2EligibilityCondition[];
    answers: Record<string, 'yes' | 'no' | 'not_sure'>;
  };
  benefits: {
    oneTime: { low: number; high: number };
    monthly: { low: number; high: number };
    annual: { low: number; high: number };
  };
  score: number;
  confidence: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  evidence: string[];
  publicTerms: {
    fees: { oneTime: number; monthly: number; annual: number };
    conditions: string[];
  } | null;
  sourceUrls: string[];
  retrievedAt: string | null;
  validUntil: string | null;
  reverifyRequired: boolean;
  lifecycleState: OptimizerV2Lifecycle;
  feedbackCode: 'useful' | 'not_useful' | 'unsure' | null;
  feedbackReasons: string[];
  outcomeBand: 'none' | 'below_estimate' | 'within_estimate' | 'above_estimate' | 'unknown' | null;
  snoozePreset: '1_week' | '1_month' | '3_months' | null;
  dismissReason: string | null;
  sourceVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OptimizerV2Run {
  id: number;
  runUuid: string;
  status: 'complete' | 'failed';
  scope: OptimizerV2ScopeSelection;
  checkedAreas: OptimizerV2Scope[];
  timings: { snapshotMs?: number; researchMs?: number; wordingMs?: number; persistenceMs?: number; totalMs?: number };
  sourceMetadata: Array<{
    title: string;
    url: string;
    domain: string;
    trustTier: 'regulator' | 'provider' | 'established' | 'lead';
    retrievedAt: string;
    validUntil: string | null;
  }>;
  researchStatus: 'not_requested' | 'complete' | 'partial' | 'fallback';
  scoreVersion: string;
  openaiModel: string | null;
  errors: string[];
  generatedAt: string;
  candidates: OptimizerV2Candidate[];
}

export interface OptimizerV2StatusResponse {
  success: boolean;
  feature: { name: 'optimizerV2'; enabled: boolean; version: 2 };
  review: {
    groups: OptimizerV2ReviewGroup[];
    ready: boolean;
    resolvedCount: number;
    totalCount: number;
    period: { startDate: string; endDate: string; completedMonths: number };
  };
  scopeOptions: OptimizerV2Scope[];
  defaults: OptimizerV2ScopeSelection;
  providers: { banking: string[]; subscriptions: string[]; investments: string[]; all: string[] };
  latestRun: OptimizerV2Run | null;
  history: Omit<OptimizerV2Run, 'candidates'>[];
}
