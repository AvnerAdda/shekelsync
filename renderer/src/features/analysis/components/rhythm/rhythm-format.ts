import { resolveLocalizedCategoryName } from '@renderer/shared/modals/category-hierarchy-helpers';
import type { LocalizedCategory, PaceStatus, RhythmMetric } from './types';

export type PaceTone = 'good' | 'warning' | 'neutral';
export type AppLocale = 'he' | 'en' | 'fr';

export function toAppLocale(language: string | undefined): AppLocale {
  const base = String(language || 'he').slice(0, 2);
  return base === 'en' || base === 'fr' ? base : 'he';
}

/** Spending above the usual range is a warning; for income, falling below it is. */
export function paceTone(status: PaceStatus, metric: RhythmMetric): PaceTone {
  if (status === 'within' || status === 'insufficient') return 'neutral';
  const isHigh = status === 'above';
  return (metric === 'income') === isHigh ? 'good' : 'warning';
}

/** Same rule for a category driver: more spending, or less income, works against you. */
export function deltaTone(delta: number, metric: RhythmMetric): PaceTone {
  if (delta === 0) return 'neutral';
  return (metric === 'income') === delta > 0 ? 'good' : 'warning';
}

export function categoryLabel(category: Partial<LocalizedCategory> | null | undefined, locale: AppLocale, fallback: string): string {
  if (!category) return fallback;
  return resolveLocalizedCategoryName({
    name: category.name, name_en: category.nameEn, name_fr: category.nameFr,
  }, locale) || fallback;
}

const parseDay = (day: string) => new Date(`${day}T12:00:00`);

export function formatDay(day: string, language: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return parseDay(day).toLocaleDateString(language, options);
}

export function formatPeriodLabel(key: string, granularity: 'month' | 'week', language: string): string {
  if (granularity === 'month') {
    return parseDay(`${key}-01`).toLocaleDateString(language, { month: 'short', year: '2-digit' });
  }
  return formatDay(key, language);
}

/** Day names indexed Sunday-first, matching the server's week. */
export function weekdayNames(language: string, width: 'short' | 'long' = 'short'): string[] {
  // 2026-11-01 is a Sunday.
  return Array.from({ length: 7 }, (_, index) => formatDay(`2026-11-0${index + 1}`, language, { weekday: width }));
}
