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
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: '2026-01-15' }],
    });

    const result = await service.getLastTransactionDate({ vendor: 'hapoalim' });

    expect(database.query).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[0][1]).toEqual(['hapoalim']);
    expect(result.hasTransactions).toBe(true);
  });

  it('accepts vendorId as alias', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: '2026-01-15' }],
    });

    await service.getLastTransactionDate({ vendorId: 'max' });
    expect(database.query.mock.calls[0][1][0]).toBe('max');
  });

  it('queries with vendor_nickname when credentialNickname provided', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [
        {
          account_number: '9144',
          account_last_transaction_date: '2026-01-10T08:00:00.000Z',
        },
      ],
    });

    const result = await service.getLastTransactionDate({
      vendor: 'hapoalim',
      credentialNickname: 'My Account',
    });

    expect(database.query.mock.calls[0][1]).toEqual(['hapoalim', 'My Account']);
    expect(database.query.mock.calls[0][0]).toContain('GROUP BY account_number');
    expect(result.hasTransactions).toBe(true);
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
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: null }],
    });

    const result = await service.getLastTransactionDate({ vendor: 'hapoalim' });

    expect(result.hasTransactions).toBe(false);
    expect(result.message).toContain('No previous transactions');
    expect(new Date(result.lastTransactionDate).toISOString()).toBe(result.lastTransactionDate);
  });

  it('returns anchor date with zero default overlap when transactions exist', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: '2026-01-15T10:30:00.000Z' }],
    });

    const result = await service.getLastTransactionDate({ vendor: 'hapoalim' });

    expect(result.hasTransactions).toBe(true);
    expect(result.overlapDaysApplied).toBe(0);
    expect(result.anchorDate).toBeTruthy();
    const startDate = new Date(result.lastTransactionDate);
    const anchorDate = new Date(result.anchorDate);
    const overlapDays = Math.round((anchorDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    expect(overlapDays).toBe(0);
    expect(anchorDate.getDate()).toBe(16);
    expect(result.message).toContain('Starting from day after last transaction');
  });

  it('uses zero default overlap for credit cards too', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: '2026-01-15T10:30:00.000Z' }],
    });

    const result = await service.getLastTransactionDate({ vendor: 'max' });
    expect(result.overlapDaysApplied).toBe(0);
  });

  it('allows overlapDays override from request params', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: '2026-01-15T10:30:00.000Z' }],
    });

    const result = await service.getLastTransactionDate({ vendor: 'max', overlapDays: '100' });
    expect(result.overlapDaysApplied).toBe(100);
    expect(result.anchorDate).not.toBe(result.lastTransactionDate);
  });

  it('uses least-advanced account date when credential has multiple card accounts', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
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
    });

    const result = await service.getLastTransactionDate({
      vendor: 'max',
      credentialNickname: 'Max Main',
    });

    expect(result.hasTransactions).toBe(true);
    expect(result.accountDateStrategy).toBe('least_advanced');
    expect(result.accountCount).toBe(2);
    expectAnchorAfterBaseByOneDay(result.anchorDate, '2026-02-10T00:00:00.000Z');
    expect(result.message).toContain('least-advanced of 2 accounts');
  });

  it('ignores blank account bucket when named accounts exist', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
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
    });

    const result = await service.getLastTransactionDate({
      vendor: 'max',
      credentialNickname: 'Max Main',
    });

    expectAnchorAfterBaseByOneDay(result.anchorDate, '2026-02-20T00:00:00.000Z');
  });

  it('supports most_recent strategy override for credential-level lookup', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: '2026-02-28T10:00:00.000Z' }],
    });

    const result = await service.getLastTransactionDate({
      vendor: 'max',
      credentialNickname: 'Max Main',
      accountDateStrategy: 'most_recent',
    });

    expect(database.query.mock.calls[0][0]).toContain('MAX(COALESCE(transaction_datetime, date))');
    expect(result.accountDateStrategy).toBe('most_recent');
    expectAnchorAfterBaseByOneDay(result.anchorDate, '2026-02-28T10:00:00.000Z');
  });
});
