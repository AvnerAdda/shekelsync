import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let service: any;

const sqlText = (value: unknown) => String(value).replace(/\s+/g, ' ').trim();

beforeEach(async () => {
  queryMock.mockReset();
  const module = await import('../liabilities.js');
  service = module.default ?? module;
  service.__setDatabase({ query: (...args: any[]) => queryMock(...args) });
});

afterEach(() => {
  service.__resetDatabase();
});

describe('investment liabilities service', () => {
  it.each([
    [{ balance: 10 }, /liability_name is required/i],
    [{ liability_name: 'Loan' }, /balance is required/i],
    [{ liability_name: 'Loan', balance: -1 }, /balance must be a number/i],
    [{ liability_name: 'Loan', balance: 1, currency: 'US' }, /three-letter code/i],
    [{ liability_name: 'Loan', balance: 1, liability_type: 'mortgage' }, /invalid liability_type/i],
    [{ liability_name: 'Loan', balance: 1, as_of_date: 'not-a-date' }, /valid YYYY-MM-DD/i],
    [{ liability_name: 'Loan', balance: 1, as_of_date: '2026-02-31' }, /valid YYYY-MM-DD/i],
    [{ liability_name: 'Loan', balance: 1, included_in_net_worth: 'maybe' }, /must be a boolean/i],
  ])('rejects invalid create payload %#', async (payload, message) => {
    await expect(service.createLiability(payload)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(message),
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('creates a normalized liability with explicit net-worth inclusion', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (sqlText(sql).startsWith('INSERT INTO investment_liabilities')) {
        return Promise.resolve({
          rows: [{
            id: '5',
            liability_name: params?.[0],
            liability_type: params?.[1],
            balance: String(params?.[2]),
            currency: params?.[3],
            interest_rate: String(params?.[4]),
            monthly_payment: String(params?.[5]),
            as_of_date: params?.[6],
            included_in_net_worth: params?.[7],
            notes: params?.[8],
            is_active: 1,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await service.createLiability({
      name: 'Car loan',
      liability_type: 'loan',
      balance: '120000',
      currency: 'usd',
      interest_rate: '4.5',
      monthly_payment: '2500',
      as_of_date: '2026-08-12',
      included_in_net_worth: false,
      notes: '  Fixed rate  ',
    });

    expect(result.liability).toMatchObject({
      id: 5,
      liability_name: 'Car loan',
      liability_type: 'loan',
      balance: 120000,
      currency: 'USD',
      interest_rate: 4.5,
      monthly_payment: 2500,
      included_in_net_worth: false,
      is_active: true,
      notes: 'Fixed rate',
    });
    expect(queryMock.mock.calls[0][1]).toEqual([
      'Car loan',
      'loan',
      120000,
      'USD',
      4.5,
      2500,
      '2026-08-12',
      0,
      'Fixed rate',
    ]);
  });

  it('lists active liabilities by default and can include inactive records', async () => {
    queryMock.mockResolvedValue({
      rows: [{
        id: '3',
        liability_name: 'Tax balance',
        liability_type: 'tax',
        balance: '4500.25',
        currency: 'ILS',
        interest_rate: null,
        monthly_payment: null,
        included_in_net_worth: 1,
        is_active: 0,
      }],
    });

    const activeOnly = await service.listLiabilities();
    const all = await service.listLiabilities({ includeInactive: 'true' });

    expect(activeOnly.liabilities[0]).toMatchObject({
      id: 3,
      balance: 4500.25,
      included_in_net_worth: true,
      is_active: false,
    });
    expect(sqlText(queryMock.mock.calls[0][0])).toContain('WHERE is_active = 1');
    expect(sqlText(queryMock.mock.calls[1][0])).not.toContain('WHERE is_active = 1');
    expect(all.liabilities).toHaveLength(1);
  });

  it('updates only supplied fields and reports missing records', async () => {
    queryMock.mockImplementation((sql: string, params?: unknown[]) => {
      if (sqlText(sql).startsWith('UPDATE investment_liabilities') && params?.at(-1) === 5) {
        return Promise.resolve({
          rows: [{
            id: 5,
            liability_name: 'Car loan',
            liability_type: 'loan',
            balance: params?.[0],
            currency: 'USD',
            interest_rate: 4.5,
            monthly_payment: 2500,
            included_in_net_worth: params?.[1],
            notes: params?.[2],
            is_active: 1,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const updated = await service.updateLiability({
      id: 5,
      balance: 90000,
      included_in_net_worth: 'false',
      notes: '',
    });

    expect(updated.liability).toMatchObject({
      id: 5,
      balance: 90000,
      included_in_net_worth: false,
      notes: null,
    });
    expect(queryMock.mock.calls[0][1]).toEqual([90000, 0, null, 5]);
    expect(sqlText(queryMock.mock.calls[0][0])).toContain(
      'SET balance = $1, included_in_net_worth = $2, notes = $3',
    );

    await expect(service.updateLiability({ id: 9, balance: 1 })).rejects.toMatchObject({
      status: 404,
      message: 'Liability not found',
    });
    await expect(service.updateLiability({ id: 5 })).rejects.toMatchObject({
      status: 400,
      message: 'No fields to update',
    });
  });

  it('soft-deactivates an existing liability and rejects an unknown id', async () => {
    queryMock.mockImplementation((_sql: string, params?: unknown[]) => {
      if (params?.[0] === 5) {
        return Promise.resolve({
          rows: [{
            id: 5,
            liability_name: 'Car loan',
            liability_type: 'loan',
            balance: 90000,
            currency: 'USD',
            interest_rate: null,
            monthly_payment: null,
            included_in_net_worth: 1,
            is_active: 0,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(service.deactivateLiability({ liability_id: 5 })).resolves.toMatchObject({
      liability: { id: 5, is_active: false },
    });
    expect(queryMock.mock.calls[0][1]).toEqual([5]);

    await expect(service.deactivateLiability({ id: 99 })).rejects.toMatchObject({
      status: 404,
      message: 'Liability not found',
    });
    await expect(service.deactivateLiability({ id: 0 })).rejects.toMatchObject({ status: 400 });
  });
});
