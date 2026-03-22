import { describe, it, expect, vi, beforeEach } from 'vitest';

const database = require('../../database.js');
const service = require('../last-transaction-date.js');

function expectAnchorAfterBaseByOneDay(anchorIso, baseIso) {
  const anchorMs = new Date(anchorIso).getTime();
  const baseMs = new Date(baseIso).getTime();
  const diffDays = Math.round((anchorMs - baseMs) / (24 * 60 * 60 * 1000));
  expect(diffDays).toBe(1);
}

describe('last-transaction-date', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws 400 when vendor is missing', async () => {
    await expect(service.getLastTransactionDate({})).rejects.toThrow('Vendor parameter is required');
  });

  it('throws 400 when params is empty', async () => {
    await expect(service.getLastTransactionDate()).rejects.toThrow('Vendor parameter is required');
  });

  it('accepts vendor param', async () => {
    vi.spyOn(database, 'query')
      .mockResolvedValueOnce({ rows: [{ credential_count: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            account_number: '1234',
            account_last_transaction_date: '2026-01-15T00:00:00.000Z',
          },
        ],
      });

    const result = await service.getLastTransactionDate({ vendor: 'hapoalim' });

    expect(database.query).toHaveBeenCalledTimes(2);
    expect(database.query.mock.calls[0][1]).toEqual(['hapoalim']);
    expect(database.query.mock.calls[1][1]).toEqual(['hapoalim']);
    expect(result.hasTransactions).toBe(true);
  });

  it('accepts vendorId as alias', async () => {
    vi.spyOn(database, 'query')
      .mockResolvedValueOnce({ rows: [{ credential_count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ last_transaction_date: '2026-01-15' }] });

    await service.getLastTransactionDate({ vendorId: 'max' });
    expect(database.query.mock.calls[0][1][0]).toBe('max');
  });

  it('queries with vendor_nickname when credentialNickname provided and no stored account identifiers exist', async () => {
    vi.spyOn(database, 'query').mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM transactions') && String(sql).includes('vendor_nickname = $2')) {
        return {
          rows: [
            {
              account_number: '9144',
              account_last_transaction_date: '2026-01-10T08:00:00.000Z',
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql} :: ${JSON.stringify(params)}`);
    });

    const result = await service.getLastTransactionDate({
      vendor: 'hapoalim',
      credentialNickname: 'My Account',
    });

    expect(database.query.mock.calls[0][1]).toEqual(['hapoalim', 'My Account']);
    expect(database.query.mock.calls[0][0]).toContain('GROUP BY account_number');
    expect(result.hasTransactions).toBe(true);
    expect(result.anchorSource).toBe('nickname_fallback');
    expect(result.message).toContain('My Account');
  });

  it('accepts nickname as alias for credentialNickname', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: '2026-01-10' }],
    });

    await service.getLastTransactionDate({ vendor: 'hapoalim', nickname: 'Alias' });
    expect(database.query.mock.calls[0][1]).toEqual(['hapoalim', 'Alias']);
  });

  it('returns fallback date 3 months ago when no transactions found', async () => {
    vi.spyOn(database, 'query')
      .mockResolvedValueOnce({ rows: [{ credential_count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ last_transaction_date: null }] });

    const result = await service.getLastTransactionDate({ vendor: 'hapoalim' });

    expect(result.hasTransactions).toBe(false);
    expect(result.message).toContain('No previous transactions');
    expect(new Date(result.lastTransactionDate).toISOString()).toBe(result.lastTransactionDate);
  });

  it('returns anchor date with seven-day default overlap when transactions exist', async () => {
    vi.spyOn(database, 'query')
      .mockResolvedValueOnce({ rows: [{ credential_count: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            account_number: '1234',
            account_last_transaction_date: '2026-01-15T10:30:00.000Z',
          },
        ],
      });

    const result = await service.getLastTransactionDate({ vendor: 'hapoalim' });

    expect(result.hasTransactions).toBe(true);
    expect(result.overlapDaysApplied).toBe(7);
    expect(result.anchorDate).toBeTruthy();
    const startDate = new Date(result.lastTransactionDate);
    const anchorDate = new Date(result.anchorDate);
    const overlapDays = Math.round((anchorDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    expect(overlapDays).toBe(7);
    expect(anchorDate.getDate()).toBe(16);
    expect(result.message).toContain('Starting from day after last transaction');
  });

  it('uses seven-day default overlap for credit cards too', async () => {
    vi.spyOn(database, 'query')
      .mockResolvedValueOnce({ rows: [{ credential_count: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            account_number: '4886',
            account_last_transaction_date: '2026-01-15T10:30:00.000Z',
          },
        ],
      });

    const result = await service.getLastTransactionDate({ vendor: 'max' });
    expect(result.overlapDaysApplied).toBe(7);
  });

  it('allows overlapDays override from request params', async () => {
    vi.spyOn(database, 'query')
      .mockResolvedValueOnce({ rows: [{ credential_count: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            account_number: '4886',
            account_last_transaction_date: '2026-01-15T10:30:00.000Z',
          },
        ],
      });

    const result = await service.getLastTransactionDate({ vendor: 'max', overlapDays: '100' });
    expect(result.overlapDaysApplied).toBe(100);
    expect(result.anchorDate).not.toBe(result.lastTransactionDate);
  });

  it('anchors by stored credential account numbers and ignores nickname drift', async () => {
    vi.spyOn(database, 'query').mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM vendor_credentials') && String(sql).includes('WHERE id = $1 AND vendor = $2')) {
        expect(params).toEqual([5, 'discount']);
        return {
          rows: [
            {
              bank_account_number: '0162490242',
              card6_digits: null,
              nickname: 'Avner Lois',
            },
          ],
        };
      }

      if (String(sql).includes('account_number IN ($2)')) {
        return {
          rows: [
            {
              account_number: '0162490242',
              account_last_transaction_date: '2026-03-15T00:00:00.000Z',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql} :: ${JSON.stringify(params)}`);
    });

    const result = await service.getLastTransactionDate({
      vendor: 'discount',
      credentialId: 5,
      credentialNickname: 'Renamed Nickname',
    });

    expect(result.hasTransactions).toBe(true);
    expect(result.anchorSource).toBe('credential_account_numbers');
    expect(database.query.mock.calls[1][0]).toContain('account_number IN ($2)');
    expect(database.query.mock.calls[1][1]).toEqual(['discount', '0162490242']);
  });

  it('falls back to nickname lookup when stored account identifiers do not match existing transaction rows', async () => {
    vi.spyOn(database, 'query').mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM vendor_credentials') && String(sql).includes('WHERE id = $1 AND vendor = $2')) {
        return {
          rows: [
            {
              bank_account_number: '0162490242',
              card6_digits: null,
              nickname: 'Discount Main',
            },
          ],
        };
      }

      if (String(sql).includes('account_number IN ($2)')) {
        return { rows: [] };
      }

      if (String(sql).includes('FROM transactions') && String(sql).includes('vendor_nickname = $2')) {
        expect(params).toEqual(['discount', 'Discount Main']);
        return {
          rows: [
            {
              account_number: 'legacy-bucket',
              account_last_transaction_date: '2026-03-05T00:00:00.000Z',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql} :: ${JSON.stringify(params)}`);
    });

    const result = await service.getLastTransactionDate({
      vendor: 'discount',
      credentialId: 5,
    });

    expect(result.hasTransactions).toBe(true);
    expect(result.anchorSource).toBe('nickname_fallback');
    expect(database.query.mock.calls[1][0]).toContain('account_number IN ($2)');
    expect(database.query.mock.calls[2][0]).toContain('vendor_nickname = $2');
  });

  it('uses least-advanced account date when credential has multiple stored card accounts', async () => {
    vi.spyOn(database, 'query').mockImplementation(async (sql) => {
      if (String(sql).includes('FROM vendor_credentials')) {
        return {
          rows: [
            {
              bank_account_number: null,
              card6_digits: '9144;6219',
              nickname: 'Max Main',
            },
          ],
        };
      }

      return {
        rows: [
          {
            account_number: '9144',
            account_last_transaction_date: '2026-02-20T00:00:00.000Z',
          },
          {
            account_number: '6219',
            account_last_transaction_date: '2026-02-10T00:00:00.000Z',
          },
        ],
      };
    });

    const result = await service.getLastTransactionDate({
      vendor: 'max',
      credentialId: 9,
    });

    expect(result.hasTransactions).toBe(true);
    expect(result.accountDateStrategy).toBe('least_advanced');
    expect(result.accountCount).toBe(2);
    expect(result.anchorSource).toBe('credential_account_numbers');
    expectAnchorAfterBaseByOneDay(result.anchorDate, '2026-02-10T00:00:00.000Z');
    expect(result.message).toContain('least-advanced of 2 accounts');
  });

  it('ignores blank account bucket when named accounts exist', async () => {
    vi.spyOn(database, 'query').mockImplementation(async (sql) => {
      if (String(sql).includes('FROM vendor_credentials')) {
        return {
          rows: [
            {
              bank_account_number: null,
              card6_digits: '9144',
              nickname: 'Max Main',
            },
          ],
        };
      }

      return {
        rows: [
          {
            account_number: null,
            account_last_transaction_date: '2024-01-01T00:00:00.000Z',
          },
          {
            account_number: '9144',
            account_last_transaction_date: '2026-02-20T00:00:00.000Z',
          },
        ],
      };
    });

    const result = await service.getLastTransactionDate({
      vendor: 'max',
      credentialId: 9,
    });

    expectAnchorAfterBaseByOneDay(result.anchorDate, '2026-02-20T00:00:00.000Z');
  });

  it('supports most_recent strategy override for credential-level lookup', async () => {
    vi.spyOn(database, 'query').mockImplementation(async (sql) => {
      if (String(sql).includes('FROM vendor_credentials')) {
        return {
          rows: [
            {
              bank_account_number: null,
              card6_digits: '9144;6219',
              nickname: 'Max Main',
            },
          ],
        };
      }

      return {
        rows: [{ last_transaction_date: '2026-02-28T10:00:00.000Z' }],
      };
    });

    const result = await service.getLastTransactionDate({
      vendor: 'max',
      credentialId: 9,
      accountDateStrategy: 'most_recent',
    });

    expect(database.query.mock.calls[1][0]).toContain('MAX(COALESCE(transaction_datetime, date))');
    expect(result.accountDateStrategy).toBe('most_recent');
    expectAnchorAfterBaseByOneDay(result.anchorDate, '2026-02-28T10:00:00.000Z');
  });

  it('falls back to vendor-only only when the vendor has a single credential', async () => {
    vi.spyOn(database, 'query')
      .mockResolvedValueOnce({ rows: [{ credential_count: '1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            account_number: '4886',
            account_last_transaction_date: '2026-02-28T10:00:00.000Z',
          },
        ],
      });

    const result = await service.getLastTransactionDate({ vendor: 'max' });

    expect(result.anchorSource).toBe('vendor_fallback');
    expect(result.hasTransactions).toBe(true);
  });

  it('does not use vendor-only fallback when multiple credentials exist', async () => {
    vi.spyOn(database, 'query')
      .mockResolvedValueOnce({ rows: [{ credential_count: '2' }] });

    const result = await service.getLastTransactionDate({ vendor: 'max' });

    expect(result.hasTransactions).toBe(false);
    expect(result.anchorSource).toBe('vendor_fallback');
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it('falls back to vendor-only lookup after identifier and nickname lookups miss when there is only one credential', async () => {
    vi.spyOn(database, 'query').mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM vendor_credentials') && String(sql).includes('WHERE id = $1 AND vendor = $2')) {
        return {
          rows: [
            {
              bank_account_number: '0162490242',
              card6_digits: null,
              nickname: 'Discount Main',
            },
          ],
        };
      }

      if (String(sql).includes('account_number IN ($2)')) {
        return { rows: [] };
      }

      if (String(sql).includes('FROM transactions') && String(sql).includes('vendor_nickname = $2')) {
        return { rows: [] };
      }

      if (String(sql).includes('COUNT(*) AS credential_count')) {
        return { rows: [{ credential_count: '1' }] };
      }

      if (String(sql).includes('WHERE vendor = $1') && String(sql).includes('GROUP BY account_number')) {
        expect(params).toEqual(['discount']);
        return {
          rows: [
            {
              account_number: '0162490242',
              account_last_transaction_date: '2026-03-01T00:00:00.000Z',
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql} :: ${JSON.stringify(params)}`);
    });

    const result = await service.getLastTransactionDate({
      vendor: 'discount',
      credentialId: 5,
    });

    expect(result.hasTransactions).toBe(true);
    expect(result.anchorSource).toBe('vendor_fallback');
    expect(database.query).toHaveBeenCalledTimes(5);
  });
});
