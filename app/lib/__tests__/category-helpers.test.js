const {
  normalizeCategoryPath,
  resolveCategory,
} = require('../category-helpers.js');

describe('category-helpers', () => {
  it('normalizes category paths by trimming segments', () => {
    expect(normalizeCategoryPath(' Food > Dining > Restaurants ')).toBe('Food > Dining > Restaurants');
    expect(normalizeCategoryPath(null)).toBeNull();
  });

  it('resolves category via mapping then enriches via category definition', async () => {
    const query = vi.fn()
      // resolveCategoryFromMapping
      .mockResolvedValueOnce({
        rows: [
          {
            category_definition_id: 1,
            subcategory: 'Dining',
            parent_id: 2,
            parent_category: 'Food',
          },
        ],
      })
      // getCategoryInfo
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: 'Dining',
            name_en: 'Dining',
            category_type: 'expense',
            parent_id: 2,
            parent_name: 'Food',
            parent_name_en: 'Food',
          },
        ],
      });

    const client = { query };

    const result = await resolveCategory({
      client,
      rawCategory: 'Dining',
      transactionName: 'Dinner at restaurant',
    });

    expect(result).toEqual({
      categoryDefinitionId: 1,
      parentCategory: 'Food',
      subcategory: 'Dining',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('falls back to rule matching when mapping is empty', async () => {
    const query = vi.fn()
      // resolveCategoryFromMapping -> empty
      .mockResolvedValueOnce({ rows: [] })
      // matchCategorizationRule -> rows with pattern match
      .mockResolvedValueOnce({
        rows: [
          {
            name_pattern: 'coffee shop',
            category_definition_id: 3,
            subcategory: 'Coffee',
            parent_category: 'Food',
            parent_id: 2,
          },
        ],
      })
      // getCategoryInfo
      .mockResolvedValueOnce({
        rows: [
          {
            id: 3,
            name: 'Coffee',
            name_en: 'Coffee',
            category_type: 'expense',
            parent_id: 2,
            parent_name: 'Food',
            parent_name_en: 'Food',
          },
        ],
      });

    const client = { query };

    const result = await resolveCategory({
      client,
      rawCategory: 'Unknown',
      transactionName: 'Morning coffee shop visit',
    });

    expect(result).toEqual({
      categoryDefinitionId: 3,
      parentCategory: 'Food',
      subcategory: 'Coffee',
    });
    expect(query).toHaveBeenCalledTimes(3);
  });
});
