import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../auto-pairing.js');

const queryMock = vi.fn();
const getClientMock = vi.fn();
const listPairingsMock = vi.fn();
const createPairingMock = vi.fn();
const updatePairingMock = vi.fn();
const getCreditCardRepaymentCategoryConditionMock = vi.fn(() => "cd.name = 'Credit Card Repayment'");
const getCreditCardRepaymentCategoryIdMock = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../pairings.js', () => ({
  listPairings: listPairingsMock,
  createPairing: createPairingMock,
  updatePairing: updatePairingMock,
}));

vi.mock('../repayment-category.js', () => ({
  getCreditCardRepaymentCategoryCondition: getCreditCardRepaymentCategoryConditionMock,
  getCreditCardRepaymentCategoryId: getCreditCardRepaymentCategoryIdMock,
}));

let autoPairingService: any;

beforeAll(async () => {
  const module = await modulePromise;
  autoPairingService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  getClientMock.mockReset();
  listPairingsMock.mockReset();
  createPairingMock.mockReset();
  updatePairingMock.mockReset();
  getCreditCardRepaymentCategoryConditionMock.mockReset();
  getCreditCardRepaymentCategoryIdMock.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();

  getClientMock.mockResolvedValue(mockClient);
  listPairingsMock.mockResolvedValue([]);
  createPairingMock.mockResolvedValue({ pairingId: 101 });
  updatePairingMock.mockResolvedValue({ success: true });
  getCreditCardRepaymentCategoryConditionMock.mockReturnValue("cd.name = 'Credit Card Repayment'");
  getCreditCardRepaymentCategoryIdMock.mockResolvedValue(55);

  autoPairingService.__setDatabase?.({
    query: queryMock,
    getClient: getClientMock,
  });
  autoPairingService.__setDependencies?.({
    pairingsService: {
      listPairings: listPairingsMock,
      createPairing: createPairingMock,
      updatePairing: updatePairingMock,
    },
    repaymentCategory: {
      getCreditCardRepaymentCategoryCondition: getCreditCardRepaymentCategoryConditionMock,
      getCreditCardRepaymentCategoryId: getCreditCardRepaymentCategoryIdMock,
    },
  });
});

afterEach(() => {
  autoPairingService.__resetDatabase?.();
  autoPairingService.__resetDependencies?.();
});

