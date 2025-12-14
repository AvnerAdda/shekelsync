const SUPPORTED_LOCALES = ['he', 'en', 'fr'];

function normalizeLocale(value) {
  if (!value || typeof value !== 'string') return null;
  const base = value.toLowerCase().split(',')[0].split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

function resolveLocale(candidate) {
  if (candidate && typeof candidate === 'string') {
    const normalized = normalizeLocale(candidate);
    if (normalized) return normalized;
  }
  return 'he';
}

function resolveLocaleFromRequest(req) {
  const headerLocale = normalizeLocale(req?.headers?.['x-locale'])
    || normalizeLocale(req?.headers?.['accept-language']);
  const queryLocale = normalizeLocale(req?.query?.locale);
  const directLocale = normalizeLocale(req?.locale);

  return directLocale || queryLocale || headerLocale || 'he';
}

function getLocalizedCategoryName(names = {}, locale = 'he') {
  const normalized = normalizeLocale(locale) || 'he';
  const { name, name_en: nameEn, name_fr: nameFr } = names;

  if (normalized === 'fr') {
    return nameFr || nameEn || name || null;
  }
  if (normalized === 'en') {
    return nameEn || nameFr || name || null;
  }
  return name || nameFr || nameEn || null;
}

module.exports = {
  SUPPORTED_LOCALES,
  normalizeLocale,
  resolveLocale,
  resolveLocaleFromRequest,
  getLocalizedCategoryName,
};

module.exports.default = module.exports;
