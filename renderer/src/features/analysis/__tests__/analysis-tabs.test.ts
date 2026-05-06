import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_TAB_DEFINITIONS,
  ANALYSIS_TAB_INDEX,
  getActiveOverflowTab,
  partitionAnalysisTabs,
} from '../analysis-tabs';

describe('analysis tab grouping', () => {
  it('keeps primary workflows visible and moves deep-dive tabs into overflow', () => {
    const { primaryTabs, overflowTabs } = partitionAnalysisTabs(ANALYSIS_TAB_DEFINITIONS);

    expect(primaryTabs.map((tab) => tab.key)).toEqual([
      'dashboard',
      'actions',
      'spending',
      'budget',
    ]);

    expect(overflowTabs.map((tab) => tab.key)).toEqual([
      'scoring',
      'subscriptions',
      'profiling',
    ]);
  });

  it('resolves the active overflow tab without changing tab indexes', () => {
    const { overflowTabs } = partitionAnalysisTabs(ANALYSIS_TAB_DEFINITIONS);

    expect(getActiveOverflowTab(ANALYSIS_TAB_INDEX.subscriptions, overflowTabs)?.key).toBe('subscriptions');
    expect(getActiveOverflowTab(ANALYSIS_TAB_INDEX.dashboard, overflowTabs)).toBeUndefined();
  });
});