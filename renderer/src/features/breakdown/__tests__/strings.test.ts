import { afterEach, describe, expect, it } from 'vitest';
import { getBreakdownStrings } from '../strings';

describe('breakdown strings helper', () => {
  afterEach(() => {
    // Clean up navigator between tests to avoid leaking locale state.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as any).navigator;
  });

  it('returns English strings by default', () => {
    const strings = getBreakdownStrings();
    expect(strings.panel.overviewTab).toBe('Overview');
    expect(strings.timeline.outflow).toBe('Outflow');
  });

  it('resolves Hebrew strings when an explicit locale is provided', () => {
    const strings = getBreakdownStrings('he-IL');
    expect(strings.panel.overviewTab).toBe('סקירה');
    expect(strings.panel.rootBreadcrumb).toBe('כל הקטגוריות');
  });

  it('falls back to navigator language when no locale argument is supplied', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'he' },
      configurable: true,
    });

    const strings = getBreakdownStrings();
    expect(strings.panel.vendorTab).toBe('ספקים');
  });
});
