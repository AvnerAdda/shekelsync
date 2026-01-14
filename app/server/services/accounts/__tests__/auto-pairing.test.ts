import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../auto-pairing.js');

const queryMock = vi.fn();
const getClientMock = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../repayment-category.js', () => ({
  getCreditCardRepaymentCategoryCondition: vi.fn(() => "cd.name = 'Credit Card Repayment'"),
}));

let autoPairingService: any;

beforeAll(async () => {
  const module = await modulePromise;
  autoPairingService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  getClientMock.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();

  getClientMock.mockResolvedValue(mockClient);

  autoPairingService.__setDatabase?.({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  autoPairingService.__resetDatabase?.();
});

describe('auto-pairing service', () => {

  describe('findBestBankAccount', () => {
    it('finds matching bank account based on repayment transactions', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            account_number: '9876',
            name: 'תשלום ישראכרט 5678',
            price: -1500,
            date: '2025-01-01',
          },
          {
            identifier: 'tx-2',
            vendor: 'hapoalim',
            account_number: '9876',
            name: 'תשלום ישראכרט 5678',
            price: -2000,
            date: '2025-01-15',
          },
        ],
      });

      const result = await autoPairingService.findBestBankAccount({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result.found).toBe(true);
      expect(result.bankVendor).toBe('hapoalim');
      expect(result.bankAccountNumber).toBe('9876');
      expect(result.matchingVendorCount).toBeGreaterThan(0);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns not found when no repayment transactions exist', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const result = await autoPairingService.findBestBankAccount({
        creditCardVendor: 'isracard',
      });

      expect(result.found).toBe(false);
      expect(result.reason).toContain('No bank repayment');
    });

    it('returns not found when no transactions match CC patterns', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            account_number: '9876',
            name: 'Generic payment',
            price: -1000,
            date: '2025-01-01',
          },
        ],
      });

      const result = await autoPairingService.findBestBankAccount({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result.found).toBe(false);
      expect(result.reason).toContain('No bank repayments reference');
    });

    it('throws 400 when creditCardVendor is missing', async () => {
      await expect(
        autoPairingService.findBestBankAccount({} as any)
      ).rejects.toMatchObject({
        status: 400,
        message: 'creditCardVendor is required',
      });
    });

    it('prioritizes last4 matches over vendor-only matches', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          // Bank A: vendor match only
          {
            identifier: 'tx-1',
            vendor: 'leumi',
            account_number: '1111',
            name: 'ישראכרט תשלום',
            price: -1000,
            date: '2025-01-01',
          },
          // Bank B: last4 match
          {
            identifier: 'tx-2',
            vendor: 'hapoalim',
            account_number: '2222',
            name: 'תשלום 5678',
            price: -1000,
            date: '2025-01-01',
          },
        ],
      });

      const result = await autoPairingService.findBestBankAccount({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result.found).toBe(true);
      expect(result.bankVendor).toBe('hapoalim');
    });

    it('releases client on error', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'));

      await expect(
        autoPairingService.findBestBankAccount({
          creditCardVendor: 'isracard',
        })
      ).rejects.toThrow();

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns sample transactions and other candidates', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          // Best match: hapoalim with last4 matches
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            account_number: '1111',
            name: 'תשלום 5678',
            price: -1500,
            date: '2025-01-01',
          },
          {
            identifier: 'tx-2',
            vendor: 'hapoalim',
            account_number: '1111',
            name: 'תשלום ישראכרט 5678',
            price: -2000,
            date: '2025-01-15',
          },
          // Second candidate: leumi with vendor matches
          {
            identifier: 'tx-3',
            vendor: 'leumi',
            account_number: '2222',
            name: 'ישראכרט תשלום',
            price: -1000,
            date: '2025-01-10',
          },
          // Third candidate: discount with vendor matches
          {
            identifier: 'tx-4',
            vendor: 'discount',
            account_number: '3333',
            name: 'ישראכרט חודשי',
            price: -500,
            date: '2025-01-05',
          },
        ],
      });

      const result = await autoPairingService.findBestBankAccount({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result.found).toBe(true);
      expect(result.bankVendor).toBe('hapoalim');
      expect(result.sampleTransactions).toBeDefined();
      expect(result.sampleTransactions.length).toBeGreaterThan(0);
      expect(result.sampleTransactions.length).toBeLessThanOrEqual(3);
      expect(result.otherCandidates).toBeDefined();
      expect(result.otherCandidates.length).toBeGreaterThanOrEqual(1);
    });

    it('handles multiple accounts from same bank', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            account_number: '1111',
            name: 'תשלום ישראכרט 5678',
            price: -1000,
            date: '2025-01-01',
          },
          {
            identifier: 'tx-2',
            vendor: 'hapoalim',
            account_number: '2222',
            name: 'תשלום ישראכרט 5678',
            price: -2000,
            date: '2025-01-02',
          },
          {
            identifier: 'tx-3',
            vendor: 'hapoalim',
            account_number: '2222',
            name: 'תשלום ישראכרט 5678',
            price: -1500,
            date: '2025-01-15',
          },
        ],
      });

      const result = await autoPairingService.findBestBankAccount({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result.found).toBe(true);
      // Account 2222 has more transactions, should be picked
      expect(result.bankAccountNumber).toBe('2222');
      expect(result.transactionCount).toBe(2);
    });

    it('handles null account_number in transactions', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            account_number: null,
            name: 'תשלום ישראכרט 5678',
            price: -1500,
            date: '2025-01-01',
          },
        ],
      });

      const result = await autoPairingService.findBestBankAccount({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result.found).toBe(true);
      expect(result.bankAccountNumber).toBeNull();
    });

    it('matches different credit card vendors', async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            identifier: 'tx-1',
            vendor: 'hapoalim',
            account_number: '1111',
            name: 'תשלום מקס',
            price: -1500,
            date: '2025-01-01',
          },
        ],
      });

      const result = await autoPairingService.findBestBankAccount({
        creditCardVendor: 'max',
      });

      expect(result.found).toBe(true);
      expect(result.matchingVendorCount).toBeGreaterThan(0);
    });
  });

  describe('calculateDiscrepancy', () => {
    it('returns null when bankVendor is missing', async () => {
      const result = await autoPairingService.calculateDiscrepancy({
        ccVendor: 'isracard',
      } as any);

      expect(result).toBeNull();
    });

    it('returns null when ccVendor is missing', async () => {
      const result = await autoPairingService.calculateDiscrepancy({
        bankVendor: 'hapoalim',
      } as any);

      expect(result).toBeNull();
    });

    it('calculates discrepancy between bank and CC transactions', async () => {
      // First query: CC fees category lookup
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })
        // Earliest CC cycle date (field is min_date)
        .mockResolvedValueOnce({ rows: [{ min_date: '2024-10-01' }] })
        // Bank repayments (needs repayment_date field)
        .mockResolvedValueOnce({
          rows: [
            {
              identifier: 'bank-1',
              vendor: 'hapoalim',
              name: 'ישראכרט 5678',
              price: -1500,
              date: '2025-01-05',
              repayment_date: '2025-01-05',
              account_number: '9876',
            },
          ],
        })
        // account_pairings query (empty to skip allocation logic)
        .mockResolvedValueOnce({ rows: [] })
        // CC expenses for matching cycle (fields are account_number, total, txn_count)
        .mockResolvedValueOnce({
          rows: [
            {
              account_number: '5678',
              total: 1500,
              txn_count: 5,
            },
          ],
        });

      const result = await autoPairingService.calculateDiscrepancy({
        bankVendor: 'hapoalim',
        bankAccountNumber: '9876',
        ccVendor: 'isracard',
        ccAccountNumber: '5678',
        monthsBack: 3,
      });

      expect(result).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('includes acknowledged flag from pairing', async () => {
      mockClient.query
        // Acknowledged check
        .mockResolvedValueOnce({ rows: [{ discrepancy_acknowledged: true }] })
        // CC fees category
        .mockResolvedValueOnce({ rows: [] })
        // Earliest date
        .mockResolvedValueOnce({ rows: [] })
        // Bank repayments
        .mockResolvedValueOnce({ rows: [] });

      const result = await autoPairingService.calculateDiscrepancy({
        pairingId: 1,
        bankVendor: 'hapoalim',
        ccVendor: 'isracard',
      });

      expect(result?.acknowledged).toBe(true);
    });

    it('returns exists: false when no matching repayments found', async () => {
      mockClient.query
        // CC fees category
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })
        // Earliest date
        .mockResolvedValueOnce({ rows: [{ min_date: '2024-10-01' }] })
        // Bank repayments (no matches for this CC)
        .mockResolvedValueOnce({
          rows: [
            {
              identifier: 'bank-1',
              vendor: 'hapoalim',
              name: 'Generic payment',
              price: -1500,
              date: '2025-01-05',
              repayment_date: '2025-01-05',
              account_number: '9876',
            },
          ],
        })
        // account_pairings query
        .mockResolvedValueOnce({ rows: [] });

      const result = await autoPairingService.calculateDiscrepancy({
        bankVendor: 'hapoalim',
        bankAccountNumber: '9876',
        ccVendor: 'isracard',
        ccAccountNumber: '5678',
        monthsBack: 3,
      });

      expect(result).toBeDefined();
      expect(result.exists).toBe(false);
      expect(result.reason).toContain('No bank repayments found matching');
    });

    it('handles missing ccFeesCategoryId gracefully', async () => {
      mockClient.query
        // CC fees category - not found
        .mockResolvedValueOnce({ rows: [] })
        // Earliest date
        .mockResolvedValueOnce({ rows: [] })
        // Bank repayments - empty
        .mockResolvedValueOnce({ rows: [] });

      const result = await autoPairingService.calculateDiscrepancy({
        bankVendor: 'hapoalim',
        ccVendor: 'isracard',
      });

      expect(result).toBeDefined();
      expect(result.exists).toBe(false);
    });

    it('releases client even on error', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'));

      await expect(
        autoPairingService.calculateDiscrepancy({
          bankVendor: 'hapoalim',
          ccVendor: 'isracard',
        })
      ).rejects.toThrow('Database error');

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('uses default monthsBack of 3', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // CC fees
        .mockResolvedValueOnce({ rows: [] }) // Earliest date
        .mockResolvedValueOnce({ rows: [] }); // Bank repayments

      const result = await autoPairingService.calculateDiscrepancy({
        bankVendor: 'hapoalim',
        ccVendor: 'isracard',
      });

      expect(result.periodMonths).toBe(3);
    });
  });

  describe('autoPairCreditCard', () => {
    it('throws 400 when creditCardVendor is missing', async () => {
      await expect(
        autoPairingService.autoPairCreditCard({} as any)
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('returns not found when no matching bank account exists', async () => {
      // findBestBankAccount query returns no repayments
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const result = await autoPairingService.autoPairCreditCard({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.reason).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('releases client on error', async () => {
      mockClient.query.mockRejectedValue(new Error('Database error'));

      await expect(
        autoPairingService.autoPairCreditCard({
          creditCardVendor: 'isracard',
        })
      ).rejects.toThrow();

      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
