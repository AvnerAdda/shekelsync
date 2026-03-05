import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let pairingMatchDetailsService;

beforeAll(async () => {
  const module = await import('../pairing-match-details.js');
  pairingMatchDetailsService = module.default ?? module;
});

function createMockClient(queryImpl = async () => ({ rows: [], rowCount: 0 })) {
  return {
    query: vi.fn(queryImpl),
    release: vi.fn(),
  };
}

describe('pairing match details service', () => {
  const getClientMock = vi.fn();
  const autoPairingMock = {
    calculateDiscrepancy: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    getClientMock.mockReset();
    autoPairingMock.calculateDiscrepancy.mockReset();

    pairingMatchDetailsService.__setDatabase({
      getClient: getClientMock,
    });
    pairingMatchDetailsService.__setDependencies({
      autoPairing: autoPairingMock,
    });
  });

  afterEach(() => {
    pairingMatchDetailsService.__resetDatabase();
    pairingMatchDetailsService.__resetDependencies();
  });

  it('returns 404 when pairing does not exist', async () => {
    const client = createMockClient(async (sql) => {
      if (String(sql).includes('FROM account_pairings')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    await expect(
      pairingMatchDetailsService.getPairingMatchDetails({ pairingId: 999 }),
    ).rejects.toMatchObject({ status: 404, message: 'Pairing not found' });

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(autoPairingMock.calculateDiscrepancy).not.toHaveBeenCalled();
  });

  it('rejects non-strict integer params before opening a DB client', async () => {
    await expect(
      pairingMatchDetailsService.getPairingMatchDetails({ pairingId: '8abc' }),
    ).rejects.toMatchObject({ status: 400, message: 'pairingId must be a positive integer' });

    await expect(
      pairingMatchDetailsService.getPairingMatchDetails({ pairingId: 8, monthsBack: '6abc' }),
    ).rejects.toMatchObject({ status: 400, message: 'monthsBack must be a positive integer' });

    await expect(
      pairingMatchDetailsService.getPairingMatchDetails({ pairingId: 8, monthsBack: 37 }),
    ).rejects.toMatchObject({ status: 400, message: 'monthsBack must be less than or equal to 36' });

    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('derives repayment statuses, card links, and defaults to latest six cycles', async () => {
    const client = createMockClient(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ');

      if (normalized.includes('FROM account_pairings')) {
        return {
          rows: [{
            id: 8,
            credit_card_vendor: 'max',
            credit_card_account_number: '4886',
            bank_vendor: 'discount',
            bank_account_number: '0162490242',
            match_patterns: '["max","4886"]',
            is_active: 1,
            discrepancy_acknowledged: 0,
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
          }],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transaction_pairing_exclusions')) {
        return {
          rows: [
            {
              transaction_identifier: 'r4',
              transaction_vendor: 'discount',
              shared_pairings_count: 2,
              pairing_ids: '8,6',
            },
          ],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transactions t') && normalized.includes('AND t.status = \'completed\'')) {
        return {
          rows: [
            { identifier: 'e1', vendor: 'max', account_number: '4886', date: '2026-02-20T00:00:00.000Z', processed_date: '2026-03-01T00:00:00.000Z', name: 'Expense 1', price: -100, cycle_date: '2026-03-01' },
            { identifier: 'e2', vendor: 'max', account_number: '4886', date: '2026-01-18T00:00:00.000Z', processed_date: '2026-02-01T00:00:00.000Z', name: 'Expense 2', price: -40, cycle_date: '2026-02-01' },
            { identifier: 'e3', vendor: 'max', account_number: '4886', date: '2026-01-10T00:00:00.000Z', processed_date: '2026-01-01T00:00:00.000Z', name: 'Expense 3', price: -100, cycle_date: '2026-01-01' },
            { identifier: 'e4', vendor: 'max', account_number: '4886', date: '2025-12-08T00:00:00.000Z', processed_date: '2025-12-01T00:00:00.000Z', name: 'Expense 4', price: -90, cycle_date: '2025-12-01' },
            { identifier: 'e5', vendor: 'max', account_number: '4886', date: '2025-11-03T00:00:00.000Z', processed_date: '2025-11-01T00:00:00.000Z', name: 'Expense 5', price: -100, cycle_date: '2025-11-01' },
            { identifier: 'e6', vendor: 'max', account_number: '4886', date: '2025-10-03T00:00:00.000Z', processed_date: '2025-10-01T00:00:00.000Z', name: 'Expense 6', price: -100, cycle_date: '2025-10-01' },
          ],
          rowCount: 6,
        };
      }

      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    autoPairingMock.calculateDiscrepancy.mockResolvedValue({
      acknowledged: false,
      method: 'allocated',
      cycles: [
        {
          cycleDate: '2026-03-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r1', vendor: 'discount', accountNumber: '0162490242', date: '2026-03-01T00:00:00.000Z', cycleDate: '2026-03-01', name: 'Repayment 1', price: -100 }],
        },
        {
          cycleDate: '2026-02-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r2', vendor: 'discount', accountNumber: '0162490242', date: '2026-02-01T00:00:00.000Z', cycleDate: '2026-02-01', name: 'Repayment 2', price: -100 }],
        },
        {
          cycleDate: '2026-01-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r3', vendor: 'discount', accountNumber: '0162490242', date: '2026-01-01T00:00:00.000Z', cycleDate: '2026-01-01', name: 'Repayment 3', price: -100 }],
        },
        {
          cycleDate: '2025-12-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r4', vendor: 'discount', accountNumber: '0162490242', date: '2025-12-01T00:00:00.000Z', cycleDate: '2025-12-01', name: 'Repayment 4', price: -100 }],
        },
        {
          cycleDate: '2025-11-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r5', vendor: 'discount', accountNumber: '0162490242', date: '2025-11-01T00:00:00.000Z', cycleDate: '2025-11-01', name: 'Repayment 5', price: -100 }],
        },
        {
          cycleDate: '2025-10-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r6', vendor: 'discount', accountNumber: '0162490242', date: '2025-10-01T00:00:00.000Z', cycleDate: '2025-10-01', name: 'Repayment 6', price: -100 }],
        },
        {
          cycleDate: '2025-09-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r7', vendor: 'discount', accountNumber: '0162490242', date: '2025-09-01T00:00:00.000Z', cycleDate: '2025-09-01', name: 'Repayment 7', price: -100 }],
        },
      ],
    });

    const result = await pairingMatchDetailsService.getPairingMatchDetails({
      pairingId: 8,
      monthsBack: 12,
    });

    expect(result.cycles).toHaveLength(6);

    const repayments = result.cycles.flatMap((cycle) => cycle.repayments);
    expect(repayments.find((repayment) => repayment.identifier === 'r1')?.status).toBe('matched');
    expect(repayments.find((repayment) => repayment.identifier === 'r2')?.status).toBe('unmatched');
    expect(repayments.find((repayment) => repayment.identifier === 'r3')?.status).toBe('matched');
    expect(repayments.find((repayment) => repayment.identifier === 'r4')?.status).toBe('ambiguous');
    expect(repayments.find((repayment) => repayment.identifier === 'r3')?.matchSource).toBe('inferred_amount_cycle');

    const ambiguousCycle = result.cycles.find((cycle) => cycle.cycleDate === '2025-12-01');
    expect(ambiguousCycle?.cycleStatus).toBe('ambiguous');

    const firstCycleCardTxn = result.cycles[0]?.cardTransactions?.[0];
    expect(firstCycleCardTxn).toMatchObject({
      identifier: 'e1',
      linkedRepaymentCount: 1,
      linkedRepaymentIds: ['r1'],
      isLinked: true,
      linkMethod: 'inferred_amount_cycle',
    });

    expect(result.summary.statusCounts).toEqual({
      matched: 4,
      partial: 0,
      unmatched: 1,
      ambiguous: 1,
    });

    expect(autoPairingMock.calculateDiscrepancy).toHaveBeenCalledWith(
      expect.objectContaining({ pairingId: 8, monthsBack: 12 }),
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('auto-matches an ambiguous bundled repayment when cycle sum matches', async () => {
    const client = createMockClient(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ');

      if (normalized.includes('FROM account_pairings')) {
        return {
          rows: [{
            id: 6,
            credit_card_vendor: 'max',
            credit_card_account_number: '6219',
            bank_vendor: 'discount',
            bank_account_number: '0162490242',
            match_patterns: '["max","6219"]',
            is_active: 1,
            discrepancy_acknowledged: 0,
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
          }],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transaction_pairing_exclusions')) {
        return {
          rows: [
            {
              transaction_identifier: 'r_bundle',
              transaction_vendor: 'discount',
              shared_pairings_count: 4,
              pairing_ids: '5,6,7,8',
            },
          ],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transactions t') && normalized.includes('AND t.status = \'completed\'')) {
        return {
          rows: [
            { identifier: 'c1', vendor: 'max', account_number: '6219', date: '2026-01-24T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 1', price: -250, cycle_date: '2026-02-09' },
            { identifier: 'c2', vendor: 'max', account_number: '6219', date: '2026-01-27T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 2', price: -365, cycle_date: '2026-02-09' },
            { identifier: 'c3', vendor: 'max', account_number: '6219', date: '2026-02-01T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 3', price: -800, cycle_date: '2026-02-09' },
          ],
          rowCount: 3,
        };
      }

      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    autoPairingMock.calculateDiscrepancy.mockResolvedValue({
      acknowledged: false,
      method: 'allocated',
      cycles: [
        {
          cycleDate: '2026-02-09',
          bankTotal: 1415,
          ccTotal: 1415,
          difference: 0,
          status: 'matched',
          matchedAccount: '6219',
          repayments: [{ identifier: 'r_bundle', vendor: 'discount', accountNumber: '0162490242', date: '2026-02-09T00:00:00.000Z', cycleDate: '2026-02-09', name: 'Max Charge', price: -1415 }],
        },
      ],
    });

    const result = await pairingMatchDetailsService.getPairingMatchDetails({
      pairingId: 6,
      monthsBack: 12,
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].cycleStatus).toBe('matched');

    const repayment = result.cycles[0].repayments[0];
    expect(repayment).toMatchObject({
      identifier: 'r_bundle',
      status: 'matched',
      matchedAmount: 1415,
      remainingAmount: 0,
      linkedExpenseCount: 3,
      matchSource: 'inferred_amount_cycle',
      sharedPairingsCount: 4,
    });
    expect(repayment.linkedExpenseTxnIds).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));

    for (const cardTxn of result.cycles[0].cardTransactions) {
      expect(cardTxn).toMatchObject({
        linkedRepaymentCount: 1,
        linkedRepaymentIds: ['r_bundle'],
        isLinked: true,
        linkMethod: 'inferred_amount_cycle',
      });
    }

    expect(result.summary.statusCounts).toEqual({
      matched: 1,
      partial: 0,
      unmatched: 0,
      ambiguous: 0,
    });
  });

  it('auto-matches a shared repayment when a unique one-to-one cycle candidate exists', async () => {
    const client = createMockClient(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ');

      if (normalized.includes('FROM account_pairings')) {
        return {
          rows: [{
            id: 6,
            credit_card_vendor: 'max',
            credit_card_account_number: '6219',
            bank_vendor: 'discount',
            bank_account_number: '0162490242',
            match_patterns: '["max","6219"]',
            is_active: 1,
            discrepancy_acknowledged: 0,
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
          }],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transaction_pairing_exclusions')) {
        return {
          rows: [
            {
              transaction_identifier: 'r_shared_single',
              transaction_vendor: 'discount',
              shared_pairings_count: 4,
              pairing_ids: '5,6,7,8',
            },
          ],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transactions t') && normalized.includes('AND t.status = \'completed\'')) {
        return {
          rows: [
            { identifier: 'c_shared', vendor: 'max', account_number: '6219', date: '2025-12-31T00:00:00.000Z', processed_date: '2026-01-03T00:00:00.000Z', name: 'GOOGLE WORKSPACE', price: -206.97, cycle_date: '2026-01-03' },
          ],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    autoPairingMock.calculateDiscrepancy.mockResolvedValue({
      acknowledged: false,
      method: 'allocated',
      cycles: [
        {
          cycleDate: '2026-01-03',
          bankTotal: 206.97,
          ccTotal: 206.97,
          difference: 0,
          status: 'matched',
          matchedAccount: '6219',
          repayments: [{ identifier: 'r_shared_single', vendor: 'discount', accountNumber: '0162490242', date: '2026-01-03T00:00:00.000Z', cycleDate: '2026-01-03', name: 'מקס איט פי חיוב', price: -206.97 }],
        },
      ],
    });

    const result = await pairingMatchDetailsService.getPairingMatchDetails({
      pairingId: 6,
      monthsBack: 12,
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].cycleStatus).toBe('matched');

    const repayment = result.cycles[0].repayments[0];
    expect(repayment).toMatchObject({
      identifier: 'r_shared_single',
      status: 'matched',
      matchedAmount: 206.97,
      remainingAmount: 0,
      linkedExpenseCount: 1,
      linkedExpenseTxnIds: ['c_shared'],
      matchSource: 'inferred_amount_cycle',
      sharedPairingsCount: 4,
    });

    expect(result.cycles[0].cardTransactions[0]).toMatchObject({
      identifier: 'c_shared',
      linkedRepaymentCount: 1,
      linkedRepaymentIds: ['r_shared_single'],
      isLinked: true,
      linkMethod: 'inferred_amount_cycle',
    });

    expect(result.summary.statusCounts).toEqual({
      matched: 1,
      partial: 0,
      unmatched: 0,
      ambiguous: 0,
    });
  });

  it('auto-matches a single unmatched bundled repayment when cycle sum matches', async () => {
    const client = createMockClient(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ');

      if (normalized.includes('FROM account_pairings')) {
        return {
          rows: [{
            id: 5,
            credit_card_vendor: 'max',
            credit_card_account_number: '4886',
            bank_vendor: 'discount',
            bank_account_number: '0162490242',
            match_patterns: '["מקס","max","4886"]',
            is_active: 1,
            discrepancy_acknowledged: 0,
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
          }],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transaction_pairing_exclusions')) {
        return {
          rows: [
            {
              transaction_identifier: 'r_single',
              transaction_vendor: 'discount',
              shared_pairings_count: 1,
              pairing_ids: '5',
            },
          ],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transactions t') && normalized.includes('AND t.status = \'completed\'')) {
        return {
          rows: [
            { identifier: 'u1', vendor: 'max', account_number: '4886', date: '2026-02-07T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 1', price: -1178.68, cycle_date: '2026-02-09' },
            { identifier: 'u2', vendor: 'max', account_number: '4886', date: '2026-02-05T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 2', price: -300, cycle_date: '2026-02-09' },
            { identifier: 'u3', vendor: 'max', account_number: '4886', date: '2026-02-04T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 3', price: -270, cycle_date: '2026-02-09' },
            { identifier: 'u4', vendor: 'max', account_number: '4886', date: '2026-02-03T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 4', price: -243.85, cycle_date: '2026-02-09' },
            { identifier: 'u5', vendor: 'max', account_number: '4886', date: '2026-02-02T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 5', price: -186.15, cycle_date: '2026-02-09' },
            { identifier: 'u6', vendor: 'max', account_number: '4886', date: '2026-02-01T00:00:00.000Z', processed_date: '2026-02-09T00:00:00.000Z', name: 'Txn 6', price: -2000, cycle_date: '2026-02-09' },
          ],
          rowCount: 6,
        };
      }

      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    autoPairingMock.calculateDiscrepancy.mockResolvedValue({
      acknowledged: false,
      method: 'allocated',
      cycles: [
        {
          cycleDate: '2026-02-09',
          bankTotal: 4178.68,
          ccTotal: 4178.68,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r_single', vendor: 'discount', accountNumber: '0162490242', date: '2026-02-09T00:00:00.000Z', cycleDate: '2026-02-09', name: 'חיוב לכרטיס ויזה 4886', price: -4178.68 }],
        },
      ],
    });

    const result = await pairingMatchDetailsService.getPairingMatchDetails({
      pairingId: 5,
      monthsBack: 12,
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].cycleStatus).toBe('matched');

    const repayment = result.cycles[0].repayments[0];
    expect(repayment).toMatchObject({
      identifier: 'r_single',
      status: 'matched',
      matchedAmount: 4178.68,
      remainingAmount: 0,
      linkedExpenseCount: 6,
      matchSource: 'inferred_amount_cycle',
      sharedPairingsCount: 1,
    });
    expect(repayment.linkedExpenseTxnIds).toEqual(expect.arrayContaining(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']));

    for (const cardTxn of result.cycles[0].cardTransactions) {
      expect(cardTxn).toMatchObject({
        linkedRepaymentCount: 1,
        linkedRepaymentIds: ['r_single'],
        isLinked: true,
        linkMethod: 'inferred_amount_cycle',
      });
    }
  });

  it('filters cycles by cycleDate when provided', async () => {
    const client = createMockClient(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ');

      if (normalized.includes('FROM account_pairings')) {
        return {
          rows: [{
            id: 8,
            credit_card_vendor: 'max',
            credit_card_account_number: '4886',
            bank_vendor: 'discount',
            bank_account_number: '0162490242',
            match_patterns: '["max","4886"]',
            is_active: 1,
            discrepancy_acknowledged: 0,
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
          }],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transactions t') && normalized.includes('AND t.status = \'completed\'')) {
        return {
          rows: [
            {
              identifier: 'e2',
              vendor: 'max',
              account_number: '4886',
              date: '2026-01-18T00:00:00.000Z',
              processed_date: '2026-02-01T00:00:00.000Z',
              name: 'Expense 2',
              price: -100,
              cycle_date: '2026-02-01',
            },
          ],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    autoPairingMock.calculateDiscrepancy.mockResolvedValue({
      cycles: [
        {
          cycleDate: '2026-03-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r1', vendor: 'discount', accountNumber: '0162490242', date: '2026-03-01T00:00:00.000Z', cycleDate: '2026-03-01', name: 'Repayment 1', price: -100 }],
        },
        {
          cycleDate: '2026-02-01',
          bankTotal: 100,
          ccTotal: 100,
          difference: 0,
          status: 'matched',
          matchedAccount: '4886',
          repayments: [{ identifier: 'r2', vendor: 'discount', accountNumber: '0162490242', date: '2026-02-01T00:00:00.000Z', cycleDate: '2026-02-01', name: 'Repayment 2', price: -100 }],
        },
      ],
    });

    const result = await pairingMatchDetailsService.getPairingMatchDetails({
      pairingId: 8,
      cycleDate: '2026-02-01',
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].cycleDate).toBe('2026-02-01');
    expect(result.summary.cyclesCount).toBe(1);
  });

  it('includes provisional totals with pending card transactions', async () => {
    const client = createMockClient(async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ');

      if (normalized.includes('FROM account_pairings')) {
        return {
          rows: [{
            id: 5,
            credit_card_vendor: 'max',
            credit_card_account_number: '9144',
            bank_vendor: 'discount',
            bank_account_number: '0162490242',
            match_patterns: '["max","9144"]',
            is_active: 1,
            discrepancy_acknowledged: 0,
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
          }],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transactions t') && normalized.includes('AND t.status = \'completed\'')) {
        return {
          rows: [
            {
              identifier: 'c1',
              vendor: 'max',
              account_number: '9144',
              date: '2026-02-10T00:00:00.000Z',
              processed_date: '2026-03-01T00:00:00.000Z',
              name: 'Txn',
              price: -770.88,
              cycle_date: '2026-03-01',
            },
          ],
          rowCount: 1,
        };
      }

      if (normalized.includes('FROM transactions t') && normalized.includes('AND t.status = \'pending\'')) {
        return {
          rows: [
            { identifier: 'p1', txn_date: '2026-02-23', hinted_cycle_date: '2026-02-23', price: -160 },
            { identifier: 'p2', txn_date: '2026-02-26', hinted_cycle_date: '2026-02-26', price: -62.13 },
            { identifier: 'p3', txn_date: '2026-02-27', hinted_cycle_date: '2026-02-27', price: -21.8 },
            { identifier: 'p4', txn_date: '2026-02-27', hinted_cycle_date: '2026-02-27', price: -33.8 },
            { identifier: 'p5', txn_date: '2026-02-27', hinted_cycle_date: '2026-02-27', price: -40 },
            { identifier: 'p6', txn_date: '2026-03-01', hinted_cycle_date: '2026-03-01', price: -100 },
          ],
          rowCount: 6,
        };
      }

      return { rows: [], rowCount: 0 };
    });
    getClientMock.mockResolvedValue(client);

    autoPairingMock.calculateDiscrepancy.mockResolvedValue({
      acknowledged: false,
      method: 'allocated',
      cycles: [
        {
          cycleDate: '2026-03-01',
          bankTotal: 1403.61,
          ccTotal: 770.88,
          difference: 632.73,
          status: 'incomplete_history',
          matchedAccount: '9144',
          repayments: [{ identifier: 'r1', vendor: 'discount', accountNumber: '0162490242', date: '2026-03-01T00:00:00.000Z', cycleDate: '2026-03-01', name: 'Repayment', price: -1403.61 }],
        },
      ],
    });

    const result = await pairingMatchDetailsService.getPairingMatchDetails({
      pairingId: 5,
      monthsBack: 12,
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toMatchObject({
      cycleDate: '2026-03-01',
      pendingCardDelta: 417.73,
      pendingTransactionCount: 6,
      provisionalCardTotal: 1188.61,
      provisionalDifference: 215,
    });
  });
});