describe('auto-pairing service', () => {
  describe('_internal helpers', () => {
    it('extracts account suffixes, digit hints, vendor matches, and match patterns', () => {
      const internal = autoPairingService._internal;

      expect(internal.getAccountLast4('12345678')).toBe('5678');
      expect(internal.getAccountLast4('  9876  ')).toBe('9876');
      expect(internal.getAccountLast4('')).toBeNull();
      expect(internal.getAccountLast4(null)).toBeNull();

      expect(internal.extractDigitSequences('Repayment 123456789')).toEqual(
        expect.arrayContaining(['123456789', '6789']),
      );
      expect(internal.extractDigitSequences('no digits')).toEqual([]);

      expect(internal.nameContainsVendor('תשלום ישראכרט', 'isracard')).toBe(true);
      expect(internal.detectCCVendorFromName('Monthly MAX charge')).toBe('max');
      expect(internal.detectCCVendorFromName('unknown')).toBeNull();

      expect(internal.buildMatchPatterns('isracard', '12345678')).toEqual(
        expect.arrayContaining(['ישראכרט', 'isracard', '12345678', '5678']),
      );
    });

    it('applies pairing transaction updates only when repayment category id is available', async () => {
      const internal = autoPairingService._internal;

      await expect(
        internal.applyPairingToTransactions({
          bankVendor: 'hapoalim',
          matchPatterns: [],
        }),
      ).resolves.toEqual({ transactionsUpdated: 0 });

      getCreditCardRepaymentCategoryIdMock.mockResolvedValueOnce(null);
      await expect(
        internal.applyPairingToTransactions({
          pairingId: 1,
          bankVendor: 'hapoalim',
          bankAccountNumber: '9876',
          matchPatterns: ['ישראכרט'],
        }),
      ).resolves.toEqual({ transactionsUpdated: 0 });

      mockClient.query.mockImplementation(async (sql: string) => {
        const normalized = String(sql);
        if (normalized.includes('UPDATE transactions')) {
          return { rowCount: 3, rows: [] };
        }
        if (normalized.includes('INSERT INTO account_pairing_log')) {
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      });

      const result = await internal.applyPairingToTransactions({
        pairingId: 9,
        bankVendor: 'hapoalim',
        bankAccountNumber: '9876',
        matchPatterns: ['ישראכרט', '5678'],
      });

      expect(result.transactionsUpdated).toBe(3);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO account_pairing_log'),
        [9, 'applied', 3],
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

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

    it('uses allocated matching when multiple same-vendor cards share a bank account', async () => {
      mockClient.query
        // CC fees category
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })
        // Earliest CC cycle
        .mockResolvedValueOnce({ rows: [{ min_date: '2024-10-01' }] })
        // Bank repayments for shared account/date
        .mockResolvedValueOnce({
          rows: [
            {
              identifier: 'bank-1',
              vendor: 'hapoalim',
              name: 'ישראכרט חיוב חודשי',
              price: -1000,
              date: '2025-01-05',
              repayment_date: '2025-01-05',
              account_number: '9876',
            },
            {
              identifier: 'bank-2',
              vendor: 'hapoalim',
              name: 'ישראכרט חיוב חודשי',
              price: -500,
              date: '2025-01-05',
              repayment_date: '2025-01-05',
              account_number: '9876',
            },
          ],
        })
        // Active pairings for same bank/vendor with 2 different CC accounts
        .mockResolvedValueOnce({
          rows: [
            { credit_card_account_number: '5678' },
            { credit_card_account_number: '9999' },
          ],
        })
        // CC totals by account/date (used by allocation)
        .mockResolvedValueOnce({
          rows: [
            { account_number: '5678', cycle_date: '2025-01-05', total: 1000 },
            { account_number: '9999', cycle_date: '2025-01-05', total: 500 },
          ],
        })
        // Per-cycle CC comparison for target account
        .mockResolvedValueOnce({
          rows: [
            { account_number: '5678', total: 1000, txn_count: 2 },
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
      expect(result.method).toBe('allocated');
      expect(result.totalCycles).toBeGreaterThan(0);
      expect(result.matchedCycleCount).toBeGreaterThanOrEqual(1);
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

    it('creates a new pairing when a bank match is found and no existing pairing exists', async () => {
      mockClient.query
        // findBestBankAccount query
        .mockResolvedValueOnce({
          rows: [
            {
              identifier: 'tx-1',
              vendor: 'hapoalim',
              account_number: '9876',
              name: 'ישראכרט 5678',
              price: -1200,
              date: '2025-01-02',
            },
          ],
        })
        // discrepancy: cc fees category
        .mockResolvedValueOnce({ rows: [] })
        // discrepancy: earliest cycle
        .mockResolvedValueOnce({ rows: [] })
        // discrepancy: bank repayments
        .mockResolvedValueOnce({ rows: [] })
        // discrepancy: account_pairings lookup for shared allocation
        .mockResolvedValueOnce({ rows: [] });

      const result = await autoPairingService.autoPairCreditCard({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result.success).toBe(true);
      expect(result.wasCreated).toBe(true);
      expect(result.pairing.id).toBe(101);
      expect(createPairingMock).toHaveBeenCalledTimes(1);
    });

    it('reactivates an existing inactive pairing instead of creating a new one', async () => {
      listPairingsMock.mockResolvedValueOnce([
        {
          id: 77,
          creditCardVendor: 'isracard',
          creditCardAccountNumber: '12345678',
          bankVendor: 'hapoalim',
          bankAccountNumber: '9876',
          isActive: false,
        },
      ]);

      mockClient.query
        // findBestBankAccount query
        .mockResolvedValueOnce({
          rows: [
            {
              identifier: 'tx-1',
              vendor: 'hapoalim',
              account_number: '9876',
              name: 'ישראכרט 5678',
              price: -1200,
              date: '2025-01-02',
            },
          ],
        })
        // discrepancy: cc fees category
        .mockResolvedValueOnce({ rows: [] })
        // discrepancy: earliest cycle
        .mockResolvedValueOnce({ rows: [] })
        // discrepancy: bank repayments
        .mockResolvedValueOnce({ rows: [] })
        // discrepancy: account_pairings lookup for shared allocation
        .mockResolvedValueOnce({ rows: [] });

      const result = await autoPairingService.autoPairCreditCard({
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '12345678',
      });

      expect(result.success).toBe(true);
      expect(result.wasCreated).toBe(false);
      expect(result.pairing.id).toBe(77);
      expect(updatePairingMock).toHaveBeenCalledTimes(1);
      expect(createPairingMock).not.toHaveBeenCalled();
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
