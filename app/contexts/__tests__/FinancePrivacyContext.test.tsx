import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { FinancePrivacyProvider, useFinancePrivacy } from '../FinancePrivacyContext.tsx';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <FinancePrivacyProvider>{children}</FinancePrivacyProvider>
);

describe('FinancePrivacyContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('formats currency and masks amounts when toggled', () => {
    const { result } = renderHook(() => useFinancePrivacy(), { wrapper });

    expect(result.current.formatCurrency(1500)).toBe('₪1,500');

    act(() => {
      result.current.toggleMaskAmounts();
    });

    expect(result.current.formatCurrency(1500)).toMatch(/^₪\*+/);
    expect(window.localStorage.getItem('finance-mask-amounts')).toBe('true');
  });

  it('initializes mask state from persisted preference', async () => {
    window.localStorage.setItem('finance-mask-amounts', 'true');

    const { result } = renderHook(() => useFinancePrivacy(), { wrapper });

    await waitFor(() => {
      expect(result.current.formatCurrency(1234)).toMatch(/^₪\*+/);
    });
  });

  it('handles masking overrides, signs, and fallback values', () => {
    const { result } = renderHook(() => useFinancePrivacy(), { wrapper });

    // mask with custom length and sign handling
    act(() => result.current.setMaskAmounts(true));
    expect(result.current.formatCurrency(-42, { showSign: true, digitsForMask: 5 })).toBe('-₪*****');
    expect(result.current.formatCurrency(42, { showSign: true, digitsForMask: 4 })).toBe('+₪****');

    // non-masked branch: fallback and compact formatting
    act(() => result.current.setMaskAmounts(false));
    expect(result.current.formatCurrency(null, { fallback: 'N/A' })).toBe('N/A');
    expect(result.current.formatCurrency(1200, { compact: true, maximumFractionDigits: 1 })).toBe('₪1.2K');
  });

  it('ignores storage errors when saving preference', () => {
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { result } = renderHook(() => useFinancePrivacy(), { wrapper });
    act(() => result.current.toggleMaskAmounts());

    // toggle should not throw even if storage write fails
    expect(result.current.maskAmounts).toBe(true);
    setItemSpy.mockRestore();
  });
});
