import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let institutionsService;

function createDbMock(rows = []) {
  return {
    query: vi.fn(async () => ({ rows, rowCount: rows.length })),
  };
}

beforeAll(async () => {
  const module = await import('../institutions.js');
  institutionsService = module.default ?? module;
});

beforeEach(() => {
  institutionsService.clearInstitutionsCache();
  vi.restoreAllMocks();
});

describe('institutions service', () => {
  it('loads institutions into cache and reuses cache until cleared', async () => {
    const db = createDbMock([
      { id: 1, vendor_code: 'hapoalim', institution_type: 'bank', category: 'banking', is_scrapable: 1 },
    ]);

    const first = await institutionsService.loadInstitutionsCache(db);
    const second = await institutionsService.loadInstitutionsCache(db);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(db.query).toHaveBeenCalledTimes(1);

    institutionsService.clearInstitutionsCache();
    await institutionsService.loadInstitutionsCache(db);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('gets institutions by id and vendor code (cache + fallback query)', async () => {
    const db = createDbMock([
      { id: 2, vendor_code: 'leumi', institution_type: 'bank', category: 'banking', is_scrapable: 1 },
    ]);
    await institutionsService.loadInstitutionsCache(db);

    await expect(institutionsService.getInstitutionById(db, 2)).resolves.toMatchObject({ vendor_code: 'leumi' });
    await expect(institutionsService.getInstitutionByVendorCode(db, 'leumi')).resolves.toMatchObject({ id: 2 });

    const fallbackDb = {
      query: vi.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('WHERE id = $1')) {
          return { rows: [{ id: 9, vendor_code: 'max' }] };
        }
        if (text.includes('WHERE vendor_code = $1')) {
          return { rows: [{ id: 10, vendor_code: 'discount' }] };
        }
        return { rows: [] };
      }),
    };
    institutionsService.clearInstitutionsCache();

    await expect(institutionsService.getInstitutionById(fallbackDb, 9)).resolves.toMatchObject({ vendor_code: 'max' });
    await expect(institutionsService.getInstitutionByVendorCode(fallbackDb, 'discount')).resolves.toMatchObject({ id: 10 });
  });

  it('filters institutions by type/category/scrapable and returns vendor code lists', async () => {
    const db = createDbMock([
      { id: 1, vendor_code: 'hapoalim', institution_type: 'bank', category: 'banking', is_scrapable: 1 },
      { id: 2, vendor_code: 'isracard', institution_type: 'credit_card', category: 'cards', is_scrapable: 1 },
      { id: 3, vendor_code: 'manual', institution_type: 'bank', category: 'banking', is_scrapable: 0 },
    ]);
    await institutionsService.loadInstitutionsCache(db);

    await expect(institutionsService.getAllInstitutions(db, { type: 'bank' })).resolves.toHaveLength(2);
    await expect(institutionsService.getInstitutionsByType(db, 'credit_card')).resolves.toHaveLength(1);
    await expect(institutionsService.getInstitutionsByCategory(db, 'banking')).resolves.toHaveLength(2);
    await expect(institutionsService.getScrapableInstitutions(db)).resolves.toHaveLength(2);

    await expect(institutionsService.getVendorCodesByTypes(db, ['bank'])).resolves.toEqual(['hapoalim', 'manual']);
    await expect(institutionsService.getVendorCodesByCategories(db, ['cards'])).resolves.toEqual(['isracard']);
    await expect(institutionsService.getVendorCodesByTypes(db, [])).resolves.toEqual([]);
    await expect(institutionsService.getVendorCodesByCategories(db, null)).resolves.toEqual([]);
  });

  it('maps institutions and vendor codes', async () => {
    expect(institutionsService.mapInstitutionToVendorCode(null)).toBeNull();
    expect(
      institutionsService.mapInstitutionToVendorCode({ vendor_code: 'hapoalim', scraper_company_id: 'scraperA' }),
    ).toBe('scraperA');
    expect(
      institutionsService.mapInstitutionToVendorCode({ vendor_code: 'hapoalim', scraper_company_id: null }),
    ).toBe('hapoalim');

    const db = createDbMock([{ id: 55, vendor_code: 'max' }]);
    await expect(institutionsService.mapVendorCodeToInstitutionId(db, 'max')).resolves.toBe(55);
  });

  it('builds institution payload from joined rows', () => {
    expect(institutionsService.buildInstitutionFromRow(null)).toBeNull();

    const institution = institutionsService.buildInstitutionFromRow({
      institution_id: 11,
      institution_vendor_code: 'hapoalim',
      institution_display_name_he: 'הפועלים',
      institution_display_name_en: 'Hapoalim',
      institution_type: 'bank',
      institution_category: 'banking',
      institution_subcategory: 'retail',
      institution_logo_url: 'https://logo',
      institution_is_scrapable: 1,
      institution_scraper_company_id: 'hapoalim',
      institution_parent_id: null,
      institution_hierarchy_path: 'banking/hapoalim',
      institution_depth_level: 2,
    });

    expect(institution).toMatchObject({
      id: 11,
      vendor_code: 'hapoalim',
      display_name_en: 'Hapoalim',
      is_scrapable: true,
      depth_level: 2,
    });
  });

  it('enriches credentials and accounts with institution metadata', async () => {
    const db = createDbMock([
      { id: 3, vendor_code: 'hapoalim', institution_type: 'bank', category: 'banking', is_scrapable: 1 },
      { id: 4, vendor_code: 'investment', institution_type: 'investment', category: 'investments', is_scrapable: 1 },
    ]);
    await institutionsService.loadInstitutionsCache(db);

    const credential = await institutionsService.enrichCredentialWithInstitution(db, {
      id: 1,
      institution_id: 3,
    });
    expect(credential.institution).toMatchObject({ vendor_code: 'hapoalim' });

    const fallbackCredential = await institutionsService.enrichCredentialWithInstitution(db, {
      id: 2,
      vendor: 'investment',
    });
    expect(fallbackCredential.institution).toMatchObject({ id: 4 });

    const account = await institutionsService.enrichAccountWithInstitution(db, {
      id: 3,
      institution_id: 4,
    });
    expect(account.institution).toMatchObject({ vendor_code: 'investment' });

    const fallbackAccount = await institutionsService.enrichAccountWithInstitution(db, {
      id: 4,
      account_type: 'hapoalim',
    });
    expect(fallbackAccount.institution).toMatchObject({ id: 3 });
  });

  it('returns institution tree query rows', async () => {
    const db = createDbMock([{ id: 1, hierarchy_path: 'banking/hapoalim' }]);
    await expect(institutionsService.getInstitutionTree(db)).resolves.toEqual([{ id: 1, hierarchy_path: 'banking/hapoalim' }]);
  });

  it('backfills missing institution ids and logs both success and failures', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const successDb = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 2 })
        .mockResolvedValueOnce({ rowCount: 1 }),
    };
    await institutionsService.backfillMissingInstitutionIds(successDb);
    expect(successDb.query).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenCalled();

    const failingDb = {
      query: vi
        .fn()
        .mockRejectedValueOnce(new Error('vendor update failed'))
        .mockRejectedValueOnce(new Error('investment update failed')),
    };
    await institutionsService.backfillMissingInstitutionIds(failingDb);
    expect(errorSpy).toHaveBeenCalled();
  });
});
