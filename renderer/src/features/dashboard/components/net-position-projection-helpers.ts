import { addDays, endOfMonth, format, isSameDay } from 'date-fns';
import type { DashboardPeriodPreset } from '../DashboardFiltersContext';

export type ProjectionHorizon = 'eom' | '30' | 'custom';

export const PROJECTION_HORIZONS: readonly ProjectionHorizon[] = ['eom', '30', 'custom'];

// The dashboard fetches the longest horizon once and trims it per selection.
export const MAX_PROJECTION_DAYS = 90;

export function getDefaultProjectionHorizon(periodPreset: DashboardPeriodPreset): ProjectionHorizon {
  return periodPreset === 'mtd' ? 'eom' : '30';
}

export function getProjectionDateLimits(today: Date): { min: Date; max: Date } {
  return { min: addDays(today, 1), max: addDays(today, MAX_PROJECTION_DAYS) };
}

// End of month on its last day would leave nothing to project, so it falls
// back to the 30-day window. Custom dates are clamped to the fetched forecast.
export function resolveHorizonEndDate(horizon: ProjectionHorizon, today: Date, customEndDate?: string | null): string {
  if (horizon === 'custom' && customEndDate) {
    const { min, max } = getProjectionDateLimits(today);
    // ISO dates sort chronologically, so the middle value is the clamped date.
    return [format(min, 'yyyy-MM-dd'), customEndDate, format(max, 'yyyy-MM-dd')].sort()[1];
  }
  if (horizon === 'eom') {
    const monthEnd = endOfMonth(today);
    return format(isSameDay(monthEnd, today) ? addDays(today, 30) : monthEnd, 'yyyy-MM-dd');
  }
  return format(addDays(today, 30), 'yyyy-MM-dd');
}

export type InvestmentBasis = 'before' | 'after';

export interface NetPositionPoint {
  date: string;
  isForecast: boolean;
  historicalCumulative?: number;
  historicalAfterInvesting?: number;
  forecastCumulative?: number;
  forecastAfterInvesting?: number;
  p10Cumulative?: number;
  p50Cumulative?: number;
  p90Cumulative?: number;
  forecastRange?: [number, number];
}

/**
 * Re-expresses the plotted cumulative series after investing.
 *
 * Every forecast series shifts by the amount invested since the period start.
 * When investment forecasts stop, the last known amount stays deducted rather
 * than counting it as spendable again. Raw before/after fields are kept.
 */
export function applyInvestmentBasis<T extends NetPositionPoint>(points: readonly T[], basis: InvestmentBasis): T[] {
  if (basis === 'before') return [...points];
  let investedOffset: number | undefined;
  return points.map((point) => {
    const shifted: T = point.isForecast
      ? { ...point }
      : { ...point, historicalCumulative: point.historicalAfterInvesting ?? point.historicalCumulative };
    if (point.forecastCumulative === undefined) return shifted;
    if (point.forecastAfterInvesting !== undefined) {
      investedOffset = point.forecastCumulative - point.forecastAfterInvesting;
    }
    const shift = (value?: number) => (value === undefined || investedOffset === undefined ? undefined : value - investedOffset);
    const range = point.forecastRange;
    return {
      ...shifted,
      forecastCumulative: shift(point.forecastCumulative),
      p10Cumulative: shift(point.p10Cumulative),
      p50Cumulative: shift(point.p50Cumulative),
      p90Cumulative: shift(point.p90Cumulative),
      forecastRange: range && investedOffset !== undefined
        ? [range[0] - investedOffset, range[1] - investedOffset]
        : undefined,
    };
  });
}
