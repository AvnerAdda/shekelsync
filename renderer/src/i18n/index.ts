import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './locales/he.json';
import planningHe from '../features/planning/locales/he.json';
import spendabilityHe from '../features/planning/locales/spendability-he.json';
import debtPlanningHe from '../features/investments/locales/debt-planning-he.json';

export const SUPPORTED_LOCALES = ['he', 'en', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

type TranslationResource = Record<string, unknown>;

function withPlanningResources(
  base: TranslationResource,
  planning: TranslationResource,
  spendability: TranslationResource,
  debtPlanning: TranslationResource,
): TranslationResource {
  return { ...base, planning: { ...planning, spendability }, debtPlanning };
}

const hebrewResource = withPlanningResources(he, planningHe, spendabilityHe, debtPlanningHe);

const localeLoaders: Record<SupportedLocale, () => Promise<TranslationResource>> = {
  he: async () => hebrewResource,
  en: async () => {
    const [base, planning, spendability, debt] = await Promise.all([
      import('./locales/en.json'), import('../features/planning/locales/en.json'),
      import('../features/planning/locales/spendability-en.json'),
      import('../features/investments/locales/debt-planning-en.json'),
    ]);
    return withPlanningResources(base.default, planning.default, spendability.default, debt.default);
  },
  fr: async () => {
    const [base, planning, spendability, debt] = await Promise.all([
      import('./locales/fr.json'), import('../features/planning/locales/fr.json'),
      import('../features/planning/locales/spendability-fr.json'),
      import('../features/investments/locales/debt-planning-fr.json'),
    ]);
    return withPlanningResources(base.default, planning.default, spendability.default, debt.default);
  },
};

const loadedResources = new Map<SupportedLocale, TranslationResource>([['he', hebrewResource]]);
const loadingResources = new Map<SupportedLocale, Promise<TranslationResource>>();
let initializationPromise: Promise<unknown> | null = null;
let languageRequestSequence = 0;
let languageChangeQueue: Promise<void> = Promise.resolve();

function ensureI18nInitialized(): void {
  if (i18n.isInitialized || initializationPromise) return;

  initializationPromise = i18n
    .use(initReactI18next)
    .init({
      resources: { he: { translation: hebrewResource } },
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
