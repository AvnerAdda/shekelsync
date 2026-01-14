import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modulePromise = import('../holdings.js');

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const getClientMock = vi.fn();
const getInstitutionByVendorCodeMock = vi.fn();
const buildInstitutionFromRowMock = vi.fn((row: any) => {
  if (row.institution_id) {
    return {
      id: row.institution_id,
      vendor_code: row.vendor_code,
      display_name_he: row.display_name_he,
      display_name_en: row.display_name_en,
    };
  }
  return null;
});

// Mock institutions
vi.mock('../../institutions.js', () => ({
  INSTITUTION_SELECT_FIELDS: 'fi.id as institution_id, fi.vendor_code, fi.display_name_he, fi.display_name_en',
  buildInstitutionFromRow: buildInstitutionFromRowMock,
  getInstitutionByVendorCode: getInstitutionByVendorCodeMock,
  default: {
    INSTITUTION_SELECT_FIELDS: 'fi.id as institution_id, fi.vendor_code, fi.display_name_he, fi.display_name_en',
    buildInstitutionFromRow: buildInstitutionFromRowMock,
    getInstitutionByVendorCode: getInstitutionByVendorCodeMock,
  },
}));

// Mock balance-sync - use vi.hoisted to ensure mock is hoisted before imports
const forwardFillMissingDatesMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../balance-sync.js', () => ({
  forwardFillMissingDates: forwardFillMissingDatesMock,
  default: { forwardFillMissingDates: forwardFillMissingDatesMock },
}));

let holdingsService: any;

beforeAll(async () => {
  const module = await modulePromise;
  holdingsService = module.default ?? module;
});

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  releaseMock.mockReset();
  getClientMock.mockReset();
  getInstitutionByVendorCodeMock.mockReset();

  getClientMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });

  holdingsService.__setDatabase?.({
    query: queryMock,
    getClient: getClientMock,
  });
});

afterEach(() => {
  holdingsService.__resetDatabase?.();
});

