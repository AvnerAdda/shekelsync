import { describe, expect, it } from 'vitest';
import {
  buildCategoryHierarchyTransactionKey,
  formatCategoryHierarchyCurrency,
  formatCategoryHierarchyDate,
  resolveLocalizedCategoryName,
} from '@renderer/shared/modals/category-hierarchy-helpers';

describe('CategoryHierarchyModal helpers', () => {
  it('resolves localized category names with language fallback order', () => {
    const category = {
      name_he: 'הוצאות',
      name_en: 'Expenses',
      name_fr: 'Dépenses',
    };

    expect(resolveLocalizedCategoryName(category, 'he')).toBe('הוצאות');
    expect(resolveLocalizedCategoryName(category, 'en')).toBe('Expenses');
    expect(resolveLocalizedCategoryName(category, 'fr')).toBe('Dépenses');
  });

  it('formats currency, dates, and transaction keys', () => {
    expect(formatCategoryHierarchyCurrency(1234.5)).toBe('₪1,235');
    expect(formatCategoryHierarchyCurrency(-1234.5)).toBe('-₪1,235');
    expect(formatCategoryHierarchyCurrency(Number.NaN)).toBe('₪0');

    expect(formatCategoryHierarchyDate('', 'Unknown')).toBe('Unknown');
    expect(formatCategoryHierarchyDate('invalid-date', 'Unknown')).toBe('Unknown');
    expect(formatCategoryHierarchyDate('2026-02-09', 'Unknown')).toContain('2026');

    expect(
      buildCategoryHierarchyTransactionKey({
        identifier: 'txn-1',
        vendor: 'Store',
      }),
    ).toBe('txn-1|Store');
  });
});
