import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n, { SUPPORTED_LOCALES, SupportedLocale, initializeI18n } from './index';

interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  direction: 'ltr' | 'rtl';
  detectedLocale: SupportedLocale;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

const LOCALE_STORAGE_KEY = 'app-locale';

const normalizeLocale = (value: string | null | undefined): SupportedLocale | null => {
  if (!value) return null;
  const base = value.toLowerCase().split('-')[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as SupportedLocale) : null;
};

const detectSystemLocale = (): SupportedLocale | null => {
  if (typeof window === 'undefined') return null;
  const fromNavigator = normalizeLocale(window.navigator.language);
  if (fromNavigator) return fromNavigator;

  if (Array.isArray(window.navigator.languages)) {
    for (const language of window.navigator.languages) {
      const normalized = normalizeLocale(language);
      if (normalized) return normalized;
    }
  }
  return null;
};

const detectInitialLocale = () => {
  const stored = typeof window !== 'undefined' ? normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY)) : null;
  const system = detectSystemLocale();
  const initial = stored ?? system ?? 'he';
  return { initialLocale: initial, systemLocale: system ?? 'he' };
};

export const I18nProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { initialLocale, systemLocale } = detectInitialLocale();
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale);
  const [detectedLocale] = useState<SupportedLocale>(systemLocale);

  const direction: 'ltr' | 'rtl' = locale === 'he' ? 'rtl' : 'ltr';

  const i18nInstance = useMemo(() => initializeI18n(locale), [locale]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage write errors to avoid blocking UI
    }
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [direction, locale]);

  const handleSetLocale = (newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
  };

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale: handleSetLocale,
    direction,
    detectedLocale,
  }), [locale, direction, detectedLocale]);

  return (
    <I18nextProvider i18n={i18nInstance}>
      <LocaleContext.Provider value={value}>
        {children}
      </LocaleContext.Provider>
    </I18nextProvider>
  );
};

export const useLocaleSettings = () => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocaleSettings must be used within I18nProvider');
  }
  return context;
};
