import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TARGETS,
  calculateTargetTotal,
  canSaveTargetChanges,
  haveTargetsChanged,
  normalizeTargets,
} from '../spendingCategoryTargetsHelpers';

describe('spendingCategoryTargetsHelpers', () => {
  it('fills missing target values from the defaults', () => {
    expect(normalizeTargets({ essential: 55, reward: 10 })).toEqual({
      essential: 55,
      growth: DEFAULT_TARGETS.growth,
      stability: DEFAULT_TARGETS.stability,
      reward: 10,
    });
  });

  it('detects unsaved changes and only allows save at exactly 100%', () => {
    const savedTargets = DEFAULT_TARGETS;
    const invalidTargets = {
      essential: 40,
      growth: 20,
      stability: 15,
      reward: 15,
    };
    const validTargets = {
      essential: 40,
      growth: 20,
      stability: 15,
      reward: 25,
    };

    expect(calculateTargetTotal(invalidTargets)).toBe(90);
    expect(haveTargetsChanged(invalidTargets, savedTargets)).toBe(true);
    expect(canSaveTargetChanges(invalidTargets, savedTargets)).toBe(false);

    expect(calculateTargetTotal(validTargets)).toBe(100);
    expect(haveTargetsChanged(validTargets, savedTargets)).toBe(true);
    expect(canSaveTargetChanges(validTargets, savedTargets)).toBe(true);
  });

  it('keeps save disabled when nothing changed or a save is already in flight', () => {
    expect(haveTargetsChanged(DEFAULT_TARGETS, DEFAULT_TARGETS)).toBe(false);
    expect(canSaveTargetChanges(DEFAULT_TARGETS, DEFAULT_TARGETS)).toBe(false);
    expect(canSaveTargetChanges(
      {
        essential: 45,
        growth: 20,
        stability: 15,
        reward: 20,
      },
      DEFAULT_TARGETS,
      true,
    )).toBe(false);
  });
});
