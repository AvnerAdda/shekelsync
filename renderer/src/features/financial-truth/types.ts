export type CorrectionAction =
  | 'skip_occurrence'
  | 'suppress_pattern'
  | 'end_pattern'
  | 'pause_pattern'
  | 'override_pattern'
  | 'set_category_expectation';

export type CorrectionScope = 'occurrence' | 'from_date' | 'current_month' | 'ongoing';

export interface CorrectionTarget {
  kind: 'pattern' | 'occurrence' | 'category';
  patternId?: number;
  occurrenceId?: string;
  categoryDefinitionId?: number;
  title: string;
  amount?: number;
  frequency?: string;
  nextExpectedDate?: string;
  capabilities?: CorrectionAction[];
}

export interface CorrectionDraft {
  requestId?: string;
  target: Omit<CorrectionTarget, 'title' | 'amount' | 'frequency' | 'capabilities'>;
  action: CorrectionAction;
  scope: CorrectionScope;
  effectiveDate?: string;
  reasonCode: string;
  source: { feature: string; sourceKey?: string };
  overrides?: {
    amount?: number;
    frequency?: string;
    nextExpectedDate?: string;
    billingDay?: number;
    monthlyAmount?: number;
  };
}

export interface FinancialCorrection {
  id: number;
  requestId: string;
  targetKind: CorrectionTarget['kind'];
  patternId: number | null;
  occurrenceId: string | null;
  categoryDefinitionId: number | null;
  action: CorrectionAction;
  scope: CorrectionScope;
  effectiveDate: string | null;
  reasonCode: string | null;
  sourceFeature: string;
  sourceKey: string | null;
  status: 'active' | 'reverted' | 'superseded';
  targetLabel?: string;
  affectedDomains?: string[];
  createdAt: string;
  revertedAt: string | null;
}

export interface CorrectionPreview {
  success: boolean;
  truthRevision: number;
  impact: {
    monthlyDelta: number;
    sixMonthDelta: number;
    affectedSurfaces: string[];
  };
}

export interface CorrectionMutationResponse {
  success: boolean;
  correction: FinancialCorrection;
  truthRevision: number;
  affectedDomains: string[];
  refreshState: 'pending' | 'ready';
}

export interface FinancialTruthChangedDetail {
  truthRevision: number;
  affectedDomains: string[];
  correctionId: number;
  refreshState: 'pending' | 'ready';
}

export const FINANCIAL_TRUTH_CHANGED_EVENT = 'financialTruthChanged';

export function financialTruthChangeAffects(event: Event, domains: string[]): boolean {
  const detail = (event as CustomEvent<FinancialTruthChangedDetail>).detail;
  return Array.isArray(detail?.affectedDomains)
    && domains.some((domain) => detail.affectedDomains.includes(domain));
}
