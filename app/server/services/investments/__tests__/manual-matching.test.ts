import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const releaseMock = vi.fn();

let manualMatchingService: any;

beforeAll(async () => {
  const module = await import('../manual-matching.js');
  manualMatchingService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  releaseMock.mockReset();

  manualMatchingService.__setDatabase({
    getClient: async () => ({
      query: (...args: any[]) => queryMock(...args),
      release: (...args: any[]) => releaseMock(...args),
    }),
  });
});

afterEach(() => {
  manualMatchingService.__resetDatabase();
});

describe('manual matching service', () => {
  const buildExpenseRows = (count: number, amount: number, baseDate = '2026-01-01') =>
    Array.from({ length: count }, (_, idx) => ({
      identifier: `exp-${idx + 1}`,
      vendor: 'max',
      date: baseDate,
      name: `Expense ${idx + 1}`,
      price: `-${amount}`,
      account_number: '9999',
      category_definition_id: 1,
      category_name: 'Food',
      processed_date: null,
      is_matched: 0,
    }));

  it('returns unmatched repayments and applies optional name patterns', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'rep-1',
          vendor: 'leumi',
          date: '2026-01-10',
          name: 'Visa repayment',
          price: '-100',
          account_number: '1234',
          matched_amount: '30',
          remaining_amount: '70',
        },
      ],
    });

    const result = await manualMatchingService.getUnmatchedRepayments({
      creditCardAccountNumber: '5555',
      creditCardVendor: 'visa',
      bankVendor: 'leumi',
      bankAccountNumber: '1234',
      matchPatterns: ['Visa', 'Master'],
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('t.name LIKE $4');
    expect(queryMock.mock.calls[0][1]).toEqual([
      'leumi',
      '1234',
      'פרעון כרטיס אשראי',
      '%Visa%',
      '%Master%',
    ]);
    expect(result).toEqual([
      {
        identifier: 'rep-1',
        vendor: 'leumi',
        date: '2026-01-10',
        name: 'Visa repayment',
        price: -100,
        accountNumber: '1234',
        matchedAmount: 30,
        remainingAmount: 70,
        isPartiallyMatched: true,
      },
    ]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns available processed dates with parsed stats', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          processed_date: '2026-01-20',
          expense_count: '4',
          total_amount: '420.5',
          earliest_expense_date: '2025-12-21',
          latest_expense_date: '2026-01-19',
        },
      ],
    });

    const result = await manualMatchingService.getAvailableProcessedDates({
      creditCardAccountNumber: '1111',
      creditCardVendor: 'isracard',
      startDate: '2025-12-01',
      endDate: '2026-01-31',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([
      'isracard',
      '1111',
      '2025-12-01T00:00:00.000Z',
      '2026-01-31T00:00:00.000Z',
    ]);
    expect(result).toEqual([
      {
        processedDate: '2026-01-20',
        expenseCount: 4,
        totalAmount: 420.5,
        earliestExpenseDate: '2025-12-21',
        latestExpenseDate: '2026-01-19',
      },
    ]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('uses default 12-month plus 60-day window for processed dates when no range is provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-12T00:00:00.000Z'));
    queryMock.mockResolvedValueOnce({ rows: [] });

    await manualMatchingService.getAvailableProcessedDates({
      creditCardAccountNumber: '2222',
      creditCardVendor: 'max',
    });

    const [, params] = queryMock.mock.calls[0];
    expect(params[0]).toBe('max');
    expect(params[1]).toBe('2222');
    const start = new Date(params[2] as string);
    const end = new Date(params[3] as string);
    const daysBetween = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    expect(daysBetween).toBe(365);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(releaseMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('uses processed-date smart mode in getAvailableExpenses', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'exp-1',
          vendor: 'max',
          date: '2026-01-18',
          name: 'Coffee',
          price: '-20',
          account_number: '9999',
          category_definition_id: 8,
          category_name: 'Food',
          processed_date: '2026-01-20',
          is_matched: 1,
        },
      ],
    });

    const result = await manualMatchingService.getAvailableExpenses({
      creditCardVendor: 'max',
      creditCardAccountNumber: '9999',
      repaymentDate: '2026-01-20',
      processedDate: '2026-01-20',
      includeMatched: false,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('t.processed_date = $3');
    expect(String(queryMock.mock.calls[0][0])).toContain('expense_txn_id');
    expect(queryMock.mock.calls[0][1]).toEqual(['max', '9999', '2026-01-20']);
    expect(result[0]).toEqual({
      identifier: 'exp-1',
      vendor: 'max',
      date: '2026-01-18',
      name: 'Coffee',
      price: -20,
      accountNumber: '9999',
      categoryId: 8,
      categoryName: 'Food',
      processedDate: '2026-01-20',
      isMatched: true,
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('uses legacy date window mode in getAvailableExpenses when processedDate is absent', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await manualMatchingService.getAvailableExpenses({
      creditCardVendor: 'max',
      creditCardAccountNumber: '9999',
      repaymentDate: '2026-02-20',
      includeMatched: true,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toContain('t.date >= $3 AND t.date <= $4');
    expect(String(sql)).not.toContain('WHERE expense_vendor = $1');
    expect(params[0]).toBe('max');
    expect(params[1]).toBe('9999');
    expect(params[3]).toBe('2026-02-20T00:00:00.000Z');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns processed-date repayments with total amount aggregation', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'r1',
          vendor: 'hapoalim',
          date: '2026-02-05',
          name: 'Repayment A',
          price: '-120',
          account_number: '100',
        },
        {
          identifier: 'r2',
          vendor: 'hapoalim',
          date: '2026-02-05',
          name: 'Repayment B',
          price: '-30',
          account_number: '100',
        },
      ],
    });

    const result = await manualMatchingService.getBankRepaymentsForProcessedDate({
      processedDate: '2026-02-05',
      bankVendor: 'hapoalim',
      bankAccountNumber: '100',
      matchPatterns: ['כרטיס'],
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('t.name LIKE $5');
    expect(queryMock.mock.calls[0][1]).toEqual([
      'hapoalim',
      '100',
      '2026-02-05',
      'פרעון כרטיס אשראי',
      '%כרטיס%',
    ]);
    expect(result).toEqual({
      processedDate: '2026-02-05',
      repayments: [
        {
          identifier: 'r1',
          vendor: 'hapoalim',
          date: '2026-02-05',
          name: 'Repayment A',
          price: -120,
          accountNumber: '100',
        },
        {
          identifier: 'r2',
          vendor: 'hapoalim',
          date: '2026-02-05',
          name: 'Repayment B',
          price: -30,
          accountNumber: '100',
        },
      ],
      totalRepaymentAmount: 150,
      repaymentCount: 2,
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('saves manual matches and inserts one row per expense', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await manualMatchingService.saveManualMatch({
      repaymentTxnId: 'rep-77',
      repaymentVendor: 'bank',
      repaymentDate: '2026-02-12',
      repaymentAmount: -102,
      cardNumber: '9999',
      ccVendor: 'max',
      tolerance: 5,
      expenses: [
        { identifier: 'e1', vendor: 'max', date: '2026-02-01', price: -50 },
        { identifier: 'e2', vendor: 'max', date: '2026-02-02', price: -50 },
      ],
    });

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(String(queryMock.mock.calls[0][0])).toContain('WHERE expense_txn_id IN ($1, $2)');
    expect(queryMock.mock.calls[0][1]).toEqual(['e1', 'e2', 'max']);
    expect(String(queryMock.mock.calls[1][0])).toContain('INSERT INTO credit_card_expense_matches');
    expect(queryMock.mock.calls[1][1][11]).toContain('Difference: ₪2.00');
    expect(result).toEqual({
      success: true,
      matchCount: 2,
      difference: 2,
      repaymentAmount: 102,
      expenseSum: 100,
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rejects saveManualMatch when amount difference exceeds capped tolerance', async () => {
    await expect(
      manualMatchingService.saveManualMatch({
        repaymentTxnId: 'rep-1',
        repaymentVendor: 'bank',
        repaymentDate: '2026-02-12',
        repaymentAmount: -100,
        cardNumber: '9999',
        ccVendor: 'max',
        tolerance: 100,
        expenses: [{ identifier: 'e1', vendor: 'max', date: '2026-02-01', price: -40 }],
      }),
    ).rejects.toThrow('within ₪50.00 tolerance');

    expect(queryMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('rejects saveManualMatch when one or more expenses are already matched', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ expense_txn_id: 'e1' }],
    });

    await expect(
      manualMatchingService.saveManualMatch({
        repaymentTxnId: 'rep-2',
        repaymentVendor: 'bank',
        repaymentDate: '2026-02-12',
        repaymentAmount: -100,
        cardNumber: '9999',
        ccVendor: 'max',
        expenses: [{ identifier: 'e1', vendor: 'max', date: '2026-02-01', price: -100 }],
      }),
    ).rejects.toThrow('Some expenses are already matched: e1');

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns matching statistics with computed percentage', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          total_repayments: '4',
          matched_count: '2',
          partial_count: '1',
          unmatched_count: '1',
          total_amount: '1000',
          matched_amount: '600',
          unmatched_amount: '400',
        },
      ],
    });

    const result = await manualMatchingService.getMatchingStats({
      bankVendor: 'hapoalim',
      bankAccountNumber: '123',
      matchPatterns: ['visa'],
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0][0])).toContain('t.name LIKE $4');
    expect(queryMock.mock.calls[0][1]).toEqual([
      'hapoalim',
      '123',
      'פרעון כרטיס אשראי',
      '%visa%',
    ]);
    expect(result).toEqual({
      totalRepayments: 4,
      matchedCount: 2,
      partialCount: 1,
      unmatchedCount: 1,
      totalAmount: 1000,
      matchedAmount: 600,
      unmatchedAmount: 400,
      matchPercentage: 60,
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('finds matching expense combinations and returns sorted unique results', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'exp-40',
          vendor: 'max',
          date: '2026-01-01',
          name: 'Forty',
          price: '-40',
          account_number: '9999',
          category_definition_id: 1,
          category_name: 'Food',
          processed_date: null,
          is_matched: 0,
        },
        {
          identifier: 'exp-60',
          vendor: 'max',
          date: '2026-01-02',
          name: 'Sixty',
          price: '-60',
          account_number: '9999',
          category_definition_id: 1,
          category_name: 'Food',
          processed_date: null,
          is_matched: 0,
        },
        {
          identifier: 'exp-100',
          vendor: 'max',
          date: '2026-01-03',
          name: 'Hundred',
          price: '-100',
          account_number: '9999',
          category_definition_id: 1,
          category_name: 'Food',
          processed_date: null,
          is_matched: 0,
        },
      ],
    });

    const combinations = await manualMatchingService.findMatchingCombinations({
      repaymentTxnId: 'rep-x',
      repaymentDate: '2026-01-04',
      repaymentAmount: -100,
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
      tolerance: 0,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(combinations).toHaveLength(2);
    expect(combinations[0]).toMatchObject({
      totalAmount: 100,
      difference: 0,
      count: 1,
    });
    expect(combinations[1]).toMatchObject({
      totalAmount: 100,
      difference: 0,
      count: 2,
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns no combinations when no expenses are available', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const combinations = await manualMatchingService.findMatchingCombinations({
      repaymentTxnId: 'rep-empty',
      repaymentDate: '2026-01-04',
      repaymentAmount: -100,
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
    });

    expect(combinations).toEqual([]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('stops exact-match search once enough combinations are found', async () => {
    queryMock.mockResolvedValueOnce({ rows: buildExpenseRows(20, 1) });

    const combinations = await manualMatchingService.findMatchingCombinations({
      repaymentTxnId: 'rep-exact-cap',
      repaymentDate: '2026-01-04',
      repaymentAmount: -10,
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
      tolerance: 0,
    });

    expect(combinations.length).toBe(20);
    expect(combinations.every((c: any) => c.difference === 0)).toBe(true);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('stops fuzzy search when result cap is reached and keeps results sorted by difference', async () => {
    queryMock.mockResolvedValueOnce({ rows: buildExpenseRows(20, 1) });

    const combinations = await manualMatchingService.findMatchingCombinations({
      repaymentTxnId: 'rep-fuzzy-cap',
      repaymentDate: '2026-01-04',
      repaymentAmount: -100,
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
      tolerance: 100,
    });

    expect(combinations.length).toBe(20);
    for (let i = 1; i < combinations.length; i += 1) {
      expect(combinations[i].difference).toBeGreaterThanOrEqual(combinations[i - 1].difference);
    }
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('stops combination search by max-iteration guard when no exact sum exists', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    queryMock.mockResolvedValueOnce({ rows: buildExpenseRows(25, 1) });

    const combinations = await manualMatchingService.findMatchingCombinations({
      repaymentTxnId: 'rep-iter-guard',
      repaymentDate: '2026-01-04',
      repaymentAmount: -12.5,
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
      tolerance: 0,
    });

    expect(combinations).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('Combination search stopped after 50000 iterations');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('stops combination search by timeout guard when runtime threshold is exceeded', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(0);
    nowSpy.mockReturnValue(6001);
    queryMock.mockResolvedValueOnce({ rows: buildExpenseRows(5, 10) });

    const combinations = await manualMatchingService.findMatchingCombinations({
      repaymentTxnId: 'rep-timeout-guard',
      repaymentDate: '2026-01-04',
      repaymentAmount: -50,
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
      tolerance: 0,
    });

    expect(combinations).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('Combination search timed out after 5 seconds');
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('returns no combinations when pruning determines target cannot be reached', async () => {
    queryMock.mockResolvedValueOnce({ rows: buildExpenseRows(3, 1) });

    const combinations = await manualMatchingService.findMatchingCombinations({
      repaymentTxnId: 'rep-prune',
      repaymentDate: '2026-01-04',
      repaymentAmount: -100,
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
      tolerance: 0,
      maxCombinationSize: 2,
    });

    expect(combinations).toEqual([]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('builds weekly matching stats from repayments and matched expense state', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'rep-1',
            vendor: 'leumi',
            date: '2026-01-03T00:00:00.000Z',
            name: 'Repayment',
            price: '-100',
            account_number: '123',
            matched_amount: '40',
            remaining_amount: '60',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'exp-a',
            vendor: 'max',
            date: '2025-12-29',
            name: 'A',
            price: '-20',
            account_number: '9999',
            category_definition_id: 1,
            category_name: 'Food',
            processed_date: null,
            is_matched: 1,
          },
          {
            identifier: 'exp-b',
            vendor: 'max',
            date: '2025-12-28',
            name: 'B',
            price: '-30',
            account_number: '9999',
            category_definition_id: 1,
            category_name: 'Food',
            processed_date: null,
            is_matched: 0,
          },
        ],
      });

    const weekly = await manualMatchingService.getWeeklyMatchingStats({
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
      bankVendor: 'leumi',
      bankAccountNumber: '123',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(weekly).toHaveLength(2);
    expect(weekly[0].bank).toEqual({
      total: 1,
      matched: 0,
      unmatched: 1,
    });
    expect(weekly[0].cc).toEqual({
      total: 2,
      matched: 1,
      unmatched: 1,
    });
    expect(weekly[1].bank.total).toBe(0);
    expect(weekly[1].cc.total).toBe(0);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('uses weekly defaults and pattern filters, and marks fully matched bank repayments', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-12T00:00:00.000Z'));
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'rep-fully-matched',
            vendor: 'leumi',
            date: '2026-02-10T00:00:00.000Z',
            name: 'Repayment',
            price: '-100',
            account_number: '123',
            matched_amount: '99',
            remaining_amount: '1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const weekly = await manualMatchingService.getWeeklyMatchingStats({
      creditCardAccountNumber: '9999',
      creditCardVendor: 'max',
      bankVendor: 'leumi',
      bankAccountNumber: '123',
      matchPatterns: ['Visa', 'Master'],
      endDate: '2026-02-12',
    });

    const [repaymentSql, repaymentParams] = queryMock.mock.calls[0];
    expect(String(repaymentSql)).toContain('t.name LIKE $6');
    expect(String(repaymentSql)).toContain('t.name LIKE $7');
    expect(repaymentParams).toEqual([
      'leumi',
      '123',
      'פרעון כרטיס אשראי',
      '2025-11-20T00:00:00.000Z',
      '2026-02-12T00:00:00.000Z',
      '%Visa%',
      '%Master%',
    ]);

    const matchingWeek = weekly.find((w: any) => w.bank.total === 1);
    expect(matchingWeek.bank).toEqual({
      total: 1,
      matched: 1,
      unmatched: 0,
    });
    expect(releaseMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
