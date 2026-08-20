import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let assetsService: any;
let clearInstitutionsCache: () => void;

const assetRow = (overrides: Record<string, unknown> = {}) => ({
  id: 77,
  account_id: 11,
  asset_symbol: 'IWDA',
  asset_name: 'MSCI World',
  asset_type: 'etf',
  units: '3.25',
  average_cost: '120.5',
  current_price: '130',
  current_value: '422.5',
  cost_basis: '391.625',
  valuation_date: '2026-08-12',
  currency: 'USD',
  is_active: true,
  ...overrides,
});

beforeAll(async () => {
  const module = await import('../assets.js');
  assetsService = module.default ?? module;

  const institutionsModule = await import('../../institutions.js');
  clearInstitutionsCache = institutionsModule.clearInstitutionsCache;
});

beforeEach(() => {
  queryMock.mockReset();
  clearInstitutionsCache();
  assetsService.__setDatabase({ query: (...args: any[]) => queryMock(...args) });
});

afterEach(() => {
  assetsService.__resetDatabase();
  clearInstitutionsCache();
});

describe('investment assets compatibility service', () => {
  it('lists active assets with canonical and legacy aliases', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        ...assetRow(),
        account_type: 'brokerage',
        institution_id: 2,
        institution_vendor_code: 'broker_demo',
        institution_display_name_en: 'Broker Demo',
      }],
    });

    const result = await assetsService.listAssets();
    const [sql, params] = queryMock.mock.calls[0];

    expect(sql).toContain('iasset.is_active = true');
    expect(sql).toContain('ia.is_active = true');
    expect(params).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.assets[0]).toMatchObject({
      asset_symbol: 'IWDA',
      symbol: 'IWDA',
      units: 3.25,
      quantity: 3.25,
      average_cost: 120.5,
      avg_price: 120.5,
      current_price: 130,
      current_value: 422.5,
      cost_basis: 391.625,
      valuation_date: '2026-08-12',
      as_of_date: '2026-08-12',
      institution: expect.objectContaining({ vendor_code: 'broker_demo' }),
    });
  });

  it('supports account filters and includeInactive aliases', async () => {
    queryMock.mockResolvedValueOnce({ rows: [assetRow({ is_active: false })] });

    await assetsService.listAssets({ accountId: 22, include_inactive: true });
    const [sql, params] = queryMock.mock.calls[0];

    expect(sql).toContain('iasset.account_id = $1');
    expect(sql).not.toContain('iasset.is_active = true');
    expect(params).toEqual([22]);
  });

  it('validates required fields and rejects non-numeric values', async () => {
    await expect(assetsService.createAsset({})).rejects.toMatchObject({ status: 400 });

    queryMock.mockResolvedValueOnce({ rows: [{ id: 11, currency: 'ILS' }] });
    await expect(assetsService.createAsset({
      account_id: 11,
      symbol: 'ETF',
      quantity: 'many',
    })).rejects.toMatchObject({ status: 400 });
  });

  it('throws when the active account does not exist', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(assetsService.createAsset({
      account_id: 999,
      symbol: 'SPY',
      quantity: 10,
    })).rejects.toMatchObject({ status: 404 });
  });

  it('accepts legacy form aliases and derives value and basis', async () => {
    let insertParams: unknown[] = [];
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 11, currency: 'ILS' }] })
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        insertParams = params;
        return Promise.resolve({ rows: [assetRow({
          asset_symbol: params[1],
          asset_name: params[2],
          units: params[4],
          average_cost: params[5],
          current_price: params[6],
          current_value: params[7],
          cost_basis: params[8],
          valuation_date: params[9],
          currency: params[10],
        })] });
      });

    const result = await assetsService.createAsset({
      account_id: 11,
      symbol: 'IWDA',
      quantity: 4,
      avg_price: 100,
      price: 125,
      as_of_date: '2026-08-12',
    });

    expect(insertParams).toEqual([
      11, 'IWDA', 'IWDA', null, 4, 100, 125, 500, 400, '2026-08-12', 'ILS', null,
    ]);
    expect(result.asset).toMatchObject({
      symbol: 'IWDA',
      quantity: 4,
      avg_price: 100,
      current_price: 125,
      current_value: 500,
      cost_basis: 400,
      currency: 'ILS',
    });
  });

  it('preserves valid zero values rather than converting them to null', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 11, currency: 'USD' }] })
      .mockImplementationOnce((_sql: string, params: unknown[]) => Promise.resolve({
        rows: [assetRow({
          units: params[4],
          average_cost: params[5],
          current_price: params[6],
          current_value: params[7],
          cost_basis: params[8],
        })],
      }));

    const result = await assetsService.createAsset({
      account_id: 11,
      asset_name: 'Warrant',
      units: 0,
      average_cost: 0,
      current_price: 0,
    });

    expect(result.asset).toMatchObject({
      units: 0,
      average_cost: 0,
      current_price: 0,
      current_value: 0,
      cost_basis: 0,
    });
  });

  it('updates aliases and recomputes derived totals', async () => {
    let updateParams: unknown[] = [];
    queryMock
      .mockResolvedValueOnce({ rows: [assetRow()] })
      .mockImplementationOnce((_sql: string, params: unknown[]) => {
        updateParams = params;
        return Promise.resolve({ rows: [assetRow({
          units: params[3],
          average_cost: params[4],
          current_price: params[5],
          current_value: params[6],
          cost_basis: params[7],
          valuation_date: params[8],
        })] });
      });

    const result = await assetsService.updateAsset({
      id: 77,
      quantity: 5,
      avg_price: 110,
      price: 140,
      as_of_date: '2026-08-13',
    });

    expect(updateParams.slice(3, 9)).toEqual([5, 110, 140, 700, 550, '2026-08-13']);
    expect(result.asset).toMatchObject({ quantity: 5, current_value: 700, cost_basis: 550 });
  });

  it('requires an id and at least one field when updating', async () => {
    await expect(assetsService.updateAsset({})).rejects.toMatchObject({ status: 400 });
    await expect(assetsService.updateAsset({ id: 4 })).rejects.toMatchObject({ status: 400 });
  });

  it('returns 404 for a missing update target', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(assetsService.updateAsset({ id: 404, notes: 'x' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('deactivates by either id alias and updates the timestamp', async () => {
    queryMock.mockResolvedValueOnce({ rows: [assetRow({ id: 42, is_active: false })] });
    const result = await assetsService.deactivateAsset({ asset_id: 42 });

    expect(result.message).toBe('Asset deactivated');
    expect(result.asset.id).toBe(42);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/is_active = false[\s\S]*updated_at = CURRENT_TIMESTAMP/),
      [42],
    );
  });
});
