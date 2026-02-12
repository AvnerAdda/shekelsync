import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let assetsService: any;
let clearInstitutionsCache: () => void;

beforeAll(async () => {
  const module = await import('../assets.js');
  assetsService = module.default ?? module;

  const institutionsModule = await import('../../institutions.js');
  clearInstitutionsCache = institutionsModule.clearInstitutionsCache;
});

beforeEach(() => {
  queryMock.mockReset();
  clearInstitutionsCache();
  assetsService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  assetsService.__resetDatabase();
  clearInstitutionsCache();
});

describe('investment assets service', () => {
  describe('listAssets', () => {
    it('lists active assets by default and falls back to vendor institution lookup', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              account_id: 10,
              account_type: 'brokerage',
              units: '4.5',
              average_cost: '99.2',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 2, vendor_code: 'brokerage', display_name_en: 'Broker' }],
        });

      const result = await assetsService.listAssets();

      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain('iasset.is_active = true');
      expect(params).toEqual([]);
      expect(result.assets[0].units).toBe(4.5);
      expect(result.assets[0].average_cost).toBe(99.2);
      expect(result.assets[0].institution).toMatchObject({ vendor_code: 'brokerage' });
    });

    it('supports account filter and includeInactive=true', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            units: null,
            average_cost: null,
            institution_id: 9,
            institution_vendor_code: 'pension',
          },
        ],
      });

      const result = await assetsService.listAssets({ accountId: 22, includeInactive: true });

      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain('iasset.account_id = $1');
      expect(sql).not.toContain('iasset.is_active = true');
      expect(params).toEqual([22]);
      expect(result.assets[0].units).toBeNull();
      expect(result.assets[0].average_cost).toBeNull();
      expect(result.assets[0].institution).toMatchObject({ vendor_code: 'pension' });
    });
  });

  describe('createAsset', () => {
    it('validates required fields', async () => {
      await expect(assetsService.createAsset({})).rejects.toMatchObject({ status: 400 });
    });

    it('throws when account does not exist', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        assetsService.createAsset({
          account_id: 999,
          asset_name: 'S&P 500 ETF',
          units: 10,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('creates asset and normalizes numeric response fields', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 11 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 77,
              account_id: 11,
              asset_name: 'MSCI World',
              units: '3.25',
              average_cost: '120.5',
            },
          ],
        });

      const result = await assetsService.createAsset({
        account_id: 11,
        asset_symbol: 'IWDA',
        asset_name: 'MSCI World',
        units: 3.25,
        average_cost: 120.5,
      });

      const insertParams = queryMock.mock.calls[1][1];
      expect(insertParams[0]).toBe(11);
      expect(insertParams[1]).toBe('IWDA');
      expect(insertParams[2]).toBe('MSCI World');
      expect(result.asset.units).toBe(3.25);
      expect(result.asset.average_cost).toBe(120.5);
    });
  });

  describe('updateAsset', () => {
    it('requires id and at least one updatable field', async () => {
      await expect(assetsService.updateAsset({})).rejects.toMatchObject({ status: 400 });
      await expect(assetsService.updateAsset({ id: 4 })).rejects.toMatchObject({ status: 400 });
    });

    it('updates selected fields and parses numeric response', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            asset_name: 'Updated ETF',
            units: '8',
            average_cost: '50',
          },
        ],
      });

      const result = await assetsService.updateAsset({
        id: 5,
        asset_name: 'Updated ETF',
        units: 8,
        average_cost: 50,
        is_active: false,
      });

      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain('asset_name = $1');
      expect(sql).toContain('units = $2');
      expect(sql).toContain('average_cost = $3');
      expect(sql).toContain('is_active = $4');
      expect(params).toEqual(['Updated ETF', 8, 50, false, 5]);
      expect(result.asset.units).toBe(8);
      expect(result.asset.average_cost).toBe(50);
    });

    it('throws 404 when updated asset is missing', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        assetsService.updateAsset({ id: 404, notes: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deactivateAsset', () => {
    it('deactivates by id or asset_id', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ id: 42, is_active: false }] });
      const result = await assetsService.deactivateAsset({ asset_id: 42 });

      expect(result.message).toBe('Asset deactivated');
      expect(result.asset.id).toBe(42);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('SET is_active = false'),
        [42],
      );
    });

    it('throws 400 for missing id and 404 for unknown id', async () => {
      await expect(assetsService.deactivateAsset({})).rejects.toMatchObject({ status: 400 });

      queryMock.mockResolvedValueOnce({ rows: [] });
      await expect(assetsService.deactivateAsset({ id: 1000 })).rejects.toMatchObject({ status: 404 });
    });
  });
});
