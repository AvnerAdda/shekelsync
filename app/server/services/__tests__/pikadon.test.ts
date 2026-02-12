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

  it('returns summary metrics and upcoming maturities', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            total_count: '3',
            active_count: '2',
            matured_count: '1',
            rolled_over_count: '0',
            active_principal: '2000',
            total_principal: '3000',
            total_interest_earned: '140',
            avg_interest_rate: '3.5',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 77,
            account_id: 5,
            account_name: 'Deposit Account',
            cost_basis: '1000',
            current_value: '1070',
            maturity_date: '2026-03-01',
          },
        ],
      });

    const result = await pikadonModule.getPikadonSummary();

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(result.summary).toEqual({
      total_count: 3,
      active_count: 2,
      matured_count: 1,
      rolled_over_count: 0,
      active_principal: 2000,
      total_principal: 3000,
      total_interest_earned: 140,
      avg_interest_rate: 3.5,
    });
    expect(result.upcoming_maturities[0]).toMatchObject({
      id: 77,
      cost_basis: 1000,
      current_value: 1070,
    });
  });

  it('links return transactions and supports status updates and deletion', async () => {
    await expect(pikadonModule.linkReturnTransaction(1, {})).rejects.toMatchObject({ status: 400 });

    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      pikadonModule.linkReturnTransaction(999, {
        return_transaction_id: 'ret-404',
        return_transaction_vendor: 'bank',
        return_amount: 100,
      }),
    ).rejects.toMatchObject({ status: 404 });

    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 2, cost_basis: '1000' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 2, cost_basis: '1000', current_value: '1080', status: 'matured' }],
      });

    const linked = await pikadonModule.linkReturnTransaction(2, {
      return_transaction_id: 'ret-ok',
      return_transaction_vendor: 'bank',
      return_amount: 1080,
    });
    expect(linked.pikadon.interest_earned).toBe(80);

    await expect(pikadonModule.updatePikadonStatus(2, 'invalid')).rejects.toMatchObject({ status: 400 });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(pikadonModule.updatePikadonStatus(2, 'active')).rejects.toMatchObject({ status: 404 });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 2, current_value: '1080', cost_basis: '1000', status: 'active' }],
    });
    const updated = await pikadonModule.updatePikadonStatus(2, 'active');
    expect(updated.pikadon.interest_earned).toBe(80);

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(pikadonModule.deletePikadon(2)).rejects.toMatchObject({ status: 404 });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [{ id: 2, holding_type: 'pikadon' }] });
    const deleted = await pikadonModule.deletePikadon(2);
    expect(deleted).toMatchObject({ message: 'Pikadon deleted' });
  });

  it('builds rollover chain and maturity breakdown analytics', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 2, parent_pikadon_id: 1, current_value: '110', cost_basis: '100' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1, parent_pikadon_id: null, current_value: '105', cost_basis: '100' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 3, parent_pikadon_id: 2, current_value: '120', cost_basis: '110' }],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const chain = await pikadonModule.getRolloverChain(2);

    expect(chain.chain).toHaveLength(3);
    expect(chain.chain[1].is_current).toBe(true);
    expect(chain.summary).toMatchObject({
      chain_length: 3,
      original_principal: 100,
      current_principal: 110,
      total_interest_earned: 25,
      principal_growth: 10,
    });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          principal: '1000',
          total_return: '1100',
          interest_earned: '100',
          deposit_date: '2025-01-01',
          maturity_date: '2026-01-01',
          status: 'rolled_over',
          account_name: 'A',
          institution: 'Bank',
          child_pikadon_id: 11,
          child_principal: '1050',
          child_deposit_date: '2026-01-01',
        },
        {
          id: 12,
          principal: '800',
          total_return: '860',
          interest_earned: '60',
          deposit_date: '2025-02-01',
          maturity_date: '2026-02-01',
          status: 'matured',
          account_name: 'B',
          institution: 'Bank',
          child_pikadon_id: null,
          child_principal: null,
          child_deposit_date: null,
        },
      ],
    });

    const breakdown = await pikadonModule.getPikadonMaturityBreakdown({
      startDate: '2026-01-01',
      endDate: '2026-03-01',
    });

    expect(queryMock.mock.calls[0][1]).toEqual(['2026-01-01', '2026-03-01']);
    expect(breakdown.maturities[0]).toMatchObject({
      is_rolled_over: true,
      principal_returned: 1000,
      interest_reinvested: 50,
      interest_withdrawn: 50,
    });
    expect(breakdown.maturities[1]).toMatchObject({
      is_rolled_over: false,
      interest_withdrawn: 60,
    });
    expect(breakdown.totals).toMatchObject({
      total_principal_returned: 1800,
      total_interest_earned: 160,
      total_return: 1960,
      total_new_deposits: 1050,
      total_interest_reinvested: 50,
      total_interest_withdrawn: 110,
      count: 2,
    });
  });

  it('auto-detects maturity events, chains, and active deposits', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'dep-start',
          vendor: 'bank-a',
          date: '2026-01-01',
          name: 'הפקדה לפיקדון',
          price: '-1000',
          account_number: '123',
        },
        {
          identifier: 'return-principal',
          vendor: 'bank-a',
          date: '2026-06-01',
          name: 'פירעון פיקדון',
          price: '1000',
          account_number: '123',
        },
        {
          identifier: 'return-interest',
          vendor: 'bank-a',
          date: '2026-06-01',
          name: 'רווח מפיקדון',
          price: '80',
          account_number: '123',
        },
        {
          identifier: 'return-tax',
          vendor: 'bank-a',
          date: '2026-06-01',
          name: 'ניכוי מס פיקדון',
          price: '-10',
          account_number: '123',
        },
        {
          identifier: 'dep-roll',
          vendor: 'bank-a',
          date: '2026-06-01',
          name: 'הפקדה לפיקדון נזיל',
          price: '-1050',
          account_number: '123',
        },
        {
          identifier: 'dep-standalone',
          vendor: 'bank-a',
          date: '2026-07-01',
          name: 'הפקדה לפיקדון קבועה',
          price: '-500',
          account_number: '123',
        },
      ],
    });

    const result = await pikadonModule.autoDetectPikadonEvents({
      startDate: '2026-01-01',
      endDate: '2026-07-31',
      vendor: 'bank-a',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(result.maturity_events).toHaveLength(1);
    expect(result.maturity_events[0]).toMatchObject({
      principal_returned: 1000,
      interest_earned: 80,
      tax_paid: 10,
      net_received: 1070,
      rolled_over: true,
      new_deposit_amount: 1050,
      cash_flow: 20,
    });
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]).toMatchObject({
      net_gain: 70,
    });
    expect(result.active_deposits).toHaveLength(2);
    expect(result.totals).toMatchObject({
      total_interest_earned: 80,
      total_tax_paid: 10,
      total_principal_returned: 1000,
      maturity_count: 1,
      total_active_principal: 1550,
    });
  });

  it('auto-setup validates account id and returns no-op when no pikadon transactions are found', async () => {
    await expect(pikadonModule.autoSetupPikadon()).rejects.toMatchObject({ status: 400 });

    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 5, account_name: 'Bank Account' }],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    const result = await pikadonModule.autoSetupPikadon(5, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    expect(result).toEqual({
      created: 0,
      message: 'No pikadon transactions found to setup',
    });
  });

  it('auto-setup fails when target account does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await expect(pikadonModule.autoSetupPikadon(999)).rejects.toMatchObject({ status: 404 });
  });

  it('auto-setup creates matured/rollover/standalone holdings, income entry, and marks source transactions', async () => {
    let holdingInsertCount = 0;

    queryMock.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.includes('SELECT id, account_name FROM investment_accounts WHERE id = $1')) {
        return { rows: [{ id: 10, account_name: 'Main Bank' }] };
      }

      if (sql.includes('FROM transactions t') && sql.includes('WHERE (LOWER(t.name) LIKE $1')) {
        return {
          rows: [
            {
              identifier: 'dep-start',
              vendor: 'bank-a',
              date: '2026-01-01',
              name: 'הפקדה לפיקדון',
              price: '-1000',
              account_number: '123',
            },
            {
              identifier: 'return-principal',
              vendor: 'bank-a',
              date: '2026-06-01',
              name: 'פירעון פיקדון',
              price: '1000',
              account_number: '123',
            },
            {
              identifier: 'return-interest',
              vendor: 'bank-a',
              date: '2026-06-01',
              name: 'רווח מפיקדון',
              price: '80',
              account_number: '123',
            },
            {
              identifier: 'return-tax',
              vendor: 'bank-a',
              date: '2026-06-01',
              name: 'ניכוי מס פיקדון',
              price: '-10',
              account_number: '123',
            },
            {
              identifier: 'dep-roll',
              vendor: 'bank-a',
              date: '2026-06-01',
              name: 'הפקדה לפיקדון נזיל',
              price: '-1050',
              account_number: '123',
            },
            {
              identifier: 'dep-standalone',
              vendor: 'bank-a',
              date: '2026-07-01',
              name: 'הפקדה לפיקדון קבועה',
              price: '-500',
              account_number: '123',
            },
          ],
        };
      }

      if (sql.includes('INSERT INTO investment_holdings') && sql.includes('RETURNING id')) {
        holdingInsertCount += 1;
        return { rows: [{ id: 500 + holdingInsertCount }] };
      }

      if (sql.includes('UPDATE investment_holdings') && sql.includes('SET') && sql.includes('interest_rate = $3')) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("SELECT id FROM category_definitions WHERE name = 'ריבית מהשקעות'")) {
        return { rows: [{ id: 77 }] };
      }

      if (sql.includes('INSERT INTO transactions') && sql.includes('category_type')) {
        expect(String(params[0])).toContain('pikadon_interest_');
        expect(params[4]).toBe(70);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('UPDATE transactions SET is_pikadon_related = 1')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected auto-setup query: ${sql}`);
    });

    const result = await pikadonModule.autoSetupPikadon(10, {
      startDate: '2026-01-01',
      endDate: '2026-08-01',
      vendor: 'bank-a',
    });

    expect(result.created).toBe(3);
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'matured', id: 501 }),
        expect.objectContaining({ type: 'active_rollover', id: 502, parent_id: 501 }),
        expect.objectContaining({ type: 'active_standalone', id: 503 }),
      ]),
    );
    expect(result.interest_income_created).toHaveLength(1);
    expect(result.interest_income_created[0]).toMatchObject({
      amount: 70,
      gross_interest: 80,
      tax_paid: 10,
    });
    expect(result.totals).toMatchObject({
      maturity_count: 1,
      total_interest_earned: 80,
      total_tax_paid: 10,
      total_active_principal: 1550,
    });
    expect(result.transactions_marked).toBe(7);

    const markCalls = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE transactions SET is_pikadon_related = 1'),
    );
    expect(markCalls).toHaveLength(7);
  });

  it('listPikadon applies filters and does not fetch linked txns when ids are missing', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          account_id: 42,
          holding_type: 'pikadon',
          status: 'active',
          current_value: null,
          cost_basis: null,
          interest_rate: null,
          deposit_transaction_id: null,
          deposit_transaction_vendor: null,
          return_transaction_id: null,
          return_transaction_vendor: null,
        },
      ],
    });

    const result = await pikadonModule.listPikadon({
      accountId: 42,
      status: 'active',
      includeTransactions: true,
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([42, 'active']);
    expect(result.pikadon[0]).toMatchObject({
      current_value: null,
      cost_basis: null,
      interest_rate: null,
      interest_earned: 0,
      deposit_transaction: null,
      return_transaction: null,
    });
  });

  it('createPikadon validates required fields and parent pikadon references', async () => {
    await expect(pikadonModule.createPikadon({})).rejects.toMatchObject({ status: 400 });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      pikadonModule.createPikadon({
        account_id: 7,
        cost_basis: 1000,
        as_of_date: '2025-01-01',
      }),
    ).rejects.toMatchObject({ status: 404, message: 'Account not found' });

    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      pikadonModule.createPikadon({
        account_id: 7,
        cost_basis: 1000,
        as_of_date: '2025-01-01',
        parent_pikadon_id: 123,
      }),
    ).rejects.toMatchObject({ status: 404, message: 'Parent pikadon not found' });
  });

  it('createPikadon marks parent as rolled_over when creating a rollover child', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ id: 12, status: 'matured' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 13,
            account_id: 7,
            current_value: '1250',
            cost_basis: '1250',
            status: 'active',
          },
        ],
      });

    const result = await pikadonModule.createPikadon({
      account_id: 7,
      cost_basis: 1250,
      as_of_date: '2025-05-01',
      parent_pikadon_id: 12,
    });

    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(queryMock.mock.calls[2][1]).toEqual(['rolled_over', 12]);
    expect(result.pikadon).toMatchObject({
      id: 13,
      account_id: 7,
      current_value: 1250,
      cost_basis: 1250,
      interest_earned: 0,
    });
  });

  it('detects rollover suggestions, orphan returns, and keeps SQL filters in place', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'dep-linked',
            vendor: 'bank-a',
            date: '2025-01-01',
            name: 'פיקדון',
            memo: '',
            price: '-1000',
            account_number: '001',
          },
          {
            identifier: 'dep-1',
            vendor: 'bank-a',
            date: '2025-01-10',
            name: 'פיקדון חדש',
            memo: '',
            price: '-1000',
            account_number: '123',
          },
          {
            identifier: 'dep-2',
            vendor: 'bank-a',
            date: '2025-06-02',
            name: 'הפקדה פיקדון',
            memo: '',
            price: '-1030',
            account_number: '123',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            identifier: 'ret-linked',
            vendor: 'bank-a',
            date: '2025-03-01',
            name: 'פיקדון החזר',
            memo: '',
            price: '1040',
            account_number: '001',
          },
          {
            identifier: 'ret-1',
            vendor: 'bank-a',
            date: '2025-06-01',
            name: 'פיקדון החזר',
            memo: '',
            price: '1080',
            account_number: '123',
          },
          {
            identifier: 'ret-orphan',
            vendor: 'bank-a',
            date: '2024-01-01',
            name: 'פיקדון החזר',
            memo: '',
            price: '700',
            account_number: '999',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ deposit_transaction_id: 'dep-linked', deposit_transaction_vendor: 'bank-a' }],
      })
      .mockResolvedValueOnce({
        rows: [{ return_transaction_id: 'ret-linked', return_transaction_vendor: 'bank-a' }],
      });

    const result = await pikadonModule.detectPikadonPairs({
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      vendor: 'bank-a',
    });

    expect(queryMock.mock.calls[0][1].slice(-3)).toEqual(['2025-01-01', '2025-12-31', 'bank-a']);
    expect(queryMock.mock.calls[1][1].slice(-3)).toEqual(['2025-01-01', '2025-12-31', 'bank-a']);
    expect(result.rollover_suggestions).toHaveLength(1);
    expect(result.rollover_suggestions[0].best_rollover).toMatchObject({
      new_deposit_amount: 1030,
      days_after_return: 1,
    });
    expect(result.unmatched_returns).toBe(1);
    expect(result.orphan_returns).toEqual([
      expect.objectContaining({ identifier: 'ret-orphan', price: 700 }),
    ]);
  });

  it('returns interest income without date filters', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 9,
          principal: '2000',
          total_return: '2105',
          interest_earned: '105',
          deposit_date: '2025-01-01',
          maturity_date: '2025-10-01',
          account_name: 'Savings',
          return_transaction_id: 'ret-9',
          return_transaction_vendor: 'bank-a',
        },
      ],
    });

    const result = await pikadonModule.getPikadonInterestIncome();
    expect(queryMock.mock.calls[0][1]).toEqual([]);
    expect(result).toMatchObject({
      total_interest_earned: 105,
      count: 1,
    });
  });

  it('rolloverPikadon validates payload and handles missing original pikadon', async () => {
    await expect(
      pikadonModule.rolloverPikadon(10, {
        return_transaction_id: 'ret',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      pikadonModule.rolloverPikadon(10, {
        return_transaction_id: 'ret',
        return_transaction_vendor: 'bank-a',
        return_amount: 1000,
      }),
    ).rejects.toMatchObject({ status: 400 });

    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      pikadonModule.rolloverPikadon(999, {
        return_transaction_id: 'ret',
        return_transaction_vendor: 'bank-a',
        return_amount: 1100,
        new_principal: 1100,
        new_as_of_date: '2025-01-01',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 404 when rollover chain root does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(pikadonModule.getRolloverChain(777)).rejects.toMatchObject({ status: 404 });
  });

  it('returns empty maturity breakdown totals when no records match', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const result = await pikadonModule.getPikadonMaturityBreakdown();
    expect(queryMock.mock.calls[0][1]).toEqual([]);
    expect(result).toEqual({
      maturities: [],
      totals: {
        total_principal_returned: 0,
        total_interest_earned: 0,
        total_return: 0,
        total_new_deposits: 0,
        total_interest_reinvested: 0,
        total_interest_withdrawn: 0,
        count: 0,
      },
    });
  });

  it('auto-detects deposit-only events and classifies deposit types', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'dep-1',
          vendor: 'bank-a',
          date: '2025-01-01',
          name: 'הפקדה מפתח פיקדון',
          price: '-100',
          account_number: '1',
        },
        {
          identifier: 'dep-2',
          vendor: 'bank-a',
          date: '2025-01-02',
          name: 'הפקדה נזיל',
          price: '-200',
          account_number: '1',
        },
        {
          identifier: 'dep-3',
          vendor: 'bank-a',
          date: '2025-01-03',
          name: 'הפקדה קבועה חודש',
          price: '-300',
          account_number: '1',
        },
        {
          identifier: 'dep-4',
          vendor: 'bank-a',
          date: '2025-01-04',
          name: 'הפקדה משתנה',
          price: '-400',
          account_number: '1',
        },
        {
          identifier: 'dep-5',
          vendor: 'bank-a',
          date: '2025-01-05',
          name: 'הפקדה אחרת',
          price: '-500',
          account_number: '1',
        },
      ],
    });

    const result = await pikadonModule.autoDetectPikadonEvents();

    expect(result.maturity_events).toEqual([]);
    expect(result.chains).toEqual([]);
    expect(result.deposit_events.map((d: any) => d.type)).toEqual([
      'recurring',
      'liquid',
      'fixed_term',
      'variable',
      'other',
    ]);
    expect(result.totals).toMatchObject({
      maturity_count: 0,
      total_interest_earned: 0,
      total_tax_paid: 0,
      total_principal_returned: 0,
      total_active_principal: 1500,
    });
  });

  it('auto-detect picks the largest same-day rollover deposit when multiple deposits exist', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          identifier: 'dep-start',
          vendor: 'bank-a',
          date: '2026-01-01',
          name: 'הפקדה לפיקדון',
          price: '-1000',
          account_number: '1',
        },
        {
          identifier: 'ret-principal',
          vendor: 'bank-a',
          date: '2026-06-01',
          name: 'פירעון פיקדון',
          price: '1000',
          account_number: '1',
        },
        {
          identifier: 'ret-interest',
          vendor: 'bank-a',
          date: '2026-06-01',
          name: 'רווח מפיקדון',
          price: '20',
          account_number: '1',
        },
        {
          identifier: 'dep-roll-small',
          vendor: 'bank-a',
          date: '2026-06-01',
          name: 'הפקדה לפיקדון נזיל',
          price: '-200',
          account_number: '1',
        },
        {
          identifier: 'dep-roll-big',
          vendor: 'bank-a',
          date: '2026-06-01',
          name: 'הפקדה לפיקדון קבועה',
          price: '-900',
          account_number: '1',
        },
      ],
    });

    const result = await pikadonModule.autoDetectPikadonEvents();

    expect(result.chains).toHaveLength(1);
    expect(result.chains[0].rollover_deposit).toMatchObject({
      amount: 900,
      transaction: expect.objectContaining({ identifier: 'dep-roll-big' }),
    });
    expect(result.active_deposits).toEqual([
      expect.objectContaining({
        amount: 900,
        transaction: expect.objectContaining({ identifier: 'dep-roll-big' }),
      }),
    ]);
  });

  it('auto-setup rejects zero account id as invalid', async () => {
    await expect(pikadonModule.autoSetupPikadon(0)).rejects.toMatchObject({ status: 400 });
  });

  it('auto-setup skips synthetic interest income when net interest is not positive', async () => {
    let nextId = 800;

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, account_name FROM investment_accounts WHERE id = $1')) {
        return { rows: [{ id: 10, account_name: 'Main Bank' }] };
      }
      if (sql.includes('FROM transactions t') && sql.includes('WHERE (LOWER(t.name) LIKE $1')) {
        return {
          rows: [
            {
              identifier: 'dep-start',
              vendor: 'bank-a',
              date: '2026-01-01',
              name: 'הפקדה לפיקדון',
              price: '-1000',
              account_number: '123',
            },
            {
              identifier: 'return-principal',
              vendor: 'bank-a',
              date: '2026-03-01',
              name: 'פירעון פיקדון',
              price: '1000',
              account_number: '123',
            },
            {
              identifier: 'return-interest',
              vendor: 'bank-a',
              date: '2026-03-01',
              name: 'רווח מפיקדון',
              price: '5',
              account_number: '123',
            },
            {
              identifier: 'return-tax',
              vendor: null,
              date: '2026-03-01',
              name: 'ניכוי מס פיקדון',
              price: '-10',
              account_number: '123',
            },
            {
              identifier: 'dep-roll',
              vendor: 'bank-a',
              date: '2026-03-01',
              name: 'הפקדה לפיקדון נזיל',
              price: '-995',
              account_number: '123',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO investment_holdings') && sql.includes('RETURNING id')) {
        nextId += 1;
        return { rows: [{ id: nextId }] };
      }
      if (sql.includes('UPDATE investment_holdings') && sql.includes('interest_rate = $3')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE transactions SET is_pikadon_related = 1')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected auto-setup query: ${sql}`);
    });

    const result = await pikadonModule.autoSetupPikadon(10, {
      startDate: '2026-01-01',
      endDate: '2026-04-01',
      vendor: 'bank-a',
    });

    expect(result.created).toBe(2);
    expect(result.interest_income_created).toEqual([]);
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'matured' }),
        expect.objectContaining({ type: 'active_rollover' }),
      ]),
    );

    const interestCalls = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO transactions') && String(sql).includes('category_type'),
    );
    expect(interestCalls).toHaveLength(0);

    const markCalls = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE transactions SET is_pikadon_related = 1'),
    );
    expect(result.transactions_marked).toBe(6);
    expect(markCalls).toHaveLength(5);
  });
});
