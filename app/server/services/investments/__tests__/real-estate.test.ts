import { beforeAll, describe, expect, it, vi } from 'vitest';

let realEstateService: any;
let buildCumulativeRealEstateSnapshots: (rows?: any[]) => any[];
let syncRealEstateHolding: (params?: Record<string, unknown>) => Promise<any>;

beforeAll(async () => {
  const module = await import('../real-estate.js');
  realEstateService = module.default ?? module;
  buildCumulativeRealEstateSnapshots = realEstateService.buildCumulativeRealEstateSnapshots;
  syncRealEstateHolding = realEstateService.syncRealEstateHolding;
});

describe('real estate investment service', () => {
  it('builds cumulative snapshots from linked real estate transaction dates', () => {
    const snapshots = buildCumulativeRealEstateSnapshots([
      {
        identifier: 'down-payment',
        date: '2026-05-19T21:00:00.000Z',
        price: '-6980',
      },
      {
        identifier: 'purchase',
        date: '2026-05-25T21:00:00.000Z',
        price: '-682500',
      },
    ]);

    expect(snapshots).toEqual([
      { as_of_date: '2026-05-20', current_value: 6980, cost_basis: 6980 },
      { as_of_date: '2026-05-26', current_value: 689480, cost_basis: 689480 },
    ]);
  });

  it('ignores invalid rows and floors negative running values at zero', () => {
    const snapshots = buildCumulativeRealEstateSnapshots([
      { identifier: 'missing-amount', date: '2026-05-01', price: null },
      { identifier: 'missing-date', date: null, price: -100 },
      { identifier: 'purchase', transaction_datetime: '2026-05-01T21:00:00.000Z', price: -500 },
      { identifier: 'refund', transaction_datetime: '2026-05-02T21:00:00.000Z', price: 700 },
    ]);

    expect(snapshots).toEqual([
      { as_of_date: '2026-05-02', current_value: 500, cost_basis: 500 },
      { as_of_date: '2026-05-03', current_value: 0, cost_basis: 0 },
    ]);
  });

  it('syncs holdings only for real estate accounts', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 9, account_type: 'real_estate' }] })
      .mockResolvedValueOnce({
        rows: [
          { identifier: 'a', vendor: 'discount', date: '2026-05-19T21:00:00.000Z', price: '-6980' },
          { identifier: 'b', vendor: 'discount', date: '2026-05-25T21:00:00.000Z', price: '-682500' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2 }] });

    const result = await syncRealEstateHolding({
      dbAdapter: { query },
      accountId: 9,
    });

    expect(result).toMatchObject({
      accountId: 9,
      synced: true,
      latest: { as_of_date: '2026-05-26', current_value: 689480, cost_basis: 689480 },
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(String(query.mock.calls[2][0])).toContain("NOT LIKE 'Real estate simulator valuation%'");
    expect(query.mock.calls[2][1]).toEqual([
      9,
      6980,
      6980,
      '2026-05-20',
      'Auto-synced from linked real estate transactions',
    ]);
    expect(query.mock.calls[3][1]).toEqual([
      9,
      689480,
      689480,
      '2026-05-26',
      'Auto-synced from linked real estate transactions',
    ]);
  });

  it('skips non-real-estate accounts', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 4, account_type: 'brokerage' }],
    });

    const result = await syncRealEstateHolding({
      dbAdapter: { query },
      accountId: 4,
    });

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns null for invalid inputs or missing accounts', async () => {
    await expect(syncRealEstateHolding()).resolves.toBeNull();
    await expect(syncRealEstateHolding({ dbAdapter: { query: vi.fn() }, accountId: 'bad' })).resolves.toBeNull();

    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    await expect(syncRealEstateHolding({ dbAdapter: { query }, accountId: 99 })).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM investment_accounts'),
      [99],
    );
  });

  it('returns a no-op result when a real estate account has no valid linked transactions', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 9, account_type: 'real_estate' }] })
      .mockResolvedValueOnce({ rows: [{ identifier: 'bad', date: null, price: null }] });

    const result = await syncRealEstateHolding({
      dbAdapter: { query },
      accountId: 9,
    });

    expect(result).toEqual({
      accountId: 9,
      synced: false,
      snapshots: [],
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
