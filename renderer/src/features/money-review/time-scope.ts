import type { MoneyReviewItem } from './types';

export interface MoneyReviewTimeScopeLabel {
  key: string;
  values: Record<string, string | number>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseDateOnly(value: unknown): Date | null {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: unknown, locale: string): string | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(locale || 'en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatMonth(value: unknown, locale: string): string | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(locale || 'en', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function buildMoneyReviewTimeScopeLabel(
  item: MoneyReviewItem,
  locale = 'en',
): MoneyReviewTimeScopeLabel | null {
  const metadata = record(item.metadata);
  const data = record(metadata.data);
  const scope = record(metadata.timeScope || data.time_scope);
  const kind = String(scope.kind || '');

  if (kind === 'current_month') {
    const month = formatMonth(scope.start, locale);
    return month ? { key: 'timeScope.currentMonth', values: { month } } : null;
  }

  if (kind === 'rolling_days') {
    const days = Number(scope.days);
    const start = formatDate(scope.start, locale);
    const end = formatDate(scope.end, locale);
    if (Number.isFinite(days) && days > 0 && start && end) {
      return { key: 'timeScope.rollingRange', values: { count: days, start, end } };
    }
    return Number.isFinite(days) && days > 0
      ? { key: 'timeScope.rollingDays', values: { count: days } }
      : null;
  }

  if (kind === 'evidence_range') {
    const start = formatDate(scope.start, locale);
    const end = formatDate(scope.end, locale);
    return start && end
      ? { key: 'timeScope.evidenceRange', values: { start, end } }
      : null;
  }

  if (kind === 'overdue_since') {
    const date = formatDate(scope.start, locale);
    return date ? { key: 'timeScope.overdueSince', values: { date } } : null;
  }

  if (item.group === 'cash') {
    const date = formatDate(item.detectedAt, locale);
    return date ? { key: 'timeScope.detectedOn', values: { date } } : null;
  }

  return null;
}
