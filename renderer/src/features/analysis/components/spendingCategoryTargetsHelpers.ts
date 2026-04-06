import type { SpendingCategory } from '@renderer/types/spending-categories';

export const DEFAULT_TARGETS: Record<SpendingCategory, number> = {
  essential: 50,
  growth: 20,
  stability: 15,
  reward: 15,
};

export const TARGET_KEYS: SpendingCategory[] = ['essential', 'growth', 'stability', 'reward'];

export const normalizeTargets = (
  targets?: Partial<Record<SpendingCategory, number>> | null,
): Record<SpendingCategory, number> => ({
  essential: targets?.essential ?? DEFAULT_TARGETS.essential,
  growth: targets?.growth ?? DEFAULT_TARGETS.growth,
  stability: targets?.stability ?? DEFAULT_TARGETS.stability,
  reward: targets?.reward ?? DEFAULT_TARGETS.reward,
});

export const calculateTargetTotal = (targets: Record<SpendingCategory, number>) =>
  TARGET_KEYS.reduce((sum, key) => sum + (targets[key] || 0), 0);

export const haveTargetsChanged = (
  current: Record<SpendingCategory, number>,
  saved: Record<SpendingCategory, number>,
) => TARGET_KEYS.some((key) => Math.abs((current[key] || 0) - (saved[key] || 0)) > 0.01);

export const canSaveTargetChanges = (
  current: Record<SpendingCategory, number>,
  saved: Record<SpendingCategory, number>,
  saving = false,
) => Math.abs(calculateTargetTotal(current) - 100) < 0.01 && haveTargetsChanged(current, saved) && !saving;
