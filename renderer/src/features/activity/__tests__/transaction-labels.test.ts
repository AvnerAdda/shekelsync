import { describe, expect, it } from 'vitest';
import {
  normalizeLabelLocale,
  resolveTransactionCategoryLabel,
  resolveTransactionSourceLabel,
} from '@renderer/shared/utils/transaction-labels';

describe('transaction labels', () => {
  it('normalizes app languages to supported label locales', () => {
    expect(normalizeLabelLocale('en-US')).toBe('en');
    expect(normalizeLabelLocale('fr')).toBe('fr');
    expect(normalizeLabelLocale('he-IL')).toBe('he');
    expect(normalizeLabelLocale(undefined)).toBe('he');
  });

  it('prefers the institution name in the app language and falls back to the vendor code', () => {
    const tx = { vendor: 'sample-bank', institution_name_he: 'בנק לדוגמה', institution_name_en: 'Sample Bank' };
    expect(resolveTransactionSourceLabel(tx, 'he')).toBe('בנק לדוגמה');
    expect(resolveTransactionSourceLabel(tx, 'en')).toBe('Sample Bank');
    // Institutions have no French names; English is the closest match.
    expect(resolveTransactionSourceLabel(tx, 'fr')).toBe('Sample Bank');
    expect(resolveTransactionSourceLabel({ vendor: 'sample-bank', institution_name_he: 'בנק לדוגמה' }, 'en')).toBe('בנק לדוגמה');
    expect(resolveTransactionSourceLabel({ vendor: 'unknown-vendor', institution_name_he: null }, 'en')).toBe('unknown-vendor');
  });

  it('localizes the category, then the parent category, then returns empty', () => {
    const tx = { category_name: 'קפה', category_name_en: 'Coffee', category_name_fr: 'Café' };
    expect(resolveTransactionCategoryLabel(tx, 'he')).toBe('קפה');
    expect(resolveTransactionCategoryLabel(tx, 'en')).toBe('Coffee');
    expect(resolveTransactionCategoryLabel(tx, 'fr')).toBe('Café');
    expect(resolveTransactionCategoryLabel({ category_name: 'קפה' }, 'en')).toBe('קפה');
    expect(resolveTransactionCategoryLabel({ parent_name: 'מזון', parent_name_en: 'Food' }, 'en')).toBe('Food');
    expect(resolveTransactionCategoryLabel({}, 'en')).toBe('');
  });
});
