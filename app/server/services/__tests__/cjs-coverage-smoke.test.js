import { afterEach, describe, expect, it, vi } from 'vitest';

const checkExistingService = require('../investments/check-existing.js');
const bankSummaryService = require('../investments/bank-summary.js');
const patternsService = require('../investments/patterns.js');
const transactionsAdminService = require('../transactions/admin.js');
const settlementService = require('../accounts/settlement.js');

afterEach(() => {
  checkExistingService.__resetDatabase?.();
  bankSummaryService.__resetDatabase?.();
  patternsService.__resetDatabase?.();
  transactionsAdminService.__resetDatabase?.();
  settlementService.__resetDependencies?.();
  vi.restoreAllMocks();
});

describe('cjs coverage smoke', () => {
  it('covers check-existing mapping and linked account institution fallback', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            vendor: 'hapoalim',
            name: 'Savings transfer',
            category_definition_id: 10,
            category_name: 'Investments',
            parent_name: 'Finance',
            transaction_count: '2',
            total_amount: '100.5',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            name_pattern: 'interactive',
            category_definition_id: 10,
            category_name: 'Investments',
            parent_name: 'Finance',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            account_name: 'My Savings',
            account_type: 'savings',
            link_count: '3',
            institution_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 99,
            vendor_code: 'savings',
            display_name_en: 'Savings',
            display_name_he: 'חיסכון',
          },
        ],
      });

    checkExistingService.__setDatabase({ query });
    const result = await checkExistingService.getExistingInvestments();

    expect(result.vendors[0]).toMatchObject({
      vendor: 'hapoalim',
      transactionCount: 2,
      totalAmount: 100.5,
    });
    expect(result.rules[0].pattern).toBe('interactive');
    expect(result.linkedAccounts[0]).toMatchObject({
      accountType: 'savings',
      linkCount: 3,
      institution: { vendor_code: 'savings' },
    });
  });

  it('covers bank summary default aggregation and zero month-start fallback', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: 1,
            account_name: 'Checking',
            account_number: '1111',
            institution_id: null,
            current_balance: '450.25',
            as_of_date: '2026-02-15',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            date: '2026-02-15',
            account_id: 1,
            account_name: 'Checking',
            total_balance: '450.25',
            avg_balance: '450.25',
            min_balance: '450.25',
            max_balance: '450.25',
            snapshot_count: '1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ date: '2026-02-15', total_balance: '450.25' }] })
      .mockResolvedValueOnce({ rows: [] });

    bankSummaryService.__setDatabase({ query });
    const result = await bankSummaryService.getBankBalanceSummary({
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });

    expect(result.summary).toMatchObject({
      currentTotalBalance: 450.25,
      monthStartTotalBalance: 0,
      totalBalanceChange: 450.25,
      totalBalanceChangePercent: 0,
      accountCount: 1,
    });
    expect(result.accounts[0]).toMatchObject({
      monthStartBalance: 0,
      balanceChange: 0,
    });
  });

  it('covers investment patterns list/create/remove happy paths', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            account_id: 5,
            pattern: 'salary',
            pattern_type: 'substring',
            is_active: true,
            account_type: null,
            institution_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7, account_id: 5, pattern: 'salary' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, pattern: 'salary' }] });

    patternsService.__setDatabase({ query });

    const listed = await patternsService.listPatterns();
    expect(listed.total).toBe(1);
    expect(listed.patterns[0].institution).toBeNull();

    const created = await patternsService.createPattern({
      account_id: 5,
      pattern: 'salary',
      pattern_type: 'substring',
    });
    expect(created.success).toBe(true);

    const removed = await patternsService.removePattern({ id: 7 });
    expect(removed.success).toBe(true);
    expect(removed.deleted.id).toBe(7);
  });

  it('covers manual transaction admin flow including tag serialization', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 12,
            name: 'Rent',
            category_type: 'expense',
            parent_id: null,
            parent_name: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const getClient = vi.fn().mockResolvedValue({ query, release });
    const dbQuery = vi.fn().mockResolvedValue({ rows: [] });

    transactionsAdminService.__setDatabase({ getClient, query: dbQuery });

    const created = await transactionsAdminService.createManualTransaction({
      name: 'Rent manual',
      amount: 1000,
      date: '2026-01-01',
      type: 'expense',
      categoryDefinitionId: 12,
    });
    expect(created).toEqual({ success: true });
    expect(release).toHaveBeenCalledTimes(1);

    const updated = await transactionsAdminService.updateTransaction('id|vendor', {
      tags: ['one', 'two'],
      memo: 'hello',
    });
    expect(updated).toEqual({ success: true });
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE transactions'),
      expect.arrayContaining(['id', 'vendor', JSON.stringify(['one', 'two']), 'hello']),
    );
  });

  it('covers settlement matching and active-pairing filtering', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          identifier: 'tx-hide',
          vendor: 'hapoalim',
          date: '2026-01-01',
          name: 'isracard transfer',
          price: -120,
          category_definition_id: 1,
          category_name: 'Credit Card Repayment',
          category_name_en: 'Credit Card Repayment',
          account_number: '1111',
          match_reason: 'keyword_match',
          institution_id: null,
        },
        {
          identifier: 'tx-keep',
          vendor: 'hapoalim',
          date: '2026-01-02',
          name: 'other transfer',
          price: 80,
          category_definition_id: 1,
          category_name: 'Credit Card Repayment',
          category_name_en: 'Credit Card Repayment',
          account_number: '2222',
          match_reason: 'account_number_match',
          institution_id: null,
        },
      ],
    });
    const release = vi.fn();
    const getClient = vi.fn().mockResolvedValue({ query, release });

    settlementService.__setDatabase({ getClient });
    settlementService.__setPairingsService({
      getActivePairings: vi.fn().mockResolvedValue([
        {
          bankVendor: 'hapoalim',
          bankAccountNumber: '1111',
          matchPatterns: ['isracard'],
        },
      ]),
    });
    settlementService.__setRepaymentCategoryResolver(() => "cd.name = 'Credit Card Repayment'");

    const result = await settlementService.findSettlementCandidates({
      credit_card_account_number: '1234',
      bank_vendor: 'hapoalim',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].identifier).toBe('tx-keep');
    expect(result.stats).toMatchObject({
      total: 1,
      totalNegative: 0,
      totalPositive: 1,
    });
    expect(release).toHaveBeenCalledTimes(1);
  });
});
