import { describe, expect, it } from 'vitest';
import { normalizeDonationTier } from '../titlebar-donation';

describe('TitleBar donation tier mapping', () => {
  it('returns known tiers as-is', () => {
    expect(normalizeDonationTier('none')).toBe('none');
    expect(normalizeDonationTier('bronze')).toBe('bronze');
    expect(normalizeDonationTier('silver')).toBe('silver');
    expect(normalizeDonationTier('gold')).toBe('gold');
  });

  it('falls back to none for invalid values', () => {
    expect(normalizeDonationTier(undefined)).toBe('none');
    expect(normalizeDonationTier(null)).toBe('none');
    expect(normalizeDonationTier('' as any)).toBe('none');
    expect(normalizeDonationTier('platinum' as any)).toBe('none');
  });
});
