import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let patternsService: any;
let clearInstitutionsCache: () => void;

beforeAll(async () => {
  const module = await import('../patterns.js');
  patternsService = module.default ?? module;

  const institutionsModule = await import('../../institutions.js');
  clearInstitutionsCache = institutionsModule.clearInstitutionsCache;
});

beforeEach(() => {
  queryMock.mockReset();
  clearInstitutionsCache();
  patternsService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  patternsService.__resetDatabase();
  clearInstitutionsCache();
});

describe('investment patterns service', () => {
  describe('listPatterns', () => {
    it('lists patterns and returns institution from joined row data', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            account_id: 10,
            pattern: 'interactive',
            account_type: 'brokerage',
            institution_id: 2,
            institution_vendor_code: 'brokerage',
            institution_display_name_en: 'Broker',
          },
        ],
      });

      const result = await patternsService.listPatterns();

      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain('FROM account_transaction_patterns atp');
      expect(params).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
      expect(result.patterns[0].institution).toMatchObject({
        vendor_code: 'brokerage',
      });
    });

    it('supports account filter and falls back to vendor institution lookup', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 6,
              account_id: 11,
              pattern: 'deposit',
              account_type: 'savings',
              institution_id: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 7,
              vendor_code: 'savings',
              display_name_en: 'Savings',
            },
          ],
        });

      const result = await patternsService.listPatterns({ account_id: 11 });

      expect(queryMock).toHaveBeenCalledTimes(2);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain('WHERE atp.account_id = $1');
      expect(params).toEqual([11]);
      expect(result.patterns[0].institution).toMatchObject({
        vendor_code: 'savings',
      });
    });
  });

  describe('createPattern', () => {
    it('validates required fields and pattern type', async () => {
      await expect(patternsService.createPattern({})).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        patternsService.createPattern({
          account_id: 1,
          pattern: 'abc',
          pattern_type: 'invalid',
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects duplicates', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await expect(
        patternsService.createPattern({
          account_id: 1,
          pattern: 'abc',
          pattern_type: 'substring',
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('creates a new pattern when no duplicate exists', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 9, account_id: 1, pattern: 'abc', pattern_type: 'regex' }],
        });

      const result = await patternsService.createPattern({
        account_id: 1,
        pattern: 'abc',
        pattern_type: 'regex',
      });

      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.pattern).toMatchObject({ id: 9, pattern_type: 'regex' });
      expect(result.message).toBe('Pattern added successfully');
    });
  });

  describe('removePattern', () => {
    it('validates id and handles not-found', async () => {
      await expect(patternsService.removePattern({})).rejects.toMatchObject({ statusCode: 400 });

      queryMock.mockResolvedValueOnce({ rows: [] });
      await expect(patternsService.removePattern({ id: 333 })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('deletes pattern successfully', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 7, pattern: 'abc' }],
      });

      const result = await patternsService.removePattern({ id: 7 });

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM account_transaction_patterns'),
        [7],
      );
      expect(result.success).toBe(true);
      expect(result.deleted.id).toBe(7);
    });
  });
});
