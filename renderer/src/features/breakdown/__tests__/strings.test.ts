import { afterEach, describe, expect, it } from 'vitest';
import { getBreakdownStrings } from '../strings';

describe('breakdown strings helper', () => {
  afterEach(() => {
    // Clean up navigator between tests to avoid leaking locale state.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as any).navigator;
  });

  it('returns Hebrew strings when no locale context is available', () => {
    // Simulate an environment without navigator to ensure we fall back correctly.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as any).navigator;

    const strings = getBreakdownStrings();
    expect(strings.panel.overviewTab).toBe('סקירה');
    expect(strings.timeline.outflow).toBe('הוצאות');
  });

  it('resolves Hebrew strings when an explicit locale is provided', () => {
    const strings = getBreakdownStrings('he-IL');
    expect(strings.panel.overviewTab).toBe('סקירה');
    expect(strings.panel.rootBreadcrumb).toBe('כל הקטגוריות');
  });

  it('resolves English strings when an explicit locale is provided', () => {
    const strings = getBreakdownStrings('en-US');
    expect(strings.panel.overviewTab).toBe('Overview');
    expect(strings.panel.vendorTab).toBe('Vendor');
  });

  it('resolves French strings when an explicit locale is provided', () => {
    const strings = getBreakdownStrings('fr-FR');
    expect(strings.panel.overviewTab).toBe('Vue d’ensemble');
    expect(strings.panel.vendorTab).toBe('Fournisseurs');
  });

  it.each([
    { language: 'he', vendorLabel: 'ספקים' },
    { language: 'en-US', vendorLabel: 'Vendor' },
    { language: 'fr-FR', vendorLabel: 'Fournisseurs' },
  ])('falls back to navigator language when no locale argument is supplied (%s)', ({ language, vendorLabel }) => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { language },
      configurable: true,
    });

    const strings = getBreakdownStrings();
    expect(strings.panel.vendorTab).toBe(vendorLabel);
  });
});
