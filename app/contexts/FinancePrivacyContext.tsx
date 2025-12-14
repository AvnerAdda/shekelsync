import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface CurrencyFormatOptions {
  absolute?: boolean;
  currencySymbol?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  showSign?: boolean;
  fallback?: string;
  compact?: boolean;
  digitsForMask?: number;
}

interface FinancePrivacyContextValue {
  maskAmounts: boolean;
  setMaskAmounts: (value: boolean) => void;
  toggleMaskAmounts: () => void;
  formatCurrency: (value: number | null | undefined, options?: CurrencyFormatOptions) => string;
}

const DEFAULT_SYMBOL = '₪';
const STORAGE_KEY = 'finance-mask-amounts';

const FinancePrivacyContext = createContext<FinancePrivacyContextValue | undefined>(undefined);

const getMaskLength = (value: number | null | undefined, override?: number) => {
  if (override && override > 0) {
    return override;
  }

  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 3;
  }

  const digits = Math.max(1, Math.floor(Math.abs(value)).toString().length);
  return Math.max(3, digits);
};

interface FinancePrivacyProviderProps {
  children: React.ReactNode;
  locale?: string;
}

export const FinancePrivacyProvider: React.FC<FinancePrivacyProviderProps> = ({
  children,
  locale = 'he',
}: FinancePrivacyProviderProps) => {
  const [maskAmounts, setMaskAmountsState] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        setMaskAmountsState(stored === 'true');
      }
    } catch {
      // Ignore storage read errors to avoid blocking the UI
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, maskAmounts ? 'true' : 'false');
    } catch {
      // Ignore storage write errors
    }
  }, [maskAmounts]);

  const setMaskAmounts = useCallback((value: boolean) => {
    setMaskAmountsState(value);
  }, []);

  const toggleMaskAmounts = useCallback(() => {
    setMaskAmountsState((prev: boolean) => !prev);
  }, []);

  const formatCurrency = useCallback(
    (value: number | null | undefined, options?: CurrencyFormatOptions): string => {
    const {
      absolute = false,
      currencySymbol = DEFAULT_SYMBOL,
      minimumFractionDigits = 0,
      maximumFractionDigits = 0,
      showSign = false,
      fallback,
      compact = false,
      digitsForMask,
    } = options ?? {};

    if (maskAmounts) {
      const signValue = value && value < 0 ? -1 : value && value > 0 ? 1 : 0;
      let signPrefix = '';

      if (showSign && signValue !== 0) {
        signPrefix = signValue > 0 ? '+' : '-';
      } else if (!absolute && signValue < 0) {
        signPrefix = '-';
      }

      const maskLength = getMaskLength(value ?? null, digitsForMask);
      return `${signPrefix}${currencySymbol}${'*'.repeat(maskLength)}`;
    }

    if (value === null || value === undefined || Number.isNaN(value)) {
      if (fallback) {
        return fallback;
      }
      return `${currencySymbol}0`;
    }

    const rawValue = absolute ? Math.abs(value) : value;
    const signValue = Math.sign(rawValue);

    const formatterOptions: Intl.NumberFormatOptions = {
      minimumFractionDigits,
      maximumFractionDigits,
    };

    if (compact) {
      formatterOptions.notation = 'compact';
      formatterOptions.compactDisplay = 'short';
    }

    const formatted = Math.abs(rawValue).toLocaleString(locale, formatterOptions);

    let signPrefix = '';
    if (showSign && rawValue !== 0) {
      signPrefix = rawValue > 0 ? '+' : '-';
    } else if (!absolute && signValue < 0) {
      signPrefix = '-';
    }

    return `${signPrefix}${currencySymbol}${formatted}`;
    },
    [locale, maskAmounts]
  );

  const value = useMemo<FinancePrivacyContextValue>(() => ({
    maskAmounts,
    setMaskAmounts,
    toggleMaskAmounts,
    formatCurrency,
  }), [maskAmounts, setMaskAmounts, toggleMaskAmounts, formatCurrency]);

  return (
    <FinancePrivacyContext.Provider value={value}>
      {children}
    </FinancePrivacyContext.Provider>
  );
};

export const useFinancePrivacy = () => {
  const context = useContext(FinancePrivacyContext);
  if (!context) {
    throw new Error('useFinancePrivacy must be used within FinancePrivacyProvider');
  }
  return context;
};
