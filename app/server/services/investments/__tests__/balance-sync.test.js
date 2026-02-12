import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateMonthStartBalance,
  forwardFillForCredential,
  forwardFillMissingDates,
  getLastSnapshot,
  getOrCreateBankBalanceAccount,
  syncBankBalanceToInvestments,
} from '../balance-sync.js';
import { clearInstitutionsCache } from '../../institutions.js';

function createClient(queryImpl) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const sqlText = String(sql);
      calls.push({ sql: sqlText, params });
      return queryImpl(sqlText, params, calls);
    },
  };
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('balance sync service', () => {
  beforeEach(() => {
    clearInstitutionsCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    clearInstitutionsCache();
    vi.useRealTimers();
  });

  describe('getOrCreateBankBalanceAccount', () => {
    it('returns account matched by credential_id notes (strategy 1)', async () => {
      const client = createClient(async (sql) => {
        if (sql.includes('ia.notes LIKE $1')) {
          return { rows: [{ id: 11, account_name: 'Existing Account' }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await getOrCreateBankBalanceAccount(
        client,
        { id: 42, vendor: 'hapoalim', institution_id: 5 },
        '1234',
        createLogger(),
      );

      expect(result).toMatchObject({ id: 11, account_name: 'Existing Account' });
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0].params).toEqual(['%credential_id:42%']);
    });

    it('returns account matched by institution + account number and updates notes (strategy 2)', async () => {
      const client = createClient(async (sql, params) => {
        if (sql.includes('ia.notes LIKE $1')) return { rows: [] };
        if (sql.includes('ia.institution_id = $1') && sql.includes('ia.account_number = $2')) {
          return { rows: [{ id: 22, account_name: 'Institution Match' }] };
        }
        if (sql.includes('UPDATE investment_accounts') && sql.includes('credential_id')) {
          expect(params).toEqual([42, 22]);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await getOrCreateBankBalanceAccount(
        client,
        { id: 42, vendor: 'leumi', institution_id: 8 },
        '5678',
        createLogger(),
      );

      expect(result.id).toBe(22);
      expect(client.calls.some((c) => c.sql.includes('UPDATE investment_accounts'))).toBe(true);
    });

    it('returns single institution account and updates notes (strategy 3)', async () => {
      const client = createClient(async (sql, params) => {
        if (sql.includes('ia.notes LIKE $1')) return { rows: [] };
        if (sql.includes('ia.institution_id = $1') && sql.includes('ia.account_number = $2')) {
          return { rows: [] };
        }
        if (sql.includes('COUNT(*) OVER() as total_count')) {
          return { rows: [{ id: 33, account_name: 'Only One', total_count: '1' }] };
        }
        if (sql.includes('UPDATE investment_accounts') && sql.includes('credential_id')) {
          expect(params).toEqual([7, 33]);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await getOrCreateBankBalanceAccount(
        client,
        { id: 7, vendor: 'hapoalim', institution_id: 4 },
        '9999',
        createLogger(),
      );

      expect(result).toMatchObject({ id: 33, account_name: 'Only One' });
    });

    it('creates a new account when no strategy match exists', async () => {
      const client = createClient(async (sql, params) => {
        if (sql.includes('ia.notes LIKE $1')) return { rows: [] };
        if (sql.includes('ia.institution_id = $1') && sql.includes('ia.account_number = $2')) {
          return { rows: [] };
        }
        if (sql.includes('COUNT(*) OVER() as total_count')) {
          return { rows: [{ id: 44, total_count: '2' }] };
        }
        if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
          return {
            rows: [
              { id: 4, vendor_code: 'hapoalim', display_name_en: 'Hapoalim', display_name_he: 'הפועלים' },
            ],
          };
        }
        if (sql.includes('INSERT INTO investment_accounts')) {
          expect(params[0]).toBe('Hapoalim - Balance (1010)');
          expect(params[1]).toBe('bank_balance');
          expect(params[3]).toBe('1010');
          expect(params[7]).toContain('credential_id:99');
          return { rows: [{ id: 91, account_name: params[0] }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await getOrCreateBankBalanceAccount(
        client,
        { id: 99, vendor: 'hapoalim', institution_id: 4 },
        '1010',
        createLogger(),
      );

      expect(result).toMatchObject({ id: 91, account_name: 'Hapoalim - Balance (1010)' });
    });

    it('uses nickname in new account name and supports null institution id', async () => {
      let vendorLookupQueryCount = 0;
      const client = createClient(async (sql, params) => {
        if (sql.includes('ia.notes LIKE $1')) return { rows: [] };
        if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
          vendorLookupQueryCount += 1;
          return { rows: [] };
        }
        if (sql.includes('WHERE vendor_code = $1') && sql.includes('node_type = \'institution\'')) {
          vendorLookupQueryCount += 1;
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO investment_accounts')) {
          expect(params[0]).toBe('My Savings - Balance');
          expect(params[2]).toBeNull();
          return { rows: [{ id: 55, account_name: params[0] }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await getOrCreateBankBalanceAccount(
        client,
        { id: 5, vendor: 'unknown-bank', nickname: 'My Savings', institution_id: null },
        null,
        createLogger(),
      );

      expect(result.id).toBe(55);
      expect(vendorLookupQueryCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('calculateMonthStartBalance', () => {
    it('subtracts unpaired transaction sum from current balance', async () => {
      const client = createClient(async (sql, params) => {
        if (sql.includes('COALESCE(SUM(price)')) {
          expect(params).toEqual(['hapoalim', '12345', '2026-02-01']);
          return { rows: [{ transaction_sum: '350.5' }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await calculateMonthStartBalance(
        client,
        'hapoalim',
        '12345',
        1000,
        '2026-02-01',
        createLogger(),
      );

      expect(result).toBeCloseTo(649.5, 6);
    });
  });

  describe('getLastSnapshot', () => {
    it('returns null when account has no snapshots', async () => {
      const client = createClient(async () => ({ rows: [] }));
      const result = await getLastSnapshot(client, 7);
      expect(result).toBeNull();
    });

    it('returns the most recent snapshot row when present', async () => {
      const client = createClient(async () => ({
        rows: [{ snapshot_date: '2026-02-19', total_value: '900', cost_basis: '850' }],
      }));

      const result = await getLastSnapshot(client, 7);
      expect(result).toEqual({
        snapshot_date: '2026-02-19',
        total_value: '900',
        cost_basis: '850',
      });
    });
  });

  describe('forwardFillMissingDates', () => {
    it('returns 0 when no previous snapshot exists', async () => {
      const client = createClient(async (sql) => {
        if (sql.includes('SELECT as_of_date as snapshot_date')) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await forwardFillMissingDates(client, 2, '2026-02-20', createLogger());
      expect(result).toBe(0);
      expect(client.calls).toHaveLength(1);
    });

    it('fills each missing date between last snapshot and today', async () => {
      const client = createClient(async (sql, params) => {
        if (sql.includes('SELECT as_of_date as snapshot_date')) {
          return { rows: [{ snapshot_date: '2026-02-01', total_value: '900', cost_basis: '850' }] };
        }
        if (sql.includes('INSERT INTO investment_holdings')) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await forwardFillMissingDates(client, 2, '2026-02-05', createLogger());

      expect(result).toBe(3);
      const inserts = client.calls.filter((c) => c.sql.includes('INSERT INTO investment_holdings'));
      expect(inserts).toHaveLength(3);
      expect(inserts[0].params[3]).toBe('2026-02-02');
      expect(inserts[2].params[3]).toBe('2026-02-04');
    });
  });

  describe('syncBankBalanceToInvestments', () => {
    it('skips when balance is not provided', async () => {
      const client = createClient(async () => {
        throw new Error('Query should not run for skipped sync');
      });

      const result = await syncBankBalanceToInvestments(
        client,
        { id: 1, vendor: 'hapoalim', institution_id: 1 },
        undefined,
        null,
        createLogger(),
      );

      expect(result).toEqual({
        success: true,
        skipped: true,
        reason: 'No balance provided',
      });
    });

    it('skips when balance is invalid', async () => {
      const client = createClient(async () => {
        throw new Error('Query should not run for invalid balance');
      });

      const result = await syncBankBalanceToInvestments(
        client,
        { id: 1, vendor: 'hapoalim', institution_id: 1 },
        'not-a-number',
        null,
        createLogger(),
      );

      expect(result).toEqual({
        success: true,
        skipped: true,
        reason: 'Invalid balance provided',
      });
    });

    it('creates month-start snapshot when missing and writes current snapshot', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-20T10:00:00Z'));

      const client = createClient(async (sql, params) => {
        if (sql.includes('ia.notes LIKE $1')) {
          return { rows: [{ id: 7, account_name: 'Existing Balance Account' }] };
        }
        if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
          return { rows: [{ id: 10, vendor_code: 'hapoalim', display_name_en: 'Hapoalim' }] };
        }
        if (sql.includes('FROM investment_assets') && sql.includes('asset_type = \'cash\'')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO investment_assets')) {
          return { rows: [{ id: 71 }] };
        }
        if (sql.includes('UPDATE investment_assets') && sql.includes('SET units = $1')) {
          expect(params).toEqual([10000, 71]);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT 1 FROM investment_holdings')) {
          return { rows: [] };
        }
        if (sql.includes('COALESCE(SUM(price)')) {
          return { rows: [{ transaction_sum: '250' }] };
        }
        if (sql.includes('SELECT as_of_date as snapshot_date')) {
          return { rows: [{ snapshot_date: '2026-02-19', total_value: '9750', cost_basis: '9750' }] };
        }
        if (sql.includes('INSERT INTO investment_holdings')) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await syncBankBalanceToInvestments(
        client,
        { id: 42, vendor: 'hapoalim', institution_id: 10 },
        10000,
        '12345',
        createLogger(),
      );

      expect(result.success).toBe(true);
      expect(result.investmentAccountId).toBe(7);
      expect(result.currentBalance).toBe(10000);
      expect(result.monthStartSnapshot).toEqual({
        date: '2026-02-01',
        balance: 9750,
      });
      expect(result.snapshotDate).toBe('2026-02-20');
      expect(result.filledDates).toBe(0);

      const holdingsInserts = client.calls.filter((c) => c.sql.includes('INSERT INTO investment_holdings'));
      expect(holdingsInserts.length).toBeGreaterThanOrEqual(2);
      expect(holdingsInserts.some((c) => c.params[4] === 'Auto-calculated month-start balance')).toBe(true);
      expect(holdingsInserts.some((c) => c.params[4] === 'Current balance from scraper')).toBe(true);
    });

    it('skips month-start calculation when month-start snapshot already exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-20T10:00:00Z'));

      const client = createClient(async (sql) => {
        if (sql.includes('ia.notes LIKE $1')) {
          return { rows: [{ id: 18, account_name: 'Existing' }] };
        }
        if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
          return { rows: [] };
        }
        if (sql.includes('FROM institution_nodes') && sql.includes('WHERE vendor_code = $1')) {
          return { rows: [] };
        }
        if (sql.includes('FROM investment_assets') && sql.includes('asset_type = \'cash\'')) {
          return { rows: [{ id: 88, account_id: 18 }] };
        }
        if (sql.includes('UPDATE investment_assets') && sql.includes('SET units = $1')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT 1 FROM investment_holdings')) {
          return { rows: [{ '?column?': 1 }] };
        }
        if (sql.includes('SELECT as_of_date as snapshot_date')) {
          return { rows: [{ snapshot_date: '2026-02-20', total_value: '8000', cost_basis: '8000' }] };
        }
        if (sql.includes('INSERT INTO investment_holdings')) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await syncBankBalanceToInvestments(
        client,
        { id: 2, vendor: 'leumi', institution_id: 2 },
        8200,
        null,
        createLogger(),
      );

      expect(result.success).toBe(true);
      expect(result.monthStartSnapshot).toBeNull();
      expect(client.calls.some((c) => c.sql.includes('COALESCE(SUM(price)'))).toBe(false);
      expect(client.calls.some((c) => c.sql.includes('INSERT INTO investment_assets'))).toBe(false);
    });

    it('returns a safe error object when sync throws internally', async () => {
      const logger = createLogger();
      const client = createClient(async (sql) => {
        if (sql.includes('ia.notes LIKE $1')) {
          return { rows: [{ id: 3, account_name: 'Existing' }] };
        }
        if (sql.includes('FROM institution_nodes') && sql.includes('ORDER BY category, display_order')) {
          return { rows: [] };
        }
        if (sql.includes('FROM institution_nodes') && sql.includes('WHERE vendor_code = $1')) {
          return { rows: [] };
        }
        if (sql.includes('FROM investment_assets') && sql.includes('asset_type = \'cash\'')) {
          return { rows: [{ id: 30, account_id: 3 }] };
        }
        if (sql.includes('UPDATE investment_assets')) {
          throw new Error('update failed');
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await syncBankBalanceToInvestments(
        client,
        { id: 3, vendor: 'hapoalim', institution_id: 3 },
        1000,
        '333',
        logger,
      );

      expect(result).toEqual({
        success: false,
        error: 'update failed',
        vendor: 'hapoalim',
        accountNumber: '333',
      });
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('forwardFillForCredential', () => {
    it('returns zero updates when no bank-balance accounts are found for the credential', async () => {
      const client = createClient(async (sql) => {
        if (sql.includes('FROM investment_accounts') && sql.includes("account_type = 'bank_balance'")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await forwardFillForCredential(
        client,
        { id: 50, vendor: 'hapoalim' },
        createLogger(),
      );

      expect(result).toEqual({
        success: true,
        accountsUpdated: 0,
        datesForwardFilled: 0,
      });
    });

    it('forward-fills account histories and ensures todays snapshot where last value exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-20T08:00:00Z'));

      const snapshotReadsByAccount = { 1: 0, 2: 0 };
      const client = createClient(async (sql, params) => {
        if (sql.includes('FROM investment_accounts') && sql.includes("account_type = 'bank_balance'")) {
          return {
            rows: [
              { id: 1, account_name: 'Account A' },
              { id: 2, account_name: 'Account B' },
            ],
          };
        }
        if (sql.includes('SELECT as_of_date as snapshot_date')) {
          const accountId = params[0];
          snapshotReadsByAccount[accountId] += 1;

          if (accountId === 1) {
            return { rows: [{ snapshot_date: '2026-02-18', total_value: '1000', cost_basis: '1000' }] };
          }

          if (accountId === 2 && snapshotReadsByAccount[2] === 1) {
            return { rows: [{ snapshot_date: '2026-02-18', total_value: '700', cost_basis: '680' }] };
          }

          if (accountId === 2 && snapshotReadsByAccount[2] === 2) {
            return { rows: [] };
          }
        }
        if (sql.includes('INSERT INTO investment_holdings')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      });

      const result = await forwardFillForCredential(
        client,
        { dbId: 8, vendor: 'leumi' },
        createLogger(),
      );

      expect(result).toEqual({
        success: true,
        accountsUpdated: 2,
        datesForwardFilled: 3,
      });

      const todayInsert = client.calls.find(
        (c) =>
          c.sql.includes('INSERT INTO investment_holdings') &&
          c.params[0] === 1 &&
          c.params[5] === 'Forward-filled (no new data from bank)',
      );
      expect(todayInsert).toBeDefined();
    });
  });
});
