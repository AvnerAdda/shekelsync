/**
 * Balance Sync Service Tests
 */

const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const {
  syncBankBalanceToInvestments,
  calculateMonthStartBalance,
  getOrCreateBankBalanceAccount,
} = require('../balance-sync');

// Mock database client
const createMockClient = () => {
  const queries = [];
  return {
    query: async (sql, params) => {
      queries.push({ sql, params });
      // Mock responses based on query type
      if (sql.includes('SELECT') && sql.includes('investment_accounts')) {
        return { rows: [] }; // No existing account
      }
      if (sql.includes('INSERT INTO investment_accounts')) {
        return { rows: [{ id: 1, account_name: 'Test Account' }] };
      }
      if (sql.includes('INSERT INTO investment_assets')) {
        return { rows: [{ id: 1 }] };
      }
      if (sql.includes('investment_holdings_history') && sql.includes('SELECT')) {
        return { rows: [] }; // No existing snapshot
      }
      if (sql.includes('COALESCE(SUM(price)')) {
        return { rows: [{ transaction_sum: 1000 }] };
      }
      return { rows: [], rowCount: 1 };
    },
    queries,
  };
};

describe('Balance Sync Service', () => {
  let mockClient;
  let mockLogger;

  beforeEach(() => {
    mockClient = createMockClient();
    mockLogger = {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {},
    };
  });

  describe('getOrCreateBankBalanceAccount', () => {
    it('should create a new investment account for bank balance', async () => {
      const credential = {
        id: 42,
        vendor: 'hapoalim',
        nickname: 'My Checking',
        institution_id: 1,
      };

      const account = await getOrCreateBankBalanceAccount(
        mockClient,
        credential,
        '12345',
        mockLogger
      );

      expect(account).toBeDefined();
      expect(account.account_name).toBe('Test Account');

      // Verify INSERT query was made
      const insertQuery = mockClient.queries.find(q =>
        q.sql.includes('INSERT INTO investment_accounts')
      );
      expect(insertQuery).toBeDefined();
      expect(insertQuery.params).toContain('bank_balance');
      expect(insertQuery.params).toContain(1); // institution_id
    });

    it('should use nickname in account name when available', async () => {
      const credential = {
        id: 42,
        vendor: 'hapoalim',
        nickname: 'My Savings',
        institution_id: 1,
      };

      await getOrCreateBankBalanceAccount(
        mockClient,
        credential,
        null,
        mockLogger
      );

      const insertQuery = mockClient.queries.find(q =>
        q.sql.includes('INSERT INTO investment_accounts')
      );
      expect(insertQuery.params[0]).toContain('My Savings');
    });

    it('should include credential_id in notes', async () => {
      const credential = {
        id: 42,
        vendor: 'hapoalim',
        institution_id: 1,
      };

      await getOrCreateBankBalanceAccount(
        mockClient,
        credential,
        '12345',
        mockLogger
      );

      const insertQuery = mockClient.queries.find(q =>
        q.sql.includes('INSERT INTO investment_accounts')
      );
      const notes = insertQuery.params.find(p =>
        typeof p === 'string' && p.includes('credential_id:42')
      );
      expect(notes).toBeDefined();
    });
  });

  describe('calculateMonthStartBalance', () => {
    it('should calculate month-start balance by subtracting unpaired transactions', async () => {
      const currentBalance = 10000;
      const monthStartDate = '2025-01-01';

      // Mock returns 1000 in transaction_sum
      const result = await calculateMonthStartBalance(
        mockClient,
        'hapoalim',
        '12345',
        currentBalance,
        monthStartDate,
        mockLogger
      );

      expect(result).toBe(9000); // 10000 - 1000

      // Verify query excludes paired transactions
      const sumQuery = mockClient.queries.find(q =>
        q.sql.includes('COALESCE(SUM(price)')
      );
      expect(sumQuery).toBeDefined();
      expect(sumQuery.sql).toContain('פרעון כרטיס אשראי'); // Credit card repayment
      expect(sumQuery.sql).toContain('transaction_account_links');
    });

    it('should handle null account number', async () => {
      await calculateMonthStartBalance(
        mockClient,
        'hapoalim',
        null,
        10000,
        '2025-01-01',
        mockLogger
      );

      const sumQuery = mockClient.queries.find(q =>
        q.sql.includes('COALESCE(SUM(price)')
      );
      expect(sumQuery.params).toContain('hapoalim');
      expect(sumQuery.params).toContain(null); // account_number
    });
  });

  describe('syncBankBalanceToInvestments', () => {
    it('should create account, asset, and holdings', async () => {
      const credential = {
        id: 42,
        vendor: 'hapoalim',
        institution_id: 1,
        nickname: 'Test',
      };

      const result = await syncBankBalanceToInvestments(
        mockClient,
        credential,
        10000,
        '12345',
        mockLogger
      );

      expect(result.success).toBe(true);
      expect(result.currentBalance).toBe(10000);
      expect(result.investmentAccountId).toBeDefined();

      // Verify all necessary inserts
      expect(mockClient.queries.some(q => q.sql.includes('investment_accounts'))).toBe(true);
      expect(mockClient.queries.some(q => q.sql.includes('investment_assets'))).toBe(true);
      expect(mockClient.queries.some(q => q.sql.includes('investment_holdings'))).toBe(true);
      expect(mockClient.queries.some(q => q.sql.includes('investment_holdings_history'))).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      const badClient = {
        query: async () => {
          throw new Error('Database error');
        },
      };

      const credential = {
        id: 42,
        vendor: 'hapoalim',
        institution_id: 1,
      };

      await expect(
        syncBankBalanceToInvestments(badClient, credential, 10000, null, mockLogger)
      ).rejects.toThrow('Database error');
    });

    it('should update asset units to current balance', async () => {
      const credential = {
        id: 42,
        vendor: 'hapoalim',
        institution_id: 1,
      };

      await syncBankBalanceToInvestments(
        mockClient,
        credential,
        15000,
        null,
        mockLogger
      );

      // Verify UPDATE query for asset units
      const updateQuery = mockClient.queries.find(q =>
        q.sql.includes('UPDATE investment_assets') && q.sql.includes('SET units')
      );
      expect(updateQuery).toBeDefined();
      expect(updateQuery.params[0]).toBe(15000);
    });
  });
});
