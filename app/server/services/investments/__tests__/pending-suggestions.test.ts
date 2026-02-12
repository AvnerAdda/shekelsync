import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let pendingService: any;
let clearInstitutionsCache: () => void;

beforeAll(async () => {
  const module = await import('../pending-suggestions.js');
  pendingService = module.default ?? module;

  const institutionsModule = await import('../../institutions.js');
  clearInstitutionsCache = institutionsModule.clearInstitutionsCache;
});

beforeEach(() => {
  queryMock.mockReset();
  clearInstitutionsCache();
  pendingService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  pendingService.__resetDatabase();
  clearInstitutionsCache();
});

describe('pending suggestions service', () => {
  describe('listPendingSuggestions', () => {
    it('defaults to pending status and uses joined institution fields when available', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            status: 'pending',
            suggested_account_id: 2,
            institution_id: 2,
            institution_vendor_code: 'brokerage',
          },
        ],
      });

      const result = await pendingService.listPendingSuggestions();

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock.mock.calls[0][1]).toEqual(['pending']);
      expect(result.total).toBe(1);
      expect(result.pendingSuggestions[0].institution).toMatchObject({
        vendor_code: 'brokerage',
      });
    });

    it('falls back to suggested_institution_vendor lookup when join data is absent', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 2,
              status: 'pending',
              suggested_institution_vendor: 'pension',
              raw_suggested_institution: null,
              institution_id: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 9, vendor_code: 'pension', display_name_en: 'Pension' }],
        });

      const result = await pendingService.listPendingSuggestions({ status: 'approved' });

      expect(queryMock.mock.calls[0][1]).toEqual(['approved']);
      expect(result.pendingSuggestions[0].institution).toMatchObject({
        vendor_code: 'pension',
      });
    });

    it('falls back to raw suggested institution when no lookup succeeds', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 3,
            status: 'pending',
            suggested_institution_vendor: null,
            raw_suggested_institution: 'Custom Fund',
            institution_id: null,
          },
        ],
      });

      const result = await pendingService.listPendingSuggestions();

      expect(result.pendingSuggestions[0].institution).toMatchObject({
        vendor_code: 'Custom Fund',
        display_name_en: 'Custom Fund',
      });
    });
  });

  describe('applySuggestionAction', () => {
    it('validates payload and action value', async () => {
      await expect(pendingService.applySuggestionAction({})).rejects.toMatchObject({ status: 400 });
      await expect(
        pendingService.applySuggestionAction({ id: 1, action: 'archive' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('returns 404 when suggestion is missing', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        pendingService.applySuggestionAction({ id: 99, action: 'approve' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('handles reject and ignore actions without link creation', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 4 }] })
        .mockResolvedValueOnce({ rows: [] });

      const rejectResult = await pendingService.applySuggestionAction({ id: 4, action: 'reject' });
      expect(rejectResult).toMatchObject({
        success: true,
        action: 'reject',
        message: 'Suggestion rejected',
      });

      queryMock.mockReset();
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })
        .mockResolvedValueOnce({ rows: [] });

      const ignoreResult = await pendingService.applySuggestionAction({ id: 5, action: 'ignore' });
      expect(ignoreResult).toMatchObject({
        success: true,
        action: 'ignore',
        message: 'Suggestion ignored',
      });
    });

    it('approves suggestion and creates transaction-account link', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 7,
              transaction_identifier: 'txn-1',
              transaction_vendor: 'leumi',
              transaction_date: '2026-02-01',
              suggested_account_id: 3,
              confidence: 0.92,
              transaction_name: 'interactive brokers transfer',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ transaction_identifier: 'txn-1', account_id: 3 }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await pendingService.applySuggestionAction({ id: 7, action: 'approve' });

      expect(queryMock).toHaveBeenCalledTimes(4);
      expect(result).toMatchObject({
        success: true,
        action: 'approved',
        message: 'Transaction linked successfully',
      });
      expect(result.linkCreated).toMatchObject({ account_id: 3 });
    });
  });
});
