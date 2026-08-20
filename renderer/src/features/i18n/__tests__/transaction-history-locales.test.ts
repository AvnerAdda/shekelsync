import { describe, expect, it } from 'vitest';
import en from '@renderer/i18n/locales/en.json';
import fr from '@renderer/i18n/locales/fr.json';
import he from '@renderer/i18n/locales/he.json';

describe('transaction history locale coverage', () => {
  it.each([
    ['en', en],
    ['fr', fr],
    ['he', he],
  ])('defines forecast detail labels in %s', (_locale, translations) => {
    expect(translations.transactionHistory.predictedTransactionsOn).toContain('{{date}}');
    expect(translations.transactionHistory.predictedTransactionsOn).toContain('{{count}}');
    expect(translations.transactionHistory.forecast.basedOnPatterns).toBeTruthy();
  });
});
