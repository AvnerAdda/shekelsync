export type LocalizedCategoryInfo = {
  name?: string | null;
  name_en?: string | null;
  name_fr?: string | null;
  name_he?: string | null;
  category_name?: string | null;
  category_name_en?: string | null;
  category_name_fr?: string | null;
  category_name_he?: string | null;
};

export const resolveLocalizedCategoryName = (
  category: LocalizedCategoryInfo | null | undefined,
  locale: 'he' | 'en' | 'fr',
): string => {
  if (!category) return '';

  const heName =
    category.name || category.name_he || category.category_name || category.category_name_he || '';
  const enName = category.name_en || category.category_name_en || '';
  const frName = category.name_fr || category.category_name_fr || '';

  if (locale === 'fr') return frName || enName || heName;
  if (locale === 'en') return enName || frName || heName;
  return heName || frName || enName;
};

export const formatCategoryHierarchyCurrency = (value: number): string => {
  const amount = Number.isFinite(value) ? Math.abs(value) : 0;
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${value < 0 ? '-' : ''}₪${formatted}`;
};

export const formatCategoryHierarchyDate = (
  value: string,
  unknownLabel: string,
): string => {
  if (!value) {
    return unknownLabel;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? unknownLabel
    : parsed.toLocaleDateString('en-IL');
};

export const buildCategoryHierarchyTransactionKey = (txn: {
  identifier: string;
  vendor: string;
}): string => `${txn.identifier}|${txn.vendor}`;
