import { describe, expect, it } from 'vitest';
import {
  calculateVendorDelta,
  getVendorDeltaChipColor,
} from '../VendorView';

describe('VendorView helpers', () => {
  it('calculates vendor delta percentages and handles missing baselines', () => {
    expect(calculateVendorDelta(120, 100)).toBe(20);
    expect(calculateVendorDelta(80, 100)).toBe(-20);
    expect(calculateVendorDelta(100, 0)).toBeNull();
    expect(calculateVendorDelta(100, undefined)).toBeNull();
  });

  it('maps delta colors by category semantics', () => {
    expect(getVendorDeltaChipColor('expense', 10)).toBe('error');
    expect(getVendorDeltaChipColor('expense', -5)).toBe('success');
    expect(getVendorDeltaChipColor('income', 10)).toBe('success');
    expect(getVendorDeltaChipColor('income', -5)).toBe('error');
  });
});
