import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let pikadonModule: any;

beforeAll(async () => {
  pikadonModule = await import('../investments/pikadon.js');
});

beforeEach(() => {
  queryMock.mockReset();
  pikadonModule.__setDatabase({ query: queryMock });
});

afterEach(() => {
  pikadonModule.__resetDatabase();
});

describe('pikadon service', () => {
  it('creates a new pikadon entry and returns parsed values', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 55,
            account_id: 7,
            current_value: '1000',
            cost_basis: '1000',
            as_of_date: '2025-01-01',
            holding_type: 'pikadon',
            status: 'active',
          },
        ],
      });

    const payload = {
      account_id: 7,
      cost_basis: 1000,
      as_of_date: '2025-01-01',
      maturity_date: '2026-01-01',
      interest_rate: 3.25,
      notes: 'First deposit',
    };

    const result = await pikadonModule.createPikadon(payload);

    expect(queryMock).toHaveBeenCalledTimes(2);
    const insertArgs = queryMock.mock.calls[1][1];
    expect(insertArgs).toEqual([
      7,
      1000,
      1000,
      '2025-01-01',
      null,
      null,
      '2026-01-01',
      3.25,
      'First deposit',
      null,
    ]);
    expect(result.pikadon).toMatchObject({
      id: 55,
      account_id: 7,
      current_value: 1000,
      cost_basis: 1000,
      status: 'active',
    });
  });

  it('lists pikadon holdings with linked transactions when requested', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 99,
            holding_type: 'pikadon',
            account_id: 15,
            account_name: 'Term Savings',
            account_type: 'bank',
            institution: 'Leumi',
            currency: 'ILS',
            deposit_transaction_id: 'dep-1',
            deposit_transaction_vendor: 'leumi',
            return_transaction_id: 'ret-1',
            return_transaction_vendor: 'leumi',
            current_value: '1100',
            cost_basis: '1000',
            interest_rate: '3.5',
            status: 'active',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ identifier: 'dep-1', vendor: 'leumi', name: 'Deposit', price: -1000 }],
      })
      .mockResolvedValueOnce({
        rows: [{ identifier: 'ret-1', vendor: 'leumi', name: 'Return', price: 1100 }],
      });

    const result = await pikadonModule.listPikadon({ includeTransactions: true });

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(result.pikadon).toHaveLength(1);
    const holding = result.pikadon[0];
    expect(holding.current_value).toBe(1100);
    expect(holding.cost_basis).toBe(1000);
    expect(holding.interest_rate).toBe(3.5);
    expect(holding.deposit_transaction).toEqual({
      identifier: 'dep-1',
      vendor: 'leumi',
      name: 'Deposit',
      price: -1000,
    });
    expect(holding.return_transaction).toEqual({
      identifier: 'ret-1',
      vendor: 'leumi',
      name: 'Return',
      price: 1100,
    });
  });

  it('detects pikadon deposit and return pairs, skipping linked transactions', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'dep-1',
            vendor: 'bank-a',
            date: '2024-01-01',
            name: 'פיקדון חדש',
            memo: '',
            price: '-1000',
            account_number: '123',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'ret-1',
            vendor: 'bank-a',
            date: '2024-06-01',
            name: 'פיקדון החזר',
            memo: '',
            price: '1080',
            account_number: '123',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await pikadonModule.detectPikadonPairs({});

    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(result.suggestions).toHaveLength(1);
    const suggestion = result.suggestions[0];
    expect(suggestion.deposit_amount).toBe(1000);
    expect(suggestion.best_match).toMatchObject({
      return_amount: 1080,
      interest_earned: 80,
    });
    expect(result.unmatched_deposits).toBe(1);
    expect(result.unmatched_returns).toBe(0);
  });

  it('computes interest income summary with filters applied', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          principal: '5000',
          total_return: '5150',
          interest_earned: '150',
          deposit_date: '2024-01-01',
          maturity_date: '2024-06-01',
          account_name: 'Savings',
          return_transaction_id: 'ret-1',
          return_transaction_vendor: 'bank-a',
        },
        {
          id: 2,
          principal: '3000',
          total_return: '3060',
          interest_earned: '60',
          deposit_date: '2024-02-01',
          maturity_date: '2024-07-01',
          account_name: 'Savings',
          return_transaction_id: 'ret-2',
          return_transaction_vendor: 'bank-b',
        },
      ],
    });

    const result = await pikadonModule.getPikadonInterestIncome({
      startDate: '2024-05-01',
      endDate: '2024-07-31',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual(['2024-05-01', '2024-07-31']);
    expect(result.matured_pikadon).toEqual([
      expect.objectContaining({ id: 1, principal: 5000, total_return: 5150, interest_earned: 150 }),
      expect.objectContaining({ id: 2, principal: 3000, total_return: 3060, interest_earned: 60 }),
    ]);
    expect(result.total_interest_earned).toBe(210);
    expect(result.count).toBe(2);
  });

  it('rolls over a pikadon and links to new entry', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            account_id: 3,
            cost_basis: '1000',
            current_value: '1000',
            holding_type: 'pikadon',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            account_id: 3,
            current_value: '1200',
            cost_basis: '1200',
            as_of_date: '2024-07-15',
          },
        ],
      });

    const payload = {
      return_transaction_id: 'ret-100',
      return_transaction_vendor: 'bank-a',
      return_amount: 1200,
      new_principal: 1200,
      new_maturity_date: '2025-07-15',
      new_interest_rate: 4.2,
      new_deposit_transaction_id: 'dep-200',
      new_deposit_transaction_vendor: 'bank-a',
      new_as_of_date: '2024-07-15',
    };

    const result = await pikadonModule.rolloverPikadon(10, payload);

    expect(queryMock).toHaveBeenCalledTimes(3);
    const updateArgs = queryMock.mock.calls[1][1];
    expect(updateArgs).toEqual([
      'ret-100',
      'bank-a',
      1200,
      10,
    ]);
    const insertArgs = queryMock.mock.calls[2][1];
    expect(insertArgs).toEqual([
      3,
      1200,
      1200,
      '2024-07-15',
      'dep-200',
      'bank-a',
      '2025-07-15',
      4.2,
      10,
    ]);
    expect(result.rollover).toMatchObject({
      old_pikadon_id: 10,
      new_pikadon_id: 11,
      old_principal: 1000,
      interest_earned: 200,
      new_principal: 1200,
      interest_reinvested: 200,
      interest_withdrawn: 0,
    });
  });
});
