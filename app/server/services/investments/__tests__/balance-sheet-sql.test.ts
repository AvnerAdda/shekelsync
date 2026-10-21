import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const service = require('../balance-sheet.js');

describe('balance sheet financial calculations on SQLite', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE investment_accounts (
        id INTEGER PRIMARY KEY, account_name TEXT, account_type TEXT,
        investment_category TEXT, account_number TEXT, notes TEXT,
        institution_id INTEGER, currency TEXT DEFAULT 'ILS', is_active INTEGER DEFAULT 1
      );
      CREATE TABLE investment_holdings (
        id INTEGER PRIMARY KEY, account_id INTEGER, current_value REAL, cost_basis REAL,
        as_of_date TEXT, holding_type TEXT DEFAULT 'standard', status TEXT DEFAULT 'active',
        deposit_transaction_id TEXT, deposit_transaction_vendor TEXT
      );
      CREATE TABLE vendor_credentials (
        id INTEGER PRIMARY KEY, vendor TEXT, bank_account_number TEXT,
        current_balance REAL, balance_updated_at TEXT
      );
      CREATE TABLE institution_nodes (id INTEGER PRIMARY KEY, node_type TEXT, vendor_code TEXT);
      CREATE TABLE account_pairings (
        credit_card_vendor TEXT, credit_card_account_number TEXT, bank_vendor TEXT,
        bank_account_number TEXT, match_patterns TEXT, is_active INTEGER DEFAULT 1
      );
      CREATE TABLE transactions (
        identifier TEXT, vendor TEXT, account_number TEXT, date TEXT, price REAL,
        name TEXT, status TEXT DEFAULT 'completed', category_definition_id INTEGER
      );
      CREATE TABLE category_definitions (id INTEGER PRIMARY KEY, name TEXT, name_en TEXT, name_fr TEXT);
      INSERT INTO institution_nodes VALUES (1, 'institution', 'bank');
      INSERT INTO category_definitions VALUES (1, 'repayment', 'Credit Card Repayment', NULL);
    `);
    service.__setDatabase({
      async query(sql: string, params: unknown[] = []) {
        const bindings: any[] = [];
        const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => {
          bindings.push(params[Number(index) - 1]);
          return '?';
        });
        return { rows: db.prepare(sqliteSql).all(...bindings) };
      },
    });
  });

  afterEach(() => {
    service.__resetDatabase();
    db.close();
  });

  function addAccount(type: string, notes: string | null = null, accountNumber = '1234') {
    db.prepare(`INSERT INTO investment_accounts
      (id, account_name, account_type, investment_category, account_number, notes, institution_id)
      VALUES (1, 'Account', ?, 'liquid', ?, ?, 1)`).run(type, accountNumber, notes);
  }

  function addPairing(vendor: string, card: string | null, pattern: string) {
    db.prepare(`INSERT INTO account_pairings
      (credit_card_vendor, credit_card_account_number, bank_vendor, bank_account_number, match_patterns)
      VALUES (?, ?, 'bank', '1234', ?)`).run(vendor, card, JSON.stringify([pattern]));
  }

  function addTransaction(id: string, vendor: string, account: string, date: string, price: number,
    name = 'Purchase', category: number | null = null, status = 'completed') {
    db.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, vendor, account, date, price, name, status, category);
  }

  it.each(['credential_id:10', 'Auto-created. credential_id:10 extra', 'credential_id:10\n'])
  ('matches the full credential id once in %s', async (notes) => {
    addAccount('bank_balance', notes);
    db.exec(`INSERT INTO vendor_credentials VALUES
      (1, 'bank', '1234', 9000, '2026-10-10'),
      (10, 'bank', '1234', 5000, '2026-10-01');`);

    const result = await service.getInvestmentBalanceSheet({ includeAccounts: true });
    expect(result.assets.total).toBe(5000);
    expect(result.assets.buckets.cash.accounts).toHaveLength(1);
  });

  it('selects one latest matching connection for a bank account without a credential marker', async () => {
    addAccount('bank_balance');
    db.exec(`INSERT INTO vendor_credentials VALUES
      (1, 'bank', '1234', 4000, '2026-10-01'),
      (10, 'bank', '1234', 5000, '2026-10-10'),
      (11, 'other-bank', '1234', 99000, '2026-10-11');`);

    const result = await service.getInvestmentBalanceSheet({ includeAccounts: true });
    expect(result.assets.total).toBe(5000);
    expect(result.assets.buckets.cash.accounts).toHaveLength(1);
  });

  it('sums active deposits, including cost-basis fallback, without superseded or closed holdings', async () => {
    addAccount('savings');
    db.exec(`INSERT INTO investment_holdings
      (id, account_id, current_value, cost_basis, as_of_date, holding_type, status) VALUES
      (1, 1, 10000, 10000, '2026-10-01', 'pikadon', 'active'),
      (2, 1, NULL, 20000, '2026-10-02', 'pikadon', NULL),
      (3, 1, 50000, 50000, '2026-10-09', 'pikadon', 'matured'),
      (4, 1, 60000, 60000, '2026-10-10', 'pikadon', 'rolled_over'),
      (5, 1, 99000, 99000, '2026-10-11', 'standard', 'superseded');`);

    const result = await service.getInvestmentBalanceSheet();
    expect(result.assets.total).toBe(30000);
    expect(result.assets.newestUpdateDate).toBe('2026-10-02');
  });

  it('shows zero after all deposits mature without reviving a superseded snapshot', async () => {
    addAccount('savings');
    db.exec(`INSERT INTO investment_holdings
      (id, account_id, current_value, as_of_date, holding_type, status) VALUES
      (1, 1, 10000, '2026-10-01', 'standard', 'superseded'),
      (2, 1, 10000, '2026-10-02', 'pikadon', 'matured');`);

    const result = await service.getInvestmentBalanceSheet();
    expect(result.assets.total).toBe(0);
    expect(result.assets.buckets.liquid.missingValueCount).toBe(0);
  });

  it('still uses the latest standard snapshot instead of summing its history', async () => {
    addAccount('brokerage');
    db.exec(`INSERT INTO investment_holdings (id, account_id, current_value, as_of_date) VALUES
      (1, 1, 10000, '2026-10-01'), (2, 1, 12000, '2026-10-02'), (3, 1, 13000, '2026-10-02');`);
    expect((await service.getInvestmentBalanceSheet()).assets.total).toBe(13000);
  });

  it('nets merchant refunds against purchases for the paired card', async () => {
    addPairing('max', '1111', 'Card 1111');
    addTransaction('paid', 'bank', '1234', '2026-10-01', -500, 'Card 1111', 1);
    addTransaction('purchase', 'max', '1111', '2026-10-02', -500);
    addTransaction('refund', 'max', '1111', '2026-10-03', 100);
    addTransaction('cancelled', 'max', '1111', '2026-10-03', -9000, 'Purchase', null, 'cancelled');
    addTransaction('other-card', 'max', '2222', '2026-10-03', -9000);

    const result = await service.getInvestmentBalanceSheet();
    expect(result.liabilities.pendingCreditCardDebt).toBe(400);
    expect(result.netWorth).toBe(-400);
  });

  it('keeps a card credit when refunds exceed purchases', async () => {
    addPairing('max', '1111', 'Card 1111');
    addTransaction('paid', 'bank', '1234', '2026-10-01', -500, 'Card 1111', 1);
    addTransaction('refund', 'max', '1111', '2026-10-03', 100);
    const result = await service.getInvestmentBalanceSheet();
    expect(result.liabilities.pendingCreditCardDebt).toBe(-100);
    expect(result.netWorth).toBe(100);
  });

  it('uses each card repayment date, even when cards share a provider', async () => {
    addPairing('max', '1111', 'Card 1111');
    addPairing('max', '2222', 'Card 2222');
    addTransaction('paid-a', 'bank', '1234', '2026-10-01', -500, 'Card 1111', 1);
    addTransaction('paid-b', 'bank', '1234', '2026-10-05', -500, 'Card 2222', 1);
    addTransaction('unrelated', 'bank', '9999', '2026-10-09', -500, 'Card 1111', 1);
    addTransaction('unpaid-a', 'max', '1111', '2026-10-03', -300);
    addTransaction('settled-b', 'max', '2222', '2026-10-03', -9000);
    addTransaction('unpaid-b', 'max', '2222', '2026-10-06', -200);

    const result = await service.getInvestmentBalanceSheet();
    expect(result.liabilities.pendingCreditCardDebt).toBe(500);
    expect(result.liabilities.creditCardVendorCount).toBe(1);
  });

  it('keeps debt unknown when one paired card has no repayment baseline', async () => {
    addPairing('max', '1111', 'Card 1111');
    addPairing('max', '2222', 'Card 2222');
    addTransaction('paid-a', 'bank', '1234', '2026-10-01', -500, 'Card 1111', 1);
    addTransaction('unpaid-b', 'max', '2222', '2026-10-03', -300);

    const result = await service.getInvestmentBalanceSheet();
    expect(result.liabilities.pendingCreditCardDebt).toBeNull();
    expect(result.liabilities.pendingCreditCardDebtStatus).toBe('missing_repayment_baseline');
    expect(result.netWorth).toBeNull();
  });

  it('does not use shared automatic provider patterns as another card repayment', async () => {
    addPairing('max', '1111', 'max');
    addPairing('max', '2222', 'max');
    addTransaction('paid-a', 'bank', '1234', '2026-10-01', -500, 'Max 1111', 1);
    addTransaction('paid-b', 'bank', '1234', '2026-10-05', -500, 'Max 2222', 1);
    addTransaction('unpaid-a', 'max', '1111', '2026-10-03', -300);
    addTransaction('unpaid-b', 'max', '2222', '2026-10-06', -200);

    expect((await service.getInvestmentBalanceSheet()).liabilities.pendingCreditCardDebt).toBe(500);
  });

  it('keeps ambiguous provider-only repayments unknown for multiple cards at one bank', async () => {
    addPairing('max', '1111', 'max');
    addPairing('max', '2222', 'max');
    addTransaction('ambiguous', 'bank', '1234', '2026-10-05', -500, 'Max monthly debit', 1);
    addTransaction('unpaid-a', 'max', '1111', '2026-10-03', -300);

    const result = await service.getInvestmentBalanceSheet();
    expect(result.liabilities.pendingCreditCardDebt).toBeNull();
    expect(result.liabilities.pendingCreditCardDebtStatus).toBe('missing_repayment_baseline');
    expect(result.netWorth).toBeNull();
  });

  it('treats repayment name patterns as literal substrings', async () => {
    addPairing('max', null, 'Card_1%');
    addTransaction('paid', 'bank', '1234', '2026-10-01', -500, 'Debit Card_1%', 1);
    addTransaction('unrelated', 'bank', '1234', '2026-10-05', -500, 'Debit CardX123', 1);
    addTransaction('purchase', 'max', '1111', '2026-10-03', -300);
    expect((await service.getInvestmentBalanceSheet()).liabilities.pendingCreditCardDebt).toBe(300);
  });
});
