import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import he from './locales/he.json';
import fr from './locales/fr.json';

export const SUPPORTED_LOCALES = ['he', 'en', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const resources = {
  en: { translation: en },
  he: { translation: he },
  fr: { translation: fr },
};

export const initializeI18n = (lng: SupportedLocale) => {
  if (!i18n.isInitialized) {
    i18n
      .use(initReactI18next)
      .init({
        resources,
        lng,
        fallbackLng: 'he',
        supportedLngs: SUPPORTED_LOCALES,
        interpolation: { escapeValue: false },
        react: { useSuspense: false },
        defaultNS: 'translation',
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Failed to initialize i18n', error);
      });
  } else if (lng && i18n.language !== lng) {
    void i18n.changeLanguage(lng);
  }

  return i18n;
};

export default i18n;
