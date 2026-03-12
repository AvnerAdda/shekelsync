import { describe, expect, it } from 'vitest';
import {
  getInitialRulePattern,
  resolveFocusedTransactionSelection,
} from '@renderer/shared/modals/category-hierarchy-helpers';

describe('CategoryHierarchyModal helpers', () => {
  it('flags a missing focused transaction so the categorize tab can show a fallback message', () => {
    const resolution = resolveFocusedTransactionSelection(
      { identifier: 'txn-missing', vendor: 'bank-a' },
      [
        { identifier: 'txn-other', vendor: 'bank-a' },
      ],
    );

    expect(resolution).toEqual({
      targetKey: 'txn-missing|bank-a',
      shouldActivateCategorizeTab: true,
      targetTransaction: null,
      shouldShowMissingFallback: true,
    });
  });

  it('trims the initial vendor when pre-filling a new categorization rule', () => {
    expect(getInitialRulePattern('  Mega Store  ')).toBe('Mega Store');
    expect(getInitialRulePattern(null)).toBe('');
  });
});
