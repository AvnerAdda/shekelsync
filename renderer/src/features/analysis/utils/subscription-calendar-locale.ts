function normalizeLocale(language?: string): 'he' | 'fr' | 'en' {
  const normalized = language?.toLowerCase().split('-')[0];
  if (normalized === 'he') return 'he';
  if (normalized === 'fr') return 'fr';
  return 'en';
}

export function resolveSubscriptionCalendarLocale(language?: string): string {
  const normalized = normalizeLocale(language);
  if (normalized === 'he') return 'he-IL';
  if (normalized === 'fr') return 'fr-FR';
  return 'en-US';
}

function toUtcCalendarDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

export function getSubscriptionCalendarWeekdayLabels(language?: string): string[] {
  const formatter = new Intl.DateTimeFormat(resolveSubscriptionCalendarLocale(language), {
    weekday: 'short',
    timeZone: 'UTC',
  });

  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2024, 0, 1 + index))),
  );
}

export function formatSubscriptionCalendarMonthLabel(date: Date, language?: string): string {
  return new Intl.DateTimeFormat(resolveSubscriptionCalendarLocale(language), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcCalendarDate(date));
}

export function formatSubscriptionCalendarDayLabel(date: Date, language?: string): string {
  return new Intl.DateTimeFormat(resolveSubscriptionCalendarLocale(language), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcCalendarDate(date));
}
