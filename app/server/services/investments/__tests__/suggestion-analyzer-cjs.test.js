import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = require('../../database.js');
const institutions = require('../../institutions.js');

function loadAnalyzer() {
  delete require.cache[require.resolve('../suggestion-analyzer-cjs.js')];
  return require('../suggestion-analyzer-cjs.js');
}

let analyzer;
let databaseQuerySpy;
let institutionLookupSpy;

describe('suggestion-analyzer-cjs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    databaseQuerySpy = vi.spyOn(database, 'query');
    institutionLookupSpy = vi.spyOn(institutions, 'getInstitutionByVendorCode');
    analyzer = loadAnalyzer();
  });

  describe('detectAccountType', () => {
    it('returns null for empty description', () => {
      expect(analyzer.detectAccountType('')).toBeNull();
      expect(analyzer.detectAccountType(null)).toBeNull();
    });

    it('detects pension from exact keyword and includes keyword reason', () => {
      const result = analyzer.detectAccountType('pension');
      expect(result).toMatchObject({
        accountType: 'pension',
      });
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.matchReason).toContain('Matched keywords');
    });

    it('detects by non-keyword pattern and returns pattern reason', () => {
      const result = analyzer.detectAccountType('retirement transfer');
      expect(result).toMatchObject({
        accountType: 'pension',
      });
      expect(result.matchReason).toContain('Matched pattern for pension');
    });

    it('returns null when no patterns match', () => {
      expect(analyzer.detectAccountType('Coffee at Starbucks')).toBeNull();
    });
  });

  describe('analyzeTransaction', () => {
    it('returns enriched suggestion with institution metadata when detected', async () => {
      institutionLookupSpy.mockResolvedValue({
        id: 42,
        vendor_code: 'brokerage',
        display_name_he: 'ברוקר',
        display_name_en: 'Broker',
        institution_type: 'investment',
      });

      const result = await analyzer.analyzeTransaction({
        identifier: 'txn-1',
        vendor: 'leumi',
        description: 'transfer to interactive brokers account',
        date: '2026-01-02',
        price: -1200,
        category_name: 'Investments',
      });

      expect(institutionLookupSpy).toHaveBeenCalledWith(expect.any(Object), 'brokerage');
      expect(result).toMatchObject({
        transactionIdentifier: 'txn-1',
        suggestedAccountType: 'brokerage',
        suggestedInstitution: 'Interactive brokers',
        suggestedAccountName: 'חשבון ברוקר - Interactive brokers',
      });
      expect(result.institution).toMatchObject({
        id: 42,
        vendor_code: 'brokerage',
      });
    });

    it('uses fallback account type and category when no pattern is detected', async () => {
      institutionLookupSpy.mockResolvedValue(null);

      const result = await analyzer.analyzeTransaction({
        identifier: 'txn-2',
        vendor: 'max',
        description: 'unknown generic transfer text',
        date: '2026-01-05',
        price: -100,
        category_name: 'Alt Investments Bucket',
      });

      expect(result).toMatchObject({
        suggestedAccountType: 'other',
        suggestedInstitution: null,
        suggestedAccountName: 'Alt Investments Bucket',
        confidence: 0.5,
        matchReason: 'Category: Alt Investments Bucket',
      });
      expect(result.institution).toBeNull();
      expect(institutionLookupSpy).toHaveBeenCalledWith(expect.any(Object), 'other');
    });

    it('falls back to description snippet when category name is missing', async () => {
      institutionLookupSpy.mockResolvedValue(null);

      const result = await analyzer.analyzeTransaction({
        identifier: 'txn-3',
        vendor: 'max',
        description: 'zzzz zzzz zzzz zzzz zzzz zzzz zzzz zzzz zzzz zzzz zzzz',
        date: '2026-01-07',
        price: -220,
      });

      expect(result.suggestedAccountType).toBe('other');
      expect(result.suggestedAccountName.length).toBeLessThanOrEqual(50);
      expect(result.suggestedAccountName).toContain('zzzz');
    });

    it('creates synthetic institution metadata when institution is detected but lookup misses', async () => {
      institutionLookupSpy.mockResolvedValue(null);

      const result = await analyzer.analyzeTransaction({
        identifier: 'txn-4',
        vendor: 'hapoalim',
        description: 'purchase via Bits of Gold',
        date: '2026-01-10',
        price: -500,
        category_name: 'Crypto',
      });

      expect(result.suggestedAccountType).toBe('crypto');
      expect(result.suggestedInstitution).toBe('Bits of gold');
      expect(result.institution).toMatchObject({
        id: null,
        vendor_code: 'crypto',
        display_name_he: 'Bits of gold',
        display_name_en: 'Bits of gold',
        institution_type: 'investment',
      });
    });

    it('continues gracefully if institution lookup throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      institutionLookupSpy.mockRejectedValue(new Error('lookup failed'));

      const result = await analyzer.analyzeTransaction({
        identifier: 'txn-5',
        vendor: 'isracard',
        description: 'pension',
        date: '2026-01-11',
        price: -700,
        category_name: 'Pension',
      });

      expect(result.suggestedAccountType).toBe('pension');
      expect(result.institution).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[suggestion-analyzer-cjs] Failed to load institution metadata',
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
  });

  describe('getUnlinkedInvestmentTransactions', () => {
    it('queries investment transactions with default threshold', async () => {
      databaseQuerySpy.mockResolvedValue({
        rows: [{ identifier: 'txn-a' }],
      });

      const rows = await analyzer.getUnlinkedInvestmentTransactions();
      expect(rows).toEqual([{ identifier: 'txn-a' }]);
      expect(databaseQuerySpy).toHaveBeenCalledTimes(1);
      expect(databaseQuerySpy.mock.calls[0][0]).toContain("cd.category_type = 'investment'");
      expect(databaseQuerySpy.mock.calls[0][1]).toEqual([90]);
    });

    it('passes custom threshold days to database query', async () => {
      databaseQuerySpy.mockResolvedValue({ rows: [] });
      await analyzer.getUnlinkedInvestmentTransactions(30);
      expect(databaseQuerySpy).toHaveBeenCalledWith(expect.any(String), [30]);
    });
  });

  describe('analyzeInvestmentTransactions', () => {
    it('returns empty list when there are no unlinked investment transactions', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      databaseQuerySpy.mockResolvedValue({ rows: [] });

      const result = await analyzer.analyzeInvestmentTransactions();

      expect(result).toEqual([]);
      expect(logSpy).toHaveBeenCalledWith('Found 0 unlinked investment txns');
      logSpy.mockRestore();
    });

    it('groups suggestions by category and computes aggregate metrics', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      institutionLookupSpy.mockResolvedValue(null);
      databaseQuerySpy.mockResolvedValue({
        rows: [
          {
            identifier: 'txn-1',
            vendor: 'leumi',
            description: 'pension manulife',
            date: '2026-01-01',
            price: -100,
            category_name: 'Retirement',
          },
          {
            identifier: 'txn-2',
            vendor: 'leumi',
            description: 'pension manulife extra',
            date: '2026-03-01',
            price: -150,
            category_name: 'Retirement',
          },
          {
            identifier: 'txn-3',
            vendor: 'max',
            description: 'bits of gold',
            date: '2026-02-01',
            price: -300,
            category_name: null,
          },
        ],
      });

      const result = await analyzer.analyzeInvestmentTransactions(120);

      expect(databaseQuerySpy).toHaveBeenCalledWith(expect.any(String), [120]);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        categoryName: 'Retirement',
        transactionCount: 2,
        totalAmount: 250,
      });
      expect(result[0].dateRange).toEqual({
        earliest: '2026-01-01',
        latest: '2026-03-01',
      });
      expect(result[0].avgConfidence).toBeGreaterThan(0);
      expect(result[1].suggestedAccountName).toBeTruthy();
      expect(logSpy).toHaveBeenCalledWith('Created 2 suggestion groups');
      logSpy.mockRestore();
    });
  });
});