describe('holdings service', () => {
  describe('listHoldings', () => {
    it('returns latest holdings for all accounts', async () => {
      // Note: buildInstitutionFromRow expects institution_* prefixed fields
      queryMock.mockResolvedValue({
        rows: [
          {
            id: 1,
            account_id: 1,
            current_value: 50000,
            cost_basis: 45000,
            as_of_date: '2025-01-01',
            account_name: 'My Portfolio',
            account_type: 'brokerage',
            institution_id: 1,
            institution_vendor_code: 'psagot',
            institution_display_name_he: 'פסגות',
            institution_display_name_en: 'Psagot',
            institution_type: 'investment',
          },
        ],
      });

      const result = await holdingsService.listHoldings();

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0].id).toBe(1);
      expect(result.holdings[0].current_value).toBe(50000);
      expect(result.holdings[0].institution).toMatchObject({
        id: 1,
        vendor_code: 'psagot',
        display_name_he: 'פסגות',
        display_name_en: 'Psagot',
      });
    });

    it('filters by account_id when provided', async () => {
      queryMock.mockResolvedValue({ rows: [] });

      await holdingsService.listHoldings({ account_id: 5 });

      expect(queryMock).toHaveBeenCalledTimes(1);
      const query = queryMock.mock.calls[0][0];
      expect(query).toContain('WHERE ih.account_id = $1');
    });

    it('returns history when includeHistory is true', async () => {
      queryMock.mockResolvedValue({ rows: [] });

      await holdingsService.listHoldings({ includeHistory: true });

      expect(queryMock).toHaveBeenCalledTimes(1);
      const query = queryMock.mock.calls[0][0];
      expect(query).not.toContain('DISTINCT ON');
    });

    it('handles null values in holdings', async () => {
      // When institution_id is null, buildInstitutionFromRow returns null
      // getInstitutionByVendorCode fallback may be called if account_type exists
      getInstitutionByVendorCodeMock.mockResolvedValue(null);

      queryMock.mockResolvedValue({
        rows: [
          {
            id: 1,
            account_id: 1,
            current_value: null,
            cost_basis: null,
            as_of_date: '2025-01-01',
            account_name: 'Empty Portfolio',
            account_type: null, // null to avoid fallback lookup
            institution_id: null,
          },
        ],
      });

      const result = await holdingsService.listHoldings();

      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0].current_value).toBeNull();
      expect(result.holdings[0].institution).toBeNull();
    });

    it('returns empty holdings when no holdings exist', async () => {
      queryMock.mockResolvedValue({ rows: [] });

      const result = await holdingsService.listHoldings();

      expect(result.holdings).toEqual([]);
    });
  });

  describe('upsertHolding', () => {
    it('creates new holding successfully', async () => {
      // verifyAccount query
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      // BEGIN, INSERT, COMMIT via client
      clientQueryMock
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 1, current_value: '50000', cost_basis: null }],
        }) // INSERT
        .mockResolvedValueOnce({}); // COMMIT

      const result = await holdingsService.upsertHolding({
        account_id: 1,
        current_value: 50000,
        as_of_date: '2025-01-01',
        save_history: false, // Skip forward-fill to avoid mocking issues
      });

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(result.holding).toBeDefined();
      expect(result.holding.id).toBe(1);
      expect(result.holding.current_value).toBe(50000);
    });

    it('throws 400 for missing account_id', async () => {
      await expect(
        holdingsService.upsertHolding({
          current_value: 50000,
          as_of_date: '2025-01-01',
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 404 for non-existent account', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        holdingsService.upsertHolding({
          account_id: 999,
          current_value: 50000,
          as_of_date: '2025-01-01',
        })
      ).rejects.toMatchObject({
        status: 404,
      });
    });

    it('updates existing holding for same account and date', async () => {
      // verifyAccount query
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      // BEGIN, INSERT (upsert), COMMIT via client
      clientQueryMock
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 1, current_value: '55000', cost_basis: null }],
        }) // INSERT/UPDATE
        .mockResolvedValueOnce({}); // COMMIT

      const result = await holdingsService.upsertHolding({
        account_id: 1,
        current_value: 55000,
        as_of_date: '2025-01-01',
        save_history: false, // Skip forward-fill to avoid mocking issues
      });

      expect(result.holding).toBeDefined();
      expect(result.holding.current_value).toBe(55000);
    });
  });

  describe('deleteHolding', () => {
    it('deletes holding successfully', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const result = await holdingsService.deleteHolding({ id: 1 });

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(result.message).toBe('Holding deleted');
      expect(result.holding).toBeDefined();
    });

    it('throws 400 for missing holding id', async () => {
      await expect(holdingsService.deleteHolding({})).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 404 for non-existent holding', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(holdingsService.deleteHolding({ id: 999 })).rejects.toMatchObject({
        status: 404,
      });
    });

    it('accepts holding_id parameter', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await holdingsService.deleteHolding({ holding_id: 1 });

      expect(queryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('listHoldings additional tests', () => {
    it('returns null institution when both institution_id and account_type are null', async () => {
      queryMock.mockResolvedValue({
        rows: [
          {
            id: 1,
            account_id: 1,
            current_value: 50000,
            cost_basis: 45000,
            as_of_date: '2025-01-01',
            account_name: 'My Portfolio',
            account_type: null, // No account_type for fallback
            institution_id: null, // No direct institution link
          },
        ],
      });

      const result = await holdingsService.listHoldings();

      expect(result.holdings[0].institution).toBeNull();
    });

    it('returns holdings with units field', async () => {
      queryMock.mockResolvedValue({
        rows: [
          {
            id: 1,
            account_id: 1,
            current_value: 10000,
            cost_basis: 8000,
            units: 100.5,
            as_of_date: '2025-01-01',
            account_name: 'Stock Portfolio',
            account_type: null,
            institution_id: null,
          },
        ],
      });

      const result = await holdingsService.listHoldings();

      expect(result.holdings[0].units).toBe(100.5);
    });

    it('returns history for specific account when includeHistory is true and accountId provided', async () => {
      queryMock.mockResolvedValue({
        rows: [
          { id: 1, account_id: 5, current_value: 50000, as_of_date: '2025-01-01', institution_id: null, account_type: null },
          { id: 2, account_id: 5, current_value: 48000, as_of_date: '2024-12-01', institution_id: null, account_type: null },
        ],
      });

      const result = await holdingsService.listHoldings({
        accountId: 5,
        includeHistory: true,
      });

      expect(result.history).toHaveLength(2);
      expect(queryMock.mock.calls[0][1]).toContain(5);
    });

    it('handles string "true" for includeHistory', async () => {
      queryMock.mockResolvedValue({ rows: [] });

      const result = await holdingsService.listHoldings({ includeHistory: 'true' });

      expect(result.history).toEqual([]);
    });
  });

  describe('upsertHolding additional tests', () => {
    it('creates holding with all optional fields', async () => {
      // verifyAccount query
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      // BEGIN, INSERT, COMMIT via client
      clientQueryMock
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            current_value: '50000',
            cost_basis: '45000',
            asset_name: 'S&P 500 ETF',
            asset_type: 'etf',
            units: '100',
            notes: 'Retirement fund',
          }],
        }) // INSERT
        .mockResolvedValueOnce({}); // COMMIT

      const result = await holdingsService.upsertHolding({
        account_id: 1,
        current_value: 50000,
        cost_basis: 45000,
        as_of_date: '2025-01-01',
        asset_name: 'S&P 500 ETF',
        asset_type: 'etf',
        units: 100,
        notes: 'Retirement fund',
        save_history: false,
      });

      expect(result.holding.cost_basis).toBe(45000);
    });

    it('throws 400 when current_value is missing', async () => {
      await expect(
        holdingsService.upsertHolding({
          account_id: 1,
          as_of_date: '2025-01-01',
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('throws 400 when as_of_date is missing', async () => {
      await expect(
        holdingsService.upsertHolding({
          account_id: 1,
          current_value: 50000,
        })
      ).rejects.toMatchObject({
        status: 400,
      });
    });

    it('defaults save_history to true', async () => {
      // verifyAccount query
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      // BEGIN, INSERT via client
      clientQueryMock
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: 1, current_value: '50000', cost_basis: null }],
        }) // INSERT
        // forwardFillMissingDates queries (mocked - returns empty)
        .mockResolvedValueOnce({ rows: [] }) // getLastSnapshot
        .mockResolvedValueOnce({}); // COMMIT

      const result = await holdingsService.upsertHolding({
        account_id: 1,
        current_value: 50000,
        as_of_date: '2025-01-01',
        // save_history defaults to true
      });

      expect(result.holding).toBeDefined();
      expect(clientQueryMock).toHaveBeenCalled();
    });

    it('performs ROLLBACK on error', async () => {
      // verifyAccount query
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      // BEGIN succeeds, INSERT fails
      clientQueryMock
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Insert failed')) // INSERT
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(
        holdingsService.upsertHolding({
          account_id: 1,
          current_value: 50000,
          as_of_date: '2025-01-01',
          save_history: false,
        })
      ).rejects.toThrow('Insert failed');

      // Verify ROLLBACK was called
      expect(clientQueryMock).toHaveBeenCalledWith('ROLLBACK');
      expect(releaseMock).toHaveBeenCalled();
    });
  });
});
