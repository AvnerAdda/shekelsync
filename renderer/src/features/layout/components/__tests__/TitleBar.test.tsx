import { describe, expect, it } from 'vitest';
import { normalizeDonationTier } from '../titlebar-donation';

describe('TitleBar donation tier mapping', () => {
  it('returns one_time tier as-is', () => {
    expect(normalizeDonationTier('none')).toBe('none');
    expect(normalizeDonationTier('one_time')).toBe('one_time');
  });

  it('falls back to none for invalid values', () => {
    expect(normalizeDonationTier(undefined)).toBe('none');
    expect(normalizeDonationTier(null)).toBe('none');
    expect(normalizeDonationTier('' as any)).toBe('none');
    expect(normalizeDonationTier('bronze' as any)).toBe('none');
  });
});
