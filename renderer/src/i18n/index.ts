import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he.json';

export const SUPPORTED_LOCALES = ['he', 'en', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

type TranslationResource = Record<string, unknown>;

const localeLoaders: Record<SupportedLocale, () => Promise<TranslationResource>> = {
  he: async () => he,
  en: async () => (await import('./locales/en.json')).default,
  fr: async () => (await import('./locales/fr.json')).default,
};

const loadedResources = new Map<SupportedLocale, TranslationResource>([['he', he]]);
const loadingResources = new Map<SupportedLocale, Promise<TranslationResource>>();
let initializationPromise: Promise<unknown> | null = null;
let languageRequestSequence = 0;
let languageChangeQueue: Promise<void> = Promise.resolve();

function ensureI18nInitialized(): void {
  if (i18n.isInitialized || initializationPromise) return;

  initializationPromise = i18n
    .use(initReactI18next)
    .init({
      resources: { he: { translation: he } },
      lng: 'he',
      fallbackLng: 'he',
      supportedLngs: SUPPORTED_LOCALES,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      defaultNS: 'translation',
    });
  void initializationPromise.catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to initialize i18n', error);
  });
}

async function loadLocaleResource(lng: SupportedLocale): Promise<TranslationResource> {
  const loaded = loadedResources.get(lng);
  if (loaded) return loaded;

  const inFlight = loadingResources.get(lng);
  if (inFlight) return inFlight;

  const request = localeLoaders[lng]().then((resource) => {
    loadedResources.set(lng, resource);
    loadingResources.delete(lng);
    return resource;
  }, (error) => {
    loadingResources.delete(lng);
    throw error;
  });
  loadingResources.set(lng, request);
  return request;
}

export const loadI18nLanguage = async (lng: SupportedLocale) => {
  const requestId = languageRequestSequence + 1;
  languageRequestSequence = requestId;
  ensureI18nInitialized();
  await initializationPromise;
  const resource = await loadLocaleResource(lng);
  if (!i18n.hasResourceBundle(lng, 'translation')) {
    i18n.addResourceBundle(lng, 'translation', resource, true, true);
  }
  const requestedChange = languageChangeQueue.then(async () => {
    if (requestId === languageRequestSequence && i18n.language !== lng) {
      await i18n.changeLanguage(lng);
    }
  });
  languageChangeQueue = requestedChange.catch(() => undefined);
  await requestedChange;
  return i18n;
};

export const initializeI18n = (lng: SupportedLocale) => {
  ensureI18nInitialized();
  void loadI18nLanguage(lng).catch((error) => {
    // The provider performs its own fallback; this protects standalone callers
    // from an unhandled deferred-import rejection.
    // eslint-disable-next-line no-console
    console.error(`Failed to load locale ${lng}`, error);
  });
  return i18n;
};

export default i18n;
