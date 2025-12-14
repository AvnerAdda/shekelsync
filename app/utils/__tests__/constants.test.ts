import { describe, expect, it, vi } from 'vitest';

// CommonJS module; use require to keep parity with app imports.
const constants = require('../constants.js');

const {
  STALE_SYNC_THRESHOLD_MS,
  CREDIT_CARD_VENDORS,
  BANK_VENDORS,
  ACCOUNT_CATEGORIES,
  getAccountCategory,
  getAccountSubcategory,
  getInstitutionByVendorCode,
  getInstitutionById,
  getInstitutionsByType,
  getInstitutionsByCategory,
  getScrapableInstitutions,
  getAllInstitutions,
} = constants;

describe('constants helpers', () => {
  it('exposes sync threshold and vendor groupings', () => {
    expect(STALE_SYNC_THRESHOLD_MS).toBe(48 * 60 * 60 * 1000);
    expect(CREDIT_CARD_VENDORS).toContain('visaCal');
    expect(BANK_VENDORS).toContain('hapoalim');
    expect(ACCOUNT_CATEGORIES.BANKING.subcategories.CREDIT.vendors).toEqual(CREDIT_CARD_VENDORS);
  });

  it('derives account category and subcategory from vendor/type', () => {
    expect(getAccountCategory('visaCal')).toBe('banking');
    expect(getAccountCategory('pension')).toBe('investments');
    expect(getAccountCategory('cash')).toBe('other');

    expect(getAccountSubcategory('max')).toBe('credit');
    expect(getAccountSubcategory('mizrahi')).toBe('bank');
    expect(getAccountSubcategory('bonds')).toBe('alternative');
    expect(getAccountSubcategory('unknown-type')).toBe('cash');
  });
});

describe('institution lookups', () => {
  const rows = [{ id: 1, vendor_code: 'max' }];

  const makeDb = () => ({
    query: vi.fn().mockResolvedValue({ rows }),
  });

  it('queries vendor, id, type, category, scrapable, and all institutions', async () => {
    const db = makeDb();

    await expect(getInstitutionByVendorCode(db, 'max')).resolves.toEqual(rows[0]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('vendor_code'),
      ['max'],
    );

    await expect(getInstitutionById(db, 42)).resolves.toEqual(rows[0]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('id'),
      [42],
    );

    await expect(getInstitutionsByType(db, 'bank')).resolves.toEqual(rows);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('institution_type'), ['bank']);

    await expect(getInstitutionsByCategory(db, 'banking')).resolves.toEqual(rows);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('category'), ['banking']);

    await expect(getScrapableInstitutions(db)).resolves.toEqual(rows);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('is_scrapable'), []);

    await expect(getAllInstitutions(db)).resolves.toEqual(rows);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('is_active'), []);
  });

  it('returns empty results on query failures', async () => {
    const failingDb = {
      query: vi.fn().mockRejectedValue(new Error('boom')),
    };

    await expect(getInstitutionByVendorCode(failingDb, 'max')).resolves.toBeNull();
    await expect(getInstitutionById(failingDb, 5)).resolves.toBeNull();
    await expect(getInstitutionsByType(failingDb, 'bank')).resolves.toEqual([]);
    await expect(getInstitutionsByCategory(failingDb, 'banking')).resolves.toEqual([]);
    await expect(getScrapableInstitutions(failingDb)).resolves.toEqual([]);
    await expect(getAllInstitutions(failingDb)).resolves.toEqual([]);
  });
});
