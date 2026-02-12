import { DrillLevel } from '../types';

export const computeOverviewDelta = (current: number, previous?: number): number | null => {
  if (!previous || previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
};

export const resolveOverviewHeaderTitle = (
  currentLevel: DrillLevel | null,
  chartTitle: string,
  parentTitle: (name: string) => string,
  subcategoryTitle: (name: string) => string,
): string => {
  if (!currentLevel) {
    return chartTitle;
  }
  if (currentLevel.type === 'parent') {
    return parentTitle(currentLevel.parentName || '');
  }
  return subcategoryTitle(currentLevel.subcategoryName || '');
};

export const buildOverviewLeafParams = (
  currentLevel: DrillLevel | null,
  id: number,
  name: string,
): { parentId?: number; subcategoryId?: number; categoryName?: string } => {
  if (!currentLevel) {
    return { parentId: id, categoryName: name };
  }

  if (currentLevel.type === 'parent') {
    return { subcategoryId: id, categoryName: name };
  }

  return { categoryName: name };
};

export const formatOverviewPieLabel = (value: number | undefined, totalAmount: number): string => {
  if (!totalAmount || typeof value !== 'number') {
    return '0%';
  }
  const percent = ((value / totalAmount) * 100).toFixed(0);
  return `${percent}%`;
};
