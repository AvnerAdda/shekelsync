import { beforeAll, describe, expect, it, vi } from 'vitest';

let realEstateService: any;
let buildCumulativeRealEstateSnapshots: (rows?: any[], valuations?: any[]) => any[];
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
        price: '-2500',
      },
      {
        identifier: 'purchase',
        date: '2026-05-25T21:00:00.000Z',
        price: '-500000',
      },
    ]);

    expect(snapshots).toEqual([
      { as_of_date: '2026-05-20', current_value: 2500, cost_basis: 2500 },
      { as_of_date: '2026-05-26', current_value: 502500, cost_basis: 502500 },
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
          { identifier: 'a', vendor: 'discount', date: '2026-05-19T21:00:00.000Z', price: '-2500' },
          { identifier: 'b', vendor: 'discount', date: '2026-05-25T21:00:00.000Z', price: '-500000' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await syncRealEstateHolding({
      dbAdapter: { query },
      accountId: 9,
    });

    expect(result).toMatchObject({
      accountId: 9,
      synced: true,
      latest: { as_of_date: '2026-05-26', current_value: 502500, cost_basis: 502500 },
    });
    expect(query).toHaveBeenCalledTimes(6);
    expect(String(query.mock.calls[3][0])).toContain("NOT LIKE 'Real estate simulator valuation%'");
    // Stale auto-synced rows (other dates) are pruned; protected valuations are not matched.
    expect(String(query.mock.calls[5][0])).toContain('DELETE FROM investment_holdings');
    expect(query.mock.calls[5][1]).toEqual([9, 'Auto-synced from linked real estate transactions', '2026-05-20', '2026-05-26']);
    expect(query.mock.calls[3][1]).toEqual([
      9,
      2500,
      2500,
      '2026-05-20',
      'Auto-synced from linked real estate transactions',
    ]);
    expect(query.mock.calls[4][1]).toEqual([
      9,
      502500,
      502500,
      '2026-05-26',
      'Auto-synced from linked real estate transactions',
    ]);
  });

  it('does not count linked mortgage debits as property value', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 9, account_type: 'real_estate' }] })
      .mockResolvedValueOnce({
        rows: [
          { identifier: 'b', vendor: 'discount', date: '2026-05-25T21:00:00.000Z', name: 'תשלום שוברי גביה', price: '-500000' },
          { identifier: 'm', vendor: 'discount', date: '2026-10-09T21:00:00.000Z', name: 'דסק-משכנתא חיוב', price: '-2500.75' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const result = await syncRealEstateHolding({ dbAdapter: { query }, accountId: 9 });
    expect(result.latest).toMatchObject({ current_value: 500000, cost_basis: 500000 });
    expect(query).toHaveBeenCalledTimes(5);
    // The old row on the mortgage debit date (2026-10-10) is removed.
    expect(query.mock.calls[4][1]).toEqual([9, 'Auto-synced from linked real estate transactions', '2026-05-26']);
  });

  it('rolls new payments forward from simulator and merged valuations', () => {
    expect(buildCumulativeRealEstateSnapshots([
      { date: '2026-05-26', price: -502750 },
      { date: '2026-09-10', price: -1250.25 },
      { date: '2026-10-11', price: -2500.75 },
      { date: '2026-10-14', price: -100 },
    ], [
      { as_of_date: '2026-06-18', current_value: 500000, cost_basis: 100000 },
      { as_of_date: '2026-10-13', current_value: 503751, cost_basis: 501251 },
    ]).at(-1)).toEqual({
      as_of_date: '2026-10-14', current_value: 503851, cost_basis: 501351,
    });
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
