import { describe, expect, it } from 'vitest';

import {
  formatSubscriptionCalendarDayLabel,
  formatSubscriptionCalendarMonthLabel,
  getSubscriptionCalendarWeekdayLabels,
  resolveSubscriptionCalendarLocale,
} from '../subscription-calendar-locale';

describe('subscription calendar locale helpers', () => {
  it('resolves supported locales and keeps weekday labels Monday-first', () => {
    expect(resolveSubscriptionCalendarLocale('he-IL')).toBe('he-IL');
    expect(resolveSubscriptionCalendarLocale('fr-CA')).toBe('fr-FR');
    expect(resolveSubscriptionCalendarLocale('en-US')).toBe('en-US');
    expect(resolveSubscriptionCalendarLocale('es-ES')).toBe('en-US');

    const frenchWeekdays = getSubscriptionCalendarWeekdayLabels('fr');
    const expectedMonday = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2024, 0, 1)));

    expect(frenchWeekdays).toHaveLength(7);
    expect(frenchWeekdays[0]).toBe(expectedMonday);
  });

  it('formats month and day labels with the requested locale', () => {
    const date = new Date('2026-03-20T12:00:00.000Z');

    expect(formatSubscriptionCalendarMonthLabel(date, 'he')).toBe(
      new Intl.DateTimeFormat('he-IL', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, 2, 20))),
    );
    expect(formatSubscriptionCalendarDayLabel(date, 'fr')).toBe(
      new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, 2, 20))),
    );
  });
});
