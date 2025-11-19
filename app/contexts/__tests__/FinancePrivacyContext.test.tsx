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
});
