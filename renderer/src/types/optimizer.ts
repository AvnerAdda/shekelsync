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
  createdAt: string;
  updatedAt: string;
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
