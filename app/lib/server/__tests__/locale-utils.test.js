import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveLocale,
  resolveLocaleFromRequest,
  getLocalizedCategoryName,
  getQuestText,
  getLocalizedPeriodLabel,
  getLocalizedAverageLabel,
} from '../locale-utils.js';

describe('locale-utils', () => {
  it('normalizes locale values from language tags and header lists', () => {
    expect(SUPPORTED_LOCALES).toEqual(['he', 'en', 'fr']);
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr-CA')).toBe('fr');
    expect(normalizeLocale('he,en;q=0.8')).toBe('he');
    expect(normalizeLocale('ES')).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
  });

  it('resolves locale from explicit candidate with fallback to hebrew', () => {
    expect(resolveLocale('fr-CH')).toBe('fr');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('de')).toBe('he');
    expect(resolveLocale(undefined)).toBe('he');
  });

  it('resolves locale from request in priority order: req.locale > query > headers', () => {
    const req = {
      locale: 'fr-FR',
      query: { locale: 'en' },
      headers: {
        'x-locale': 'he',
        'accept-language': 'en-US,en;q=0.8',
      },
    };

    expect(resolveLocaleFromRequest(req)).toBe('fr');
    expect(resolveLocaleFromRequest({ ...req, locale: undefined })).toBe('en');
    expect(resolveLocaleFromRequest({ ...req, locale: undefined, query: {} })).toBe('he');
    expect(resolveLocaleFromRequest({ headers: { 'accept-language': 'fr-CA,fr;q=0.8' } })).toBe('fr');
    expect(resolveLocaleFromRequest({ headers: {} })).toBe('he');
  });

  it('returns localized category names with fallback chain per locale', () => {
    const names = {
      name: 'מזון',
      name_en: 'Food',
      name_fr: 'Alimentation',
    };

    expect(getLocalizedCategoryName(names, 'he')).toBe('מזון');
    expect(getLocalizedCategoryName(names, 'en')).toBe('Food');
    expect(getLocalizedCategoryName(names, 'fr')).toBe('Alimentation');

    expect(getLocalizedCategoryName({ name: null, name_en: 'Transport', name_fr: null }, 'fr')).toBe('Transport');
    expect(getLocalizedCategoryName({ name: null, name_en: null, name_fr: 'Transport FR' }, 'en')).toBe('Transport FR');
    expect(getLocalizedCategoryName({ name: null, name_en: null, name_fr: null }, 'he')).toBeNull();
  });

  it('interpolates quest templates and keeps unknown tokens as-is', () => {
    const quest = getQuestText(
      'quest_reduce_spending',
      {
        categoryName: 'Dining',
        reductionPct: 20,
        baseline: 1000,
        target: 800,
        period: 'month',
        averageLabel: 'monthly average',
      },
      'en',
    );

    expect(quest.title).toContain('Dining');
    expect(quest.title).toContain('20');
    expect(quest.description).toContain('1000');
    expect(quest.description).toContain('800');

    const withMissingParam = getQuestText('quest_set_budget', { categoryName: 'Food' }, 'en');
    expect(withMissingParam.description).toContain('{{avgMonthly}}');

    const unknownQuest = getQuestText('quest_that_does_not_exist', {}, 'en');
    expect(unknownQuest).toEqual({ title: 'quest_that_does_not_exist', description: '' });
  });

  it('returns localized period and average labels based on duration', () => {
    expect(getLocalizedPeriodLabel(7, 'he')).toBe('שבוע');
    expect(getLocalizedPeriodLabel(30, 'he')).toBe('חודש');

    expect(getLocalizedAverageLabel(7, 'fr')).toBe('moyenne hebdomadaire');
    expect(getLocalizedAverageLabel(31, 'fr')).toBe('moyenne mensuelle');

    // unsupported locale falls back to Hebrew templates
    expect(getLocalizedPeriodLabel(10, 'de')).toBe('שבוע');
  });
});
