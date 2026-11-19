import { resolveLocalizedCategoryName } from '@renderer/shared/modals/category-hierarchy-helpers';

type LabelLocale = 'he' | 'en' | 'fr';

export interface TransactionSourceFields {
  vendor: string;
  institution_name_he?: string | null;
  institution_name_en?: string | null;
}

export interface TransactionCategoryFields {
  category_name?: string | null;
  category_name_en?: string | null;
  category_name_fr?: string | null;
  parent_name?: string | null;
  parent_name_en?: string | null;
  parent_name_fr?: string | null;
}

export const normalizeLabelLocale = (language?: string | null): LabelLocale => {
  const base = language?.toLowerCase().split('-')[0];
  return base === 'en' || base === 'fr' ? base : 'he';
};

/** Readable bank/card name for a transaction, falling back to the raw vendor code. */
export const resolveTransactionSourceLabel = (
  transaction: TransactionSourceFields,
  language?: string | null,
): string => {
  const he = transaction.institution_name_he?.trim();
  const en = transaction.institution_name_en?.trim();
  const preferred = normalizeLabelLocale(language) === 'he' ? he || en : en || he;
  return preferred || transaction.vendor;
};

/** Category (or parent category) name in the app language, falling back to the stored Hebrew name. */
export const resolveTransactionCategoryLabel = (
  transaction: TransactionCategoryFields,
  language?: string | null,
): string => {
  const locale = normalizeLabelLocale(language);
  if (transaction.category_name) {
    return resolveLocalizedCategoryName({
      name: transaction.category_name,
      name_en: transaction.category_name_en,
      name_fr: transaction.category_name_fr,
    }, locale);
  }
  if (transaction.parent_name) {
    return resolveLocalizedCategoryName({
      name: transaction.parent_name,
      name_en: transaction.parent_name_en,
      name_fr: transaction.parent_name_fr,
    }, locale);
  }
  return '';
};
