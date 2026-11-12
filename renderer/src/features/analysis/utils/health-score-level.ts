/**
 * Single source of truth for Financial Health Score color bands.
 * Used by the Analysis page scorecard, the dashboard health card and the
 * app accent color (ThemeContext) so the same score is always the same color.
 */
export const HEALTH_SCORE_THRESHOLDS = {
  excellent: 80,
  good: 60,
} as const;

export type HealthScoreLevel = 'success' | 'warning' | 'error';

export function getHealthScoreLevel(score: number): HealthScoreLevel {
  if (score >= HEALTH_SCORE_THRESHOLDS.excellent) return 'success';
  if (score >= HEALTH_SCORE_THRESHOLDS.good) return 'warning';
  return 'error';
}
