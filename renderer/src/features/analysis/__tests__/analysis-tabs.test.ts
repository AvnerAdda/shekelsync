import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_TAB_DEFINITIONS,
  ANALYSIS_TAB_INDEX,
  isAnalysisTabKey,
} from '../analysis-tabs';

describe('analysis tab definitions', () => {
  it('keeps every analysis workflow in display order', () => {
    expect(ANALYSIS_TAB_DEFINITIONS.map((tab) => tab.key)).toEqual([
      'dashboard',
      'actions',
      'spending',
      'budget',
      'scoring',
      'subscriptions',
      'profiling',
    ]);
  });

  it('preserves tab indexes and validates deep-link keys', () => {
    expect(ANALYSIS_TAB_INDEX.subscriptions).toBe(5);
    expect(isAnalysisTabKey('profiling')).toBe(true);
    expect(isAnalysisTabKey('unknown')).toBe(false);
  });
});
