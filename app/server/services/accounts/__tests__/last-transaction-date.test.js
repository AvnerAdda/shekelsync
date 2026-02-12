import { describe, it, expect, vi, beforeEach } from 'vitest';

const database = require('../../database.js');
const service = require('../last-transaction-date.js');

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
      rows: [{ last_transaction_date: '2026-01-10' }],
    });

    const result = await service.getLastTransactionDate({
      vendor: 'hapoalim',
      credentialNickname: 'My Account',
    });

    expect(database.query.mock.calls[0][1]).toEqual(['hapoalim', 'My Account']);
    expect(database.query.mock.calls[0][0]).toContain('vendor_nickname');
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

  it('returns day after last transaction when transactions exist', async () => {
    vi.spyOn(database, 'query').mockResolvedValue({
      rows: [{ last_transaction_date: '2026-01-15T10:30:00.000Z' }],
    });

    const result = await service.getLastTransactionDate({ vendor: 'hapoalim' });

    expect(result.hasTransactions).toBe(true);
    const returnedDate = new Date(result.lastTransactionDate);
    expect(returnedDate.getDate()).toBe(16);
    expect(result.message).toContain('Starting from day after last transaction');
  });
});
