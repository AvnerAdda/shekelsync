import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../smart-match.js');

const queryMock = vi.fn();
const getClientMock = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../repayment-category.js', () => ({
  getCreditCardRepaymentCategoryCondition: vi.fn(() => "cd.name = 'Credit Card Repayment'"),
}));

let smartMatchService: any;

beforeAll(async () => {
  const module = await modulePromise;
  smartMatchService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  getClientMock.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();

  getClientMock.mockResolvedValue(mockClient);

  smartMatchService.__setDatabase?.({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  smartMatchService.__resetDatabase?.();
});

describe('smart-match service', () => {
  describe('findSmartMatches', () => {
    it('returns matches with confidence scores', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            vendor_nickname: null,
            date: '2025-01-01',
            name: 'ישראכרט 1234',
            price: -1500,
            category_definition_id: 10,
            account_number: '5678',
            category_name: 'Credit Card Repayment',
            is_repayment: 1,
            institution_id: null,
          },
          {
            identifier: 'tx-2',
            vendor: 'hapoalim',
            vendor_nickname: null,
            date: '2025-01-02',
            name: 'תשלום כרטיס 1234',
            price: -2000,
            category_definition_id: 10,
            account_number: '5678',
            category_name: 'Credit Card Repayment',
            is_repayment: 1,
            institution_id: null,
          },
        ],
      });

      const result = await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '1234',
        bankVendor: 'hapoalim',
      });

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].confidence).toBeGreaterThan(0);
      expect(result.matches[0].matchedPatterns).toBeInstanceOf(Array);
      expect(result.searchPatterns).toContain('1234');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('throws 400 error when creditCardVendor is missing', async () => {
      await expect(
        smartMatchService.findSmartMatches({
          bankVendor: 'hapoalim',
        } as any)
      ).rejects.toMatchObject({
        status: 400,
        message: 'creditCardVendor and bankVendor are required',
      });
    });

    it('throws 400 error when bankVendor is missing', async () => {
      await expect(
        smartMatchService.findSmartMatches({
          creditCardVendor: 'isracard',
        } as any)
      ).rejects.toMatchObject({
        status: 400,
        message: 'creditCardVendor and bankVendor are required',
      });
    });

    it('returns empty results when no search patterns can be extracted', async () => {
      // No creditCardAccountNumber, nickname, or card6_digits provided
      // and vendor keywords are empty for unknown vendor
      const result = await smartMatchService.findSmartMatches({
        creditCardVendor: 'unknown_vendor',
        bankVendor: 'hapoalim',
      });

      // Since unknown_vendor has no keywords, searchPatterns will be empty
      expect(result.matches).toEqual([]);
      expect(result.patterns).toEqual([]);
    });

    it('extracts patterns from nickname', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        nickname: 'My Card',
      });

      expect(mockClient.query).toHaveBeenCalled();
      const queryParams = mockClient.query.mock.calls[0][1];
      // Should include nickname words "Card" (filters out words < 3 chars)
      expect(queryParams).toContain('Card');
    });

    it('extracts patterns from card6_digits', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        card6_digits: '123456;789012',
      });

      expect(mockClient.query).toHaveBeenCalled();
      const queryParams = mockClient.query.mock.calls[0][1];
      expect(queryParams).toContain('123456');
      expect(queryParams).toContain('789012');
      // Also last 4 digits
      expect(queryParams).toContain('3456');
      expect(queryParams).toContain('9012');
    });

    it('includes vendor keywords in search patterns', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        creditCardAccountNumber: '1234',
      });

      const queryParams = mockClient.query.mock.calls[0][1];
      // Should include isracard keywords
      expect(queryParams).toContain('ישראכרט');
      expect(queryParams).toContain('isracard');
    });

    it('boosts confidence for vendor_nickname matches', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            vendor_nickname: 'My Card',
            date: '2025-01-01',
            name: 'Some payment',
            price: -1000,
            category_definition_id: 10,
            account_number: '5678',
            category_name: 'Credit Card Repayment',
            is_repayment: 0,
            institution_id: null,
          },
        ],
      });

      const result = await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        nickname: 'My Card',
      });

      expect(result.matches[0].confidence).toBeGreaterThanOrEqual(5);
      expect(result.matches[0].matchedPatterns).toContain('vendor_nickname: My Card');
    });

    it('boosts confidence for repayment category', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            vendor_nickname: null,
            date: '2025-01-01',
            name: 'isracard payment',
            price: -1000,
            category_definition_id: 10,
            account_number: '5678',
            category_name: 'Credit Card Repayment',
            is_repayment: 1,
            institution_id: null,
          },
          {
            identifier: 'tx-2',
            vendor: 'hapoalim',
            vendor_nickname: null,
            date: '2025-01-02',
            name: 'isracard payment',
            price: -1000,
            category_definition_id: 11,
            account_number: '5678',
            category_name: 'Other',
            is_repayment: 0,
            institution_id: null,
          },
        ],
      });

      const result = await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
      });

      // First match should have higher confidence due to repayment category
      expect(result.matches[0].confidence).toBeGreaterThan(result.matches[1].confidence);
    });

    it('sorts matches by confidence descending', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            vendor_nickname: null,
            date: '2025-01-01',
            name: 'payment',
            price: -1000,
            is_repayment: 0,
            institution_id: null,
          },
          {
            identifier: 'tx-2',
            vendor: 'hapoalim',
            vendor_nickname: null,
            date: '2025-01-02',
            name: 'isracard 1234 payment',
            price: -2000,
            is_repayment: 1,
            institution_id: null,
          },
        ],
      });

      const result = await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '1234',
        bankVendor: 'hapoalim',
      });

      // Second row should be first due to more pattern matches and repayment category
      expect(result.matches[0].identifier).toBe('tx-2');
    });

    it('filters by bankAccountNumber when provided', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        bankAccountNumber: '5678',
      });

      const queryText = mockClient.query.mock.calls[0][0];
      expect(queryText).toContain('account_number');
      const queryParams = mockClient.query.mock.calls[0][1];
      expect(queryParams).toContain('5678');
    });

    it('ignores undefined bankAccountNumber', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        bankAccountNumber: 'undefined',
      });

      const queryText = mockClient.query.mock.calls[0][0];
      expect(queryText).not.toContain('t.account_number = $');
    });

    it('includes institution info in matches when available', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            vendor_nickname: null,
            date: '2025-01-01',
            name: 'isracard payment',
            price: -1000,
            category_definition_id: 10,
            account_number: '5678',
            category_name: 'Credit Card Repayment',
            is_repayment: 1,
            institution_id: 1,
            institution_vendor_code: 'hapoalim',
            institution_name_he: 'בנק הפועלים',
            institution_name_en: 'Bank Hapoalim',
            institution_logo: 'https://example.com/logo.png',
            institution_type: 'bank',
          },
        ],
      });

      const result = await smartMatchService.findSmartMatches({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
      });

      expect(result.matches[0].institution).toEqual({
        id: 1,
        vendor_code: 'hapoalim',
        display_name_he: 'בנק הפועלים',
        display_name_en: 'Bank Hapoalim',
        logo_url: 'https://example.com/logo.png',
        institution_type: 'bank',
      });
    });

    it('releases client even on error', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'));

      await expect(
        smartMatchService.findSmartMatches({
          creditCardVendor: 'isracard',
          bankVendor: 'hapoalim',
        })
      ).rejects.toThrow('Database error');

      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
