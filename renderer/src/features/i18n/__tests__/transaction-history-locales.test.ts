import { describe, expect, it } from 'vitest';
import en from '@renderer/i18n/locales/en.json';
import fr from '@renderer/i18n/locales/fr.json';
import he from '@renderer/i18n/locales/he.json';

describe('transaction history locale coverage', () => {
  it.each([
    ['en', en],
    ['fr', fr],
    ['he', he],
  ])('defines transaction detail labels in %s', (_locale, translations) => {
    expect(translations.transactionHistory.predictedTransactionsOn).toContain('{{date}}');
    expect(translations.transactionHistory.predictedTransactionsOn).toContain('{{count}}');
    expect(translations.transactionHistory.transactionsInPeriod).toContain('{{start}}');
    expect(translations.transactionHistory.transactionsInPeriod).toContain('{{end}}');
    expect(translations.transactionHistory.transactionsInPeriod).toContain('{{count}}');
    expect(translations.transactionHistory.noTransactionsForPeriod).toBeTruthy();
    expect(translations.transactionHistory.forecast.basedOnPatterns).toBeTruthy();
    const forecast = translations.transactionHistory.forecast;
    expect(forecast.breakdownExplanation).toBeTruthy();
    expect(forecast.contribution).toBeTruthy();
    expect(forecast.estimatedAmount).toContain('{{amount}}');
    expect(forecast.probability).toContain('{{percent}}');
    expect(forecast.remainingForecast).toBeTruthy();
    expect(forecast.roundingAdjustment).toBeTruthy();
    expect(forecast.noPredictions).toBeTruthy();
  });
});
