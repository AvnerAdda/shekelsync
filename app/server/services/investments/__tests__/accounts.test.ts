import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

let accountsService: any;
let clearInstitutionsCache: () => void;

beforeAll(async () => {
  const module = await import('../accounts.js');
  accountsService = module.default ?? module;

  const institutionsModule = await import('../../institutions.js');
  clearInstitutionsCache = institutionsModule.clearInstitutionsCache;
});

beforeEach(() => {
  queryMock.mockReset();
  clearInstitutionsCache();
  accountsService.__setDatabase({
    query: (...args: any[]) => queryMock(...args),
  });
});

afterEach(() => {
  accountsService.__resetDatabase();
  clearInstitutionsCache();
});

describe('investment accounts service', () => {
  describe('listAccounts', () => {
    it('filters active accounts by default and falls back to vendor institution lookup', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 12,
              account_name: 'Brokerage Main',
              account_type: 'brokerage',
              investment_category: 'liquid',
              is_liquid: true,
              holdings_count: '3',
              current_value: null,
              total_invested: '1234.56',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 7, vendor_code: 'brokerage', display_name_en: 'Broker' }],
        });

      const result = await accountsService.listAccounts();

      expect(queryMock).toHaveBeenCalledTimes(2);
      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).toContain('ia.is_active = true');
      expect(params).toEqual([]);
      expect(result.accounts[0]).toMatchObject({
        holdings_count: 3,
        current_value: 1234.56,
        current_value_explicit: null,
        total_invested: 1234.56,
      });
      expect(result.accounts[0].institution).toMatchObject({ vendor_code: 'brokerage' });
    });

    it('supports includeInactive and category filters and preserves explicit value', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 21,
            account_name: 'Pension',
            account_type: 'pension',
            investment_category: 'restricted',
            is_liquid: false,
            holdings_count: '1',
            current_value: '5000',
            total_invested: '4800',
            institution_id: 11,
            institution_vendor_code: 'pension',
          },
        ],
      });

      const result = await accountsService.listAccounts({
        includeInactive: true,
        category: 'restricted',
      });

      const [sql, params] = queryMock.mock.calls[0];
      expect(sql).not.toContain('ia.is_active = true');
      expect(sql).toContain('ia.investment_category = $1');
      expect(params).toEqual(['restricted']);
      expect(result.accounts[0].current_value).toBe(5000);
      expect(result.accounts[0].current_value_explicit).toBe(5000);
      expect(result.accounts[0].institution).toMatchObject({ vendor_code: 'pension' });
    });
  });

  describe('createAccount', () => {
    it('validates required fields and valid type', async () => {
      await expect(accountsService.createAccount({})).rejects.toMatchObject({ status: 400 });

      await expect(
        accountsService.createAccount({
          account_name: 'Bad',
          account_type: 'not-a-real-type',
          institution_id: 1,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('fails when institution cannot be resolved', async () => {
      queryMock.mockResolvedValue({ rows: [] });

      await expect(
        accountsService.createAccount({
          account_name: 'No Institution',
          account_type: 'insurance',
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('institution_id is required'),
      });
    });

    it('sets liquid category fields when institution is provided', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO investment_accounts')) {
          return { rows: [{ id: 44 }] };
        }
        if (sql.includes('FROM investment_accounts ia') && sql.includes('WHERE ia.id = $1')) {
          return {
            rows: [
              {
                id: 44,
                account_name: 'Brokerage',
                account_type: 'brokerage',
                institution_id: 99,
                institution_vendor_code: 'brokerage',
              },
            ],
          };
        }
        return { rows: [] };
      });

      const result = await accountsService.createAccount({
        account_name: 'Brokerage',
        account_type: 'brokerage',
        institution_id: 99,
      });

      expect(queryMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      const insertCall = queryMock.mock.calls.find(([sql]) =>
        String(sql).includes('INSERT INTO investment_accounts'),
      );
      expect(insertCall).toBeTruthy();
      const insertParams = insertCall![1];
      expect(insertParams[0]).toBe('Brokerage');
      expect(insertParams[1]).toBe('brokerage');
      expect(insertParams[6]).toBe(true);
      expect(insertParams[7]).toBe('liquid');
      expect(insertParams[8]).toBe(99);
      expect(result.account.institution).toMatchObject({ vendor_code: 'brokerage' });
    });

    it('sets restricted category for pension accounts', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 5, account_type: 'pension', institution_id: 4, institution_vendor_code: 'pension' }],
        });

      await accountsService.createAccount({
        account_name: 'Pension Plan',
        account_type: 'pension',
        institution_id: 4,
      });

      const insertParams = queryMock.mock.calls[0][1];
      expect(insertParams[6]).toBe(false);
      expect(insertParams[7]).toBe('restricted');
    });

    it('sets cash category for cash accounts', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 6 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 6, account_type: 'cash', institution_id: 8, institution_vendor_code: 'cash' }],
        });

      await accountsService.createAccount({
        account_name: 'Cash Wallet',
        account_type: 'cash',
        institution_id: 8,
      });

      const insertParams = queryMock.mock.calls[0][1];
      expect(insertParams[6]).toBe(true);
      expect(insertParams[7]).toBe('cash');
    });
  });

  describe('updateAccount', () => {
    it('validates required id and rejects invalid payloads', async () => {
      await expect(accountsService.updateAccount({})).rejects.toMatchObject({ status: 400 });

      await expect(
        accountsService.updateAccount({ id: 1, account_type: 'invalid' }),
      ).rejects.toMatchObject({ status: 400 });

      await expect(
        accountsService.updateAccount({ id: 1, is_active: 'maybe' }),
      ).rejects.toMatchObject({ status: 400 });

      await expect(
        accountsService.updateAccount({ id: 1, institution_id: null }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects empty updates', async () => {
      await expect(accountsService.updateAccount({ id: 77 })).rejects.toMatchObject({ status: 400 });
    });

    it('updates account_type metadata and normalizes boolean is_active', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 15, vendor_code: 'bank_balance' }] })
        .mockResolvedValueOnce({ rows: [{ id: 9 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 9, account_type: 'bank_balance', institution_id: 15, institution_vendor_code: 'bank_balance' }],
        });

      const result = await accountsService.updateAccount({
        id: 9,
        account_type: 'bank_balance',
        is_active: 'false',
        notes: 'Updated',
      });

      const [updateSql, updateParams] = queryMock.mock.calls[1];
      expect(updateSql).toContain('account_type = $1');
      expect(updateSql).toContain('is_liquid = $2');
      expect(updateSql).toContain('investment_category = $3');
      expect(updateSql).toContain('institution_id = $4');
      expect(updateSql).toContain('is_active = $5');
      expect(updateParams).toEqual([
        'bank_balance',
        true,
        'cash',
        15,
        false,
        'Updated',
        9,
      ]);
      expect(result.account.institution).toMatchObject({ vendor_code: 'bank_balance' });
    });

    it('throws not found when account does not exist', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(
        accountsService.updateAccount({ id: 404, notes: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('updates account_name/institution/account_number/currency and normalizes is_active="true"', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 41 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 41, account_type: 'brokerage', institution_id: 9, institution_vendor_code: 'brokerage' }],
        });

      const result = await accountsService.updateAccount({
        id: 41,
        account_name: 'Renamed Account',
        institution: 'My Bank',
        institution_id: 9,
        account_number: '1234',
        currency: 'USD',
        is_active: 'true',
        notes: 'updated notes',
      });

      const [updateSql, updateParams] = queryMock.mock.calls[0];
      expect(updateSql).toContain('account_name = $1');
      expect(updateSql).toContain('institution = $2');
      expect(updateSql).toContain('institution_id = $3');
      expect(updateSql).toContain('account_number = $4');
      expect(updateSql).toContain('currency = $5');
      expect(updateSql).toContain('is_active = $6');
      expect(updateSql).toContain('notes = $7');
      expect(updateParams).toEqual([
        'Renamed Account',
        'My Bank',
        9,
        '1234',
        'USD',
        true,
        'updated notes',
        41,
      ]);
      expect(result.account.id).toBe(41);
    });

    it('accepts boolean is_active values directly', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 42 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 42, account_type: 'brokerage', institution_id: 9, institution_vendor_code: 'brokerage' }],
        });

      await accountsService.updateAccount({
        id: 42,
        is_active: true,
      });

      expect(queryMock.mock.calls[0][1]).toEqual([true, 42]);
    });

    it.each([
      ['brokerage', true, 'liquid'],
      ['pension', false, 'restricted'],
      ['insurance', false, 'stability'],
    ])(
      'maps account_type %s to is_liquid=%s and investment_category=%s',
      async (accountType, expectedLiquid, expectedCategory) => {
        queryMock
          .mockResolvedValueOnce({ rows: [{ id: 55, vendor_code: accountType }] })
          .mockResolvedValueOnce({ rows: [{ id: 55 }] })
          .mockResolvedValueOnce({
            rows: [{ id: 55, account_type: accountType, institution_id: 55, institution_vendor_code: accountType }],
          });

        await accountsService.updateAccount({
          id: 55,
          account_type: accountType,
        });

        const updateCall = queryMock.mock.calls.find(([sql]) =>
          String(sql).includes('UPDATE investment_accounts'),
        );
        expect(updateCall).toBeTruthy();
        const updateParams = updateCall![1];
        expect(updateParams[0]).toBe(accountType);
        expect(updateParams[1]).toBe(expectedLiquid);
        expect(updateParams[2]).toBe(expectedCategory);
        expect(typeof updateParams[3]).toBe('number');
        expect(updateParams[3]).toBeGreaterThan(0);
      },
    );
  });

  describe('deactivateAccount', () => {
    it('accepts id or account_id and deactivates existing account', async () => {
      queryMock.mockResolvedValueOnce({ rows: [{ id: 3, is_active: false }] });
      const result = await accountsService.deactivateAccount({ account_id: 3 });

      expect(result.message).toBe('Account deactivated');
      expect(result.account.id).toBe(3);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('is_active = false'),
        [3],
      );
    });

    it('throws 400 for missing id and 404 for unknown account', async () => {
      await expect(accountsService.deactivateAccount({})).rejects.toMatchObject({ status: 400 });

      queryMock.mockResolvedValueOnce({ rows: [] });
      await expect(accountsService.deactivateAccount({ id: 999 })).rejects.toMatchObject({ status: 404 });
    });
  });
});
