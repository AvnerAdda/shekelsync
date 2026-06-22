export type AnalysisTabKey =
  | 'dashboard'
  | 'actions'
  | 'spending'
  | 'budget'
  | 'scoring'
  | 'subscriptions'
  | 'profiling';

export interface AnalysisTabDefinition {
  key: AnalysisTabKey;
  index: number;
}

export const ANALYSIS_TAB_DEFINITIONS: AnalysisTabDefinition[] = [
  { key: 'dashboard', index: 0 },
  { key: 'actions', index: 1 },
  { key: 'spending', index: 2 },
  { key: 'budget', index: 3 },
  { key: 'scoring', index: 4 },
  { key: 'subscriptions', index: 5 },
  { key: 'profiling', index: 6 },
];

const ANALYSIS_TAB_KEY_SET = new Set<AnalysisTabKey>(
  ANALYSIS_TAB_DEFINITIONS.map((tab) => tab.key),
);

export const ANALYSIS_TAB_INDEX: Record<AnalysisTabKey, number> = ANALYSIS_TAB_DEFINITIONS.reduce(
  (accumulator, tab) => {
    accumulator[tab.key] = tab.index;
    return accumulator;
  },
  {} as Record<AnalysisTabKey, number>,
);

export function isAnalysisTabKey(value: string): value is AnalysisTabKey {
  return ANALYSIS_TAB_KEY_SET.has(value as AnalysisTabKey);
}
