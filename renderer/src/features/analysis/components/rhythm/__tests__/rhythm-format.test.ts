import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import en from '@renderer/i18n/locales/en.json';
import he from '@renderer/i18n/locales/he.json';
import fr from '@renderer/i18n/locales/fr.json';
import { categoryLabel, deltaTone, paceTone, toAppLocale, weekdayNames } from '../rhythm-format';

describe('rhythm tone', () => {
  it('treats spending above usual as a warning and income above usual as good', () => {
    expect(paceTone('above', 'spend')).toBe('warning');
    expect(paceTone('below', 'spend')).toBe('good');
    expect(paceTone('above', 'income')).toBe('good');
    expect(paceTone('below', 'income')).toBe('warning');
    expect(paceTone('within', 'income')).toBe('neutral');
    expect(paceTone('insufficient', 'spend')).toBe('neutral');
  });

  it('colors category gaps the same way', () => {
    expect(deltaTone(400, 'spend')).toBe('warning');
    expect(deltaTone(-400, 'spend')).toBe('good');
    expect(deltaTone(-400, 'income')).toBe('warning');
    expect(deltaTone(0, 'spend')).toBe('neutral');
  });
});

describe('rhythm labels', () => {
  it('picks the category name for the interface language', () => {
    const category = { categoryId: 3, name: 'סופרמרקט', nameEn: 'Groceries', nameFr: 'Épicerie' };
    expect(categoryLabel(category, 'he', '?')).toBe('סופרמרקט');
    expect(categoryLabel(category, 'en', '?')).toBe('Groceries');
    expect(categoryLabel(null, 'fr', 'Sans catégorie')).toBe('Sans catégorie');
    expect(toAppLocale('en-US')).toBe('en');
    expect(toAppLocale(undefined)).toBe('he');
  });

  it('lists weekdays from Sunday, like the server', () => {
    expect(weekdayNames('en', 'long')[0]).toBe('Sunday');
    expect(weekdayNames('en', 'long')[3]).toBe('Wednesday');
  });

  it('has every comparison string in English, Hebrew and French', async () => {
    const keys = [
      'tabs.month', 'tabs.week', 'tabs.day', 'tabs.habits',
      'compare.metric.spend', 'compare.scope.everyday', 'compare.scope.hint',
      'compare.series.current.month', 'compare.series.previous.week', 'compare.series.band',
      'compare.chart.title.week', 'compare.drivers.compare', 'compare.totals.projected',
      'compare.position.month', 'compare.status.above', 'compare.usual.day', 'compare.projection.month',
      'compare.day.usualFor', 'compare.checks.typeMismatch.fix', 'compare.checks.drift.title',
    ];
    const plurals = [
      'compare.series.medianOf.month', 'compare.chart.subtitle.week', 'compare.day.unusualCount',
      'compare.checks.title', 'compare.checks.typeMismatch.title', 'compare.checks.stale.titleFailed',
      'compare.checks.drift.body',
    ];
    for (const [lng, translation] of [['en', en], ['he', he], ['fr', fr]] as const) {
      const instance = i18n.createInstance();
      await instance.init({ lng, resources: { [lng]: { translation } } });
      keys.forEach((key) => {
        expect(instance.exists(`analysisPage.modals.rhythm.${key}`), `${lng}: ${key}`).toBe(true);
      });
      plurals.forEach((key) => {
        const text = instance.t(`analysisPage.modals.rhythm.${key}`, { count: 3 });
        expect(text, `${lng}: ${key}`).not.toContain(key);
      });
    }
  });
});
