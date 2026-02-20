import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const esModuleMocks = vi.hoisted(() => ({
  analyzeInvestmentTransactions: vi.fn(),
  linkMultipleTransactions: vi.fn(),
}));

const serviceStubs = vi.hoisted(() => ({
  getExistingInvestments: vi.fn(),
  getInvestmentHistory: vi.fn(),
  getBankBalanceSummary: vi.fn(),
}));

vi.mock('../../services/investments/check-existing.js', () => ({
  getExistingInvestments: serviceStubs.getExistingInvestments,
  default: {
    getExistingInvestments: serviceStubs.getExistingInvestments,
  },
}));

vi.mock('../../services/investments/history.js', () => ({
  getInvestmentHistory: serviceStubs.getInvestmentHistory,
  default: {
    getInvestmentHistory: serviceStubs.getInvestmentHistory,
  },
}));

vi.mock('../../services/investments/bank-summary.js', () => ({
  getBankBalanceSummary: serviceStubs.getBankBalanceSummary,
  default: {
    getBankBalanceSummary: serviceStubs.getBankBalanceSummary,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  createInvestmentsRouter,
  __setESModulesForTests,
  __resetESModulesForTests,
} = require('../../routes/investments.js');

// Services
// eslint-disable-next-line @typescript-eslint/no-var-requires
const patternsService = require('../../services/investments/patterns.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pendingSuggestionsService = require('../../services/investments/pending-suggestions.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const costBasisService = require('../../services/investments/suggest-cost-basis.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const accountsService = require('../../services/investments/accounts.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const checkExistingService = require('../../services/investments/check-existing.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const historyService = require('../../services/investments/history.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const assetsService = require('../../services/investments/assets.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const holdingsService = require('../../services/investments/holdings.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const summaryService = require('../../services/investments/summary.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const manualMatchingService = require('../../services/investments/manual-matching.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bankSummaryService = require('../../services/investments/bank-summary.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const suggestionAnalyzerCJS = require('../../services/investments/suggestion-analyzer-cjs.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const database = require('../../services/database.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pikadonService = require('../../services/investments/pikadon.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/investments', createInvestmentsRouter());
  return app;
}

describe('Shared /api/investments routes', () => {
  let app: express.Express;

  beforeEach(() => {
    __setESModulesForTests({
      suggestionAnalyzer: {
        analyzeInvestmentTransactions: esModuleMocks.analyzeInvestmentTransactions,
      },
      autoLinker: {
        linkMultipleTransactions: esModuleMocks.linkMultipleTransactions,
      },
    });
    app = buildApp();
  });

  afterEach(() => {
    __resetESModulesForTests();
    vi.restoreAllMocks();
    esModuleMocks.analyzeInvestmentTransactions.mockReset();
    esModuleMocks.linkMultipleTransactions.mockReset();
  });

  it('returns pending suggestions', async () => {
    vi.spyOn(pendingSuggestionsService, 'listPendingSuggestions').mockResolvedValue({
      pendingSuggestions: [],
      total: 0,
    });

    const res = await request(app).get('/api/investments/pending-suggestions').expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.pending_suggestions)).toBe(true);
  });

  it('applies pending suggestion actions and surfaces service errors', async () => {
    const applySpy = vi
      .spyOn(pendingSuggestionsService, 'applySuggestionAction')
      .mockResolvedValue({
        action: 'linked',
        message: 'linked successfully',
        linkCreated: { id: 'link-1' },
      });

    const ok = await request(app)
      .post('/api/investments/pending-suggestions')
      .send({ action: 'link', suggestionId: 's-1' })
      .expect(200);

    expect(ok.body.success).toBe(true);
    expect(ok.body.action).toBe('linked');
    expect(ok.body.link_created).toEqual({ id: 'link-1' });
    expect(applySpy).toHaveBeenCalledWith({ action: 'link', suggestionId: 's-1' });

    vi.spyOn(pendingSuggestionsService, 'applySuggestionAction').mockRejectedValueOnce({
      status: 409,
      message: 'already linked',
    });

    const err = await request(app)
      .post('/api/investments/pending-suggestions')
      .send({ action: 'link', suggestionId: 's-2' })
      .expect(409);

    expect(err.body.success).toBe(false);
    expect(err.body.error).toBe('already linked');
  });

  it('creates a new investment pattern', async () => {
    const payload = { id: 'pattern-1' };
    const spy = vi.spyOn(patternsService, 'createPattern').mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/investments/patterns')
      .send({ vendor: 'test' })
      .expect(201);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ vendor: 'test' });
  });

  it('lists investment accounts', async () => {
    const accounts = [{ id: 'acct-1' }];
    vi.spyOn(accountsService, 'listAccounts').mockResolvedValue(accounts);

    const res = await request(app).get('/api/investments/accounts').expect(200);

    expect(res.body).toEqual(accounts);
  });

  it('creates, updates, and deactivates investment accounts', async () => {
    const createSpy = vi.spyOn(accountsService, 'createAccount').mockResolvedValue({ id: 'acct-2' });
    const updateSpy = vi.spyOn(accountsService, 'updateAccount').mockResolvedValue({ id: 'acct-2', nickname: 'Main' });
    const deactivateSpy = vi.spyOn(accountsService, 'deactivateAccount').mockResolvedValue({ success: true });

    const created = await request(app)
      .post('/api/investments/accounts')
      .send({ account_name: 'Brokerage A' })
      .expect(201);
    expect(created.body).toEqual({ id: 'acct-2' });
    expect(createSpy).toHaveBeenCalledWith({ account_name: 'Brokerage A' });

    const updated = await request(app)
      .put('/api/investments/accounts')
      .send({ id: 'acct-2', nickname: 'Main' })
      .expect(200);
    expect(updated.body.nickname).toBe('Main');
    expect(updateSpy).toHaveBeenCalledWith({ id: 'acct-2', nickname: 'Main' });

    const deleted = await request(app)
      .delete('/api/investments/accounts?id=acct-2')
      .expect(200);
    expect(deleted.body.success).toBe(true);
    expect(deactivateSpy).toHaveBeenCalledWith({ id: 'acct-2' });
  });

  it('updates an investment holding', async () => {
    const holding = { id: 'holding-1' };
    const spy = vi.spyOn(holdingsService, 'upsertHolding').mockResolvedValue(holding);

    const res = await request(app)
      .post('/api/investments/holdings')
      .send({ id: 'holding-1' })
      .expect(201);

    expect(res.body).toEqual(holding);
    expect(spy).toHaveBeenCalledWith({ id: 'holding-1' });
  });

  it('handles cost basis errors', async () => {
    vi.spyOn(costBasisService, 'suggestCostBasis').mockRejectedValue({
      status: 422,
      message: 'Invalid request',
    });

    const res = await request(app)
      .get('/api/investments/suggest-cost-basis')
      .expect(422);

    expect(res.body.error).toMatch(/invalid request/i);
  });

  it('returns investment summary', async () => {
    const summary = { totalPortfolioValue: 1234 };
    vi.spyOn(summaryService, 'getInvestmentSummary').mockResolvedValue(summary);

    const res = await request(app).get('/api/investments/summary').expect(200);

    expect(res.body).toEqual(summary);
  });

  it('checks existing investments and lists patterns', async () => {
    vi.spyOn(checkExistingService, 'getExistingInvestments').mockResolvedValue({ exists: true });
    vi.spyOn(patternsService, 'listPatterns').mockResolvedValue([{ id: 'p1' }]);

    const existing = await request(app).get('/api/investments/check-existing?vendor=acme').expect(200);
    expect(existing.body.exists).toBe(true);

    const patterns = await request(app).get('/api/investments/patterns').expect(200);
    expect(patterns.body).toEqual([{ id: 'p1' }]);
  });

  it('returns investments history and surfaces history errors', async () => {
    vi.spyOn(historyService, 'getInvestmentHistory').mockResolvedValue({ history: [{ date: '2025-01-01' }] });

    const ok = await request(app).get('/api/investments/history?months=6').expect(200);
    expect(ok.body).toEqual({ history: [{ date: '2025-01-01' }] });

    vi.spyOn(historyService, 'getInvestmentHistory').mockRejectedValueOnce({
      statusCode: 418,
      message: 'teapot',
    });

    const err = await request(app).get('/api/investments/history').expect(418);
    expect(err.body.error).toBe('teapot');
  });

  it('lists assets and returns bank summary', async () => {
    vi.spyOn(assetsService, 'listAssets').mockResolvedValue([{ id: 'a1' }]);
    vi.spyOn(bankSummaryService, 'getBankBalanceSummary').mockResolvedValue({ balances: [] });

    const assets = await request(app).get('/api/investments/assets').expect(200);
    expect(assets.body).toEqual([{ id: 'a1' }]);

    const bank = await request(app).get('/api/investments/bank-summary').expect(200);
    expect(bank.body).toEqual({ balances: [] });
  });

  it('validates transaction link inputs and returns 400s', async () => {
    const resCreate = await request(app).post('/api/investments/transaction-links').send({}).expect(400);
    expect(resCreate.body.error).toMatch(/transaction_identifier/);

    const resList = await request(app).get('/api/investments/transaction-links').expect(400);
    expect(resList.body.error).toMatch(/account_id/);

    const resDelete = await request(app)
      .delete('/api/investments/transaction-links?transaction_identifier=1')
      .expect(400);
    expect(resDelete.body.error).toMatch(/transaction_vendor/);
  });

  it('returns 400 when manual matching required params are missing', async () => {
    const unmatched = await request(app).get('/api/investments/manual-matching/unmatched-repayments').expect(400);
    expect(unmatched.body.error).toMatch(/Missing required parameters/);

    const available = await request(app).get('/api/investments/manual-matching/available-expenses').expect(400);
    expect(available.body.error).toMatch(/Missing required parameters/);
  });

  it('validates and saves manual matches with parsed tolerance', async () => {
    const missing = await request(app)
      .post('/api/investments/manual-matching/save-match')
      .send({ repaymentTxnId: 'r-1' })
      .expect(400);
    expect(missing.body.error).toMatch(/Missing required parameters/);

    const saveSpy = vi.spyOn(manualMatchingService, 'saveManualMatch').mockResolvedValue({
      matchId: 'm-1',
      matchedCount: 2,
    });

    const ok = await request(app)
      .post('/api/investments/manual-matching/save-match')
      .send({
        repaymentTxnId: 'r-1',
        repaymentVendor: 'hapoalim',
        repaymentDate: '2025-01-31',
        repaymentAmount: 1234,
        ccVendor: 'isracard',
        expenses: [{ identifier: 'tx-1', vendor: 'isracard', amount: 1234 }],
        tolerance: '2.5',
      })
      .expect(200);

    expect(ok.body.success).toBe(true);
    expect(ok.body.matchId).toBe('m-1');
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      repaymentTxnId: 'r-1',
      cardNumber: null,
      tolerance: 2.5,
    }));
  });

  it('returns 400 for invalid suggestions dismiss payload', async () => {
    const res = await request(app).post('/api/investments/suggestions/dismiss').send({}).expect(400);
    expect(res.body.error).toMatch(/transactionIdentifiers/);
  });

  it('returns smart suggestions and parses thresholdDays as integer', async () => {
    const spy = vi
      .spyOn(suggestionAnalyzerCJS, 'analyzeInvestmentTransactions')
      .mockResolvedValue([{ id: 's1' }]);

    const res = await request(app)
      .get('/api/investments/smart-suggestions?thresholdDays=120')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(spy).toHaveBeenCalledWith(120);
  });

  it('loads ES-module analyzers for analyze-transactions and suggestions/pending routes', async () => {
    esModuleMocks.analyzeInvestmentTransactions
      .mockResolvedValueOnce([{ id: 'es-1' }])
      .mockResolvedValueOnce([{ id: 'es-2' }, { id: 'es-3' }]);

    const analyzed = await request(app)
      .post('/api/investments/analyze-transactions')
      .send({ thresholdDays: 45 })
      .expect(200);

    expect(analyzed.body.success).toBe(true);
    expect(analyzed.body.count).toBe(1);

    const pending = await request(app)
      .get('/api/investments/suggestions/pending?thresholdDays=60&dismissalThreshold=4')
      .expect(200);

    expect(pending.body.success).toBe(true);
    expect(pending.body.count).toBe(2);
    expect(pending.body.threshold).toBe(4);
    expect(esModuleMocks.analyzeInvestmentTransactions).toHaveBeenNthCalledWith(1, 45);
    expect(esModuleMocks.analyzeInvestmentTransactions).toHaveBeenNthCalledWith(2, 60);
  });

  it('dismisses suggestions and writes one row per transaction identifier', async () => {
    const querySpy = vi.spyOn(database, 'query').mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/investments/suggestions/dismiss')
      .send({
        transactionIdentifiers: [
          { identifier: 'tx-1', vendor: 'v-1' },
          { identifier: 'tx-2', vendor: 'v-2' },
        ],
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.dismissedCount).toBe(2);
    expect(querySpy).toHaveBeenCalledTimes(2);
    expect(querySpy.mock.calls[0][1]).toEqual(['tx-1', 'v-1']);
    expect(querySpy.mock.calls[1][1]).toEqual(['tx-2', 'v-2']);
  });

  it('creates, lists, and deletes transaction links', async () => {
    const querySpy = vi.spyOn(database, 'query')
      // create: find transaction date
      .mockResolvedValueOnce({ rows: [{ date: '2025-01-15' }] })
      // create: upsert link
      .mockResolvedValueOnce({ rows: [] })
      // list links
      .mockResolvedValueOnce({
        rows: [{ transaction_identifier: 'tx-1', transaction_vendor: 'v-1', account_id: 7 }],
      })
      // delete link
      .mockResolvedValueOnce({ rows: [] });

    const created = await request(app)
      .post('/api/investments/transaction-links')
      .send({
        transaction_identifier: 'tx-1',
        transaction_vendor: 'v-1',
        account_id: 7,
      })
      .expect(201);

    expect(created.body.success).toBe(true);
    expect(created.body.link.account_id).toBe(7);

    const listed = await request(app)
      .get('/api/investments/transaction-links?account_id=7')
      .expect(200);
    expect(listed.body.count).toBe(1);
    expect(Array.isArray(listed.body.links)).toBe(true);

    const deleted = await request(app)
      .delete('/api/investments/transaction-links?transaction_identifier=tx-1&transaction_vendor=v-1')
      .expect(200);
    expect(deleted.body.success).toBe(true);

    expect(querySpy).toHaveBeenCalledTimes(4);
  });

  it('returns 404 when creating transaction link for a missing transaction', async () => {
    vi.spyOn(database, 'query').mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/investments/transaction-links')
      .send({
        transaction_identifier: 'missing',
        transaction_vendor: 'v-1',
        account_id: 7,
      })
      .expect(404);

    expect(res.body.error).toMatch(/Transaction not found/);
  });

  it('validates and returns processed-dates for manual matching', async () => {
    const missing = await request(app)
      .get('/api/investments/manual-matching/processed-dates')
      .expect(400);
    expect(missing.body.error).toMatch(/creditCardVendor/);

    vi.spyOn(manualMatchingService, 'getAvailableProcessedDates').mockResolvedValue(['2025-01-01']);

    const ok = await request(app)
      .get('/api/investments/manual-matching/processed-dates?creditCardVendor=isracard')
      .expect(200);

    expect(ok.body.success).toBe(true);
    expect(ok.body.count).toBe(1);
    expect(ok.body.processedDates).toEqual(['2025-01-01']);
  });

  it('returns 400 for invalid matchPatterns JSON before calling manual matching service', async () => {
    const spy = vi.spyOn(manualMatchingService, 'getUnmatchedRepayments').mockResolvedValue([]);

    const res = await request(app)
      .get('/api/investments/manual-matching/unmatched-repayments')
      .query({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        matchPatterns: 'not-json',
      })
      .expect(400);

    expect(res.body.error).toMatch(/Invalid matchPatterns format/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns pikadon payloads', async () => {
    vi.spyOn(pikadonService, 'listPikadon').mockResolvedValue([{ id: 1 }]);
    vi.spyOn(pikadonService, 'getPikadonSummary').mockResolvedValue({ count: 1 });
    vi.spyOn(pikadonService, 'detectPikadonPairs').mockResolvedValue({ pairs: [] });

    const list = await request(app).get('/api/investments/pikadon').expect(200);
    expect(list.body).toEqual([{ id: 1 }]);

    const summary = await request(app).get('/api/investments/pikadon/summary').expect(200);
    expect(summary.body).toEqual({ count: 1 });

    const detect = await request(app).get('/api/investments/pikadon/detect').expect(200);
    expect(detect.body).toEqual({ pairs: [] });
  });

  it('deletes patterns and manages assets plus holdings', async () => {
    const removePatternSpy = vi.spyOn(patternsService, 'removePattern').mockResolvedValue({ success: true });
    const createAssetSpy = vi.spyOn(assetsService, 'createAsset').mockResolvedValue({ id: 'asset-1' });
    const updateAssetSpy = vi.spyOn(assetsService, 'updateAsset').mockResolvedValue({ id: 'asset-1', ticker: 'AAPL' });
    const deactivateAssetSpy = vi.spyOn(assetsService, 'deactivateAsset').mockResolvedValue({ success: true });
    const listHoldingsSpy = vi.spyOn(holdingsService, 'listHoldings').mockResolvedValue([{ id: 'holding-1' }]);
    const deleteHoldingSpy = vi.spyOn(holdingsService, 'deleteHolding').mockResolvedValue({ success: true });

    const removed = await request(app).delete('/api/investments/patterns?id=pattern-1').expect(200);
    expect(removed.body.success).toBe(true);
    expect(removePatternSpy).toHaveBeenCalledWith({ id: 'pattern-1' });

    const createdAsset = await request(app)
      .post('/api/investments/assets')
      .send({ ticker: 'AAPL', asset_type: 'stock' })
      .expect(201);
    expect(createdAsset.body).toEqual({ id: 'asset-1' });
    expect(createAssetSpy).toHaveBeenCalledWith({ ticker: 'AAPL', asset_type: 'stock' });

    const updatedAsset = await request(app)
      .put('/api/investments/assets')
      .send({ id: 'asset-1', ticker: 'AAPL' })
      .expect(200);
    expect(updatedAsset.body.ticker).toBe('AAPL');
    expect(updateAssetSpy).toHaveBeenCalledWith({ id: 'asset-1', ticker: 'AAPL' });

    const deletedAsset = await request(app).delete('/api/investments/assets?id=asset-1').expect(200);
    expect(deletedAsset.body.success).toBe(true);
    expect(deactivateAssetSpy).toHaveBeenCalledWith({ id: 'asset-1' });

    const holdings = await request(app).get('/api/investments/holdings?account_id=9').expect(200);
    expect(holdings.body).toEqual([{ id: 'holding-1' }]);
    expect(listHoldingsSpy).toHaveBeenCalledWith({ account_id: '9' });

    const deletedHolding = await request(app).delete('/api/investments/holdings?id=holding-1').expect(200);
    expect(deletedHolding.body.success).toBe(true);
    expect(deleteHoldingSpy).toHaveBeenCalledWith({ id: 'holding-1' });
  });

  it('creates account and holding from suggestion without auto-linking', async () => {
    const createAccountSpy = vi.spyOn(accountsService, 'createAccount').mockResolvedValue({
      account: { id: 44, account_name: 'Long-Term Savings' },
    });
    const upsertHoldingSpy = vi.spyOn(holdingsService, 'upsertHolding').mockResolvedValue({
      holding: { id: 'h-44', account_id: 44 },
    });

    const res = await request(app)
      .post('/api/investments/suggestions/create-from-suggestion')
      .send({
        accountDetails: { account_name: 'Long-Term Savings', account_type: 'brokerage' },
        holdingDetails: { current_value: 25000, cost_basis: 24000, as_of_date: '2025-01-01' },
        transactions: [],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.account.id).toBe(44);
    expect(res.body.holding.id).toBe('h-44');
    expect(res.body.linkResult).toBeNull();
    expect(res.body.message).toMatch(/0 linked transactions/);
    expect(createAccountSpy).toHaveBeenCalledWith({
      account_name: 'Long-Term Savings',
      account_type: 'brokerage',
    });
    expect(upsertHoldingSpy).toHaveBeenCalledWith(expect.objectContaining({
      account_id: 44,
      save_history: true,
    }));
  });

  it('creates account from suggestion and auto-links provided transactions', async () => {
    vi.spyOn(accountsService, 'createAccount').mockResolvedValue({
      account: { id: 55, account_name: 'Retirement Bucket' },
    });
    vi.spyOn(holdingsService, 'upsertHolding').mockResolvedValue({
      holding: { id: 'h-55', account_id: 55 },
    });
    esModuleMocks.linkMultipleTransactions.mockResolvedValue({
      successCount: 2,
      failedCount: 0,
    });

    const transactions = [
      { transactionIdentifier: 'tx-1', transactionVendor: 'bank-a' },
      { transactionIdentifier: 'tx-2', transactionVendor: 'bank-b' },
    ];

    const res = await request(app)
      .post('/api/investments/suggestions/create-from-suggestion')
      .send({
        accountDetails: { account_name: 'Retirement Bucket' },
        holdingDetails: { current_value: 50000, cost_basis: 45000, as_of_date: '2025-01-01' },
        transactions,
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.linkResult.successCount).toBe(2);
    expect(esModuleMocks.linkMultipleTransactions).toHaveBeenCalledWith(
      55,
      transactions,
      'auto',
      0.95,
    );
  });

  it('validates create-from-suggestion payload and handles missing created account id', async () => {
    const missing = await request(app)
      .post('/api/investments/suggestions/create-from-suggestion')
      .send({})
      .expect(400);
    expect(missing.body.error).toMatch(/accountDetails and holdingDetails are required/i);

    vi.spyOn(accountsService, 'createAccount').mockResolvedValue({});

    const failed = await request(app)
      .post('/api/investments/suggestions/create-from-suggestion')
      .send({
        accountDetails: { account_name: 'Broken Account' },
        holdingDetails: { current_value: 100, cost_basis: 100, as_of_date: '2025-01-01' },
      })
      .expect(500);

    expect(failed.body.error).toBe('Failed to create investment account');
  });

  it('returns available expenses and bank repayments with parsed matchPatterns', async () => {
    const expensesSpy = vi.spyOn(manualMatchingService, 'getAvailableExpenses').mockResolvedValue([
      { identifier: 'txn-exp-1', amount: 300 },
    ]);

    const withSmartDate = await request(app)
      .get('/api/investments/manual-matching/available-expenses')
      .query({
        repaymentDate: '2025-01-31',
        creditCardVendor: 'isracard',
        creditCardAccountNumber: '1234',
        processedDate: '2025-01-15',
      })
      .expect(200);

    expect(withSmartDate.body.success).toBe(true);
    expect(withSmartDate.body.smartDateUsed).toBe(true);
    expect(expensesSpy).toHaveBeenCalledWith({
      repaymentDate: '2025-01-31',
      creditCardAccountNumber: '1234',
      creditCardVendor: 'isracard',
      processedDate: '2025-01-15',
    });

    const withoutSmartDate = await request(app)
      .get('/api/investments/manual-matching/available-expenses')
      .query({
        repaymentDate: '2025-01-31',
        creditCardVendor: 'isracard',
      })
      .expect(200);
    expect(withoutSmartDate.body.smartDateUsed).toBe(false);

    const invalidPatterns = await request(app)
      .get('/api/investments/manual-matching/bank-repayments-for-date')
      .query({
        processedDate: '2025-01-15',
        bankVendor: 'hapoalim',
        matchPatterns: 'not-json',
      })
      .expect(400);
    expect(invalidPatterns.body.error).toMatch(/Invalid matchPatterns format/i);

    const repaymentsSpy = vi.spyOn(manualMatchingService, 'getBankRepaymentsForProcessedDate').mockResolvedValue({
      repayments: [{ identifier: 'bank-1', amount: 300 }],
      count: 1,
    });

    const repayments = await request(app)
      .get('/api/investments/manual-matching/bank-repayments-for-date')
      .query({
        processedDate: '2025-01-15',
        bankVendor: 'hapoalim',
        matchPatterns: JSON.stringify(['monthly-repayment']),
      })
      .expect(200);

    expect(repayments.body.success).toBe(true);
    expect(repayments.body.count).toBe(1);
    expect(repaymentsSpy).toHaveBeenCalledWith({
      processedDate: '2025-01-15',
      bankVendor: 'hapoalim',
      bankAccountNumber: null,
      matchPatterns: ['monthly-repayment'],
    });
  });

  it('validates and returns manual matching stats and weekly stats', async () => {
    const missingStats = await request(app)
      .get('/api/investments/manual-matching/stats')
      .expect(400);
    expect(missingStats.body.error).toMatch(/bankVendor/i);

    const statsSpy = vi.spyOn(manualMatchingService, 'getMatchingStats').mockResolvedValue({
      matchedCount: 12,
      unmatchedCount: 2,
    });

    const stats = await request(app)
      .get('/api/investments/manual-matching/stats?bankVendor=hapoalim')
      .expect(200);
    expect(stats.body.success).toBe(true);
    expect(stats.body.stats.matchedCount).toBe(12);
    expect(statsSpy).toHaveBeenCalledWith({ bankVendor: 'hapoalim', bankAccountNumber: null });

    const invalidWeekly = await request(app)
      .get('/api/investments/manual-matching/weekly-stats')
      .query({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        matchPatterns: 'invalid-json',
      })
      .expect(400);
    expect(invalidWeekly.body.error).toMatch(/Invalid matchPatterns format/i);

    const weeklySpy = vi.spyOn(manualMatchingService, 'getWeeklyMatchingStats').mockResolvedValue([
      { weekStart: '2025-01-01', matchedCount: 2 },
      { weekStart: '2025-01-08', matchedCount: 1 },
    ]);

    const weekly = await request(app)
      .get('/api/investments/manual-matching/weekly-stats')
      .query({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
        matchPatterns: JSON.stringify(['monthly-repayment']),
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      })
      .expect(200);

    expect(weekly.body.success).toBe(true);
    expect(weekly.body.count).toBe(2);
    expect(weeklySpy).toHaveBeenCalledWith({
      creditCardAccountNumber: '',
      creditCardVendor: 'isracard',
      bankVendor: 'hapoalim',
      bankAccountNumber: null,
      matchPatterns: ['monthly-repayment'],
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });
  });

  it('validates and finds manual matching combinations with parsed numeric and boolean values', async () => {
    const missing = await request(app)
      .get('/api/investments/manual-matching/find-combinations')
      .expect(400);
    expect(missing.body.error).toMatch(/Missing required parameters/i);

    const combinationsSpy = vi
      .spyOn(manualMatchingService, 'findMatchingCombinations')
      .mockResolvedValue([{ ids: ['tx-1', 'tx-2'], total: 500 }]);

    const ok = await request(app)
      .get('/api/investments/manual-matching/find-combinations')
      .query({
        repaymentTxnId: 'rep-1',
        repaymentDate: '2025-01-31',
        repaymentAmount: '500.5',
        creditCardVendor: 'isracard',
        tolerance: '1.5',
        maxCombinationSize: '4',
        includeMatched: 'true',
        processedDate: '2025-01-15',
      })
      .expect(200);

    expect(ok.body.success).toBe(true);
    expect(ok.body.count).toBe(1);
    expect(combinationsSpy).toHaveBeenCalledWith({
      repaymentTxnId: 'rep-1',
      repaymentDate: '2025-01-31',
      repaymentAmount: 500.5,
      creditCardAccountNumber: '',
      creditCardVendor: 'isracard',
      tolerance: 1.5,
      maxCombinationSize: 4,
      includeMatched: true,
      processedDate: '2025-01-15',
    });
  });

  it('surfaces service errors for standard investment endpoints', async () => {
    vi.spyOn(checkExistingService, 'getExistingInvestments').mockRejectedValueOnce({
      statusCode: 502,
      message: 'check failed',
    });
    const checkExistingError = await request(app).get('/api/investments/check-existing').expect(502);
    expect(checkExistingError.body.error).toBe('check failed');

    vi.spyOn(patternsService, 'listPatterns').mockRejectedValueOnce({
      statusCode: 503,
      message: 'patterns unavailable',
    });
    const patternsListError = await request(app).get('/api/investments/patterns').expect(503);
    expect(patternsListError.body.error).toBe('patterns unavailable');

    vi.spyOn(patternsService, 'createPattern').mockRejectedValueOnce({
      statusCode: 422,
      message: 'invalid pattern',
    });
    const patternsCreateError = await request(app)
      .post('/api/investments/patterns')
      .send({ vendor: 'bad' })
      .expect(422);
    expect(patternsCreateError.body.error).toBe('invalid pattern');

    vi.spyOn(patternsService, 'removePattern').mockRejectedValueOnce({
      statusCode: 410,
      message: 'pattern missing',
    });
    const patternsDeleteError = await request(app).delete('/api/investments/patterns?id=missing').expect(410);
    expect(patternsDeleteError.body.error).toBe('pattern missing');

    vi.spyOn(pendingSuggestionsService, 'listPendingSuggestions').mockRejectedValueOnce({
      status: 429,
      message: 'rate limited',
    });
    const pendingSuggestionsError = await request(app).get('/api/investments/pending-suggestions').expect(429);
    expect(pendingSuggestionsError.body.success).toBe(false);
    expect(pendingSuggestionsError.body.error).toBe('rate limited');

    vi.spyOn(accountsService, 'listAccounts').mockRejectedValueOnce({ status: 500, message: 'accounts down' });
    vi.spyOn(accountsService, 'createAccount').mockRejectedValueOnce({ status: 500, message: 'create failed' });
    vi.spyOn(accountsService, 'updateAccount').mockRejectedValueOnce({ status: 500, message: 'update failed' });
    vi.spyOn(accountsService, 'deactivateAccount').mockRejectedValueOnce({ status: 500, message: 'delete failed' });

    expect((await request(app).get('/api/investments/accounts').expect(500)).body.error).toBe('accounts down');
    expect((await request(app).post('/api/investments/accounts').send({}).expect(500)).body.error).toBe('create failed');
    expect((await request(app).put('/api/investments/accounts').send({}).expect(500)).body.error).toBe('update failed');
    expect((await request(app).delete('/api/investments/accounts?id=1').expect(500)).body.error).toBe('delete failed');

    vi.spyOn(assetsService, 'listAssets').mockRejectedValueOnce({ status: 500, message: 'assets list failed' });
    vi.spyOn(assetsService, 'createAsset').mockRejectedValueOnce({ status: 500, message: 'asset create failed' });
    vi.spyOn(assetsService, 'updateAsset').mockRejectedValueOnce({ status: 500, message: 'asset update failed' });
    vi.spyOn(assetsService, 'deactivateAsset').mockRejectedValueOnce({ status: 500, message: 'asset delete failed' });

    expect((await request(app).get('/api/investments/assets').expect(500)).body.error).toBe('assets list failed');
    expect((await request(app).post('/api/investments/assets').send({}).expect(500)).body.error).toBe('asset create failed');
    expect((await request(app).put('/api/investments/assets').send({}).expect(500)).body.error).toBe('asset update failed');
    expect((await request(app).delete('/api/investments/assets?id=1').expect(500)).body.error).toBe('asset delete failed');

    vi.spyOn(holdingsService, 'listHoldings').mockRejectedValueOnce({ status: 500, message: 'holdings list failed' });
    vi.spyOn(holdingsService, 'upsertHolding').mockRejectedValueOnce({ status: 500, message: 'holding upsert failed' });
    vi.spyOn(holdingsService, 'deleteHolding').mockRejectedValueOnce({ status: 500, message: 'holding delete failed' });

    expect((await request(app).get('/api/investments/holdings').expect(500)).body.error).toBe('holdings list failed');
    expect((await request(app).post('/api/investments/holdings').send({}).expect(500)).body.error).toBe('holding upsert failed');
    expect((await request(app).delete('/api/investments/holdings?id=1').expect(500)).body.error).toBe('holding delete failed');

    vi.spyOn(summaryService, 'getInvestmentSummary').mockRejectedValueOnce({ status: 500, message: 'summary failed' });
    const summaryError = await request(app).get('/api/investments/summary').expect(500);
    expect(summaryError.body.error).toBe('summary failed');

    vi.spyOn(bankSummaryService, 'getBankBalanceSummary').mockRejectedValueOnce({ status: 502, message: 'bank summary failed' });
    const bankSummaryError = await request(app).get('/api/investments/bank-summary').expect(502);
    expect(bankSummaryError.body.success).toBe(false);
    expect(bankSummaryError.body.error).toBe('bank summary failed');
  });

  it('surfaces database errors for suggestion dismiss and transaction link routes', async () => {
    const querySpy = vi.spyOn(database, 'query');

    querySpy.mockRejectedValueOnce({
      statusCode: 500,
      message: 'dismiss write failed',
    });
    const dismissError = await request(app)
      .post('/api/investments/suggestions/dismiss')
      .send({
        transactionIdentifiers: [{ identifier: 'tx-err', vendor: 'v-err' }],
      })
      .expect(500);
    expect(dismissError.body.error).toBe('dismiss write failed');

    querySpy.mockRejectedValueOnce({
      status: 503,
      message: 'link create failed',
    });
    const createLinkError = await request(app)
      .post('/api/investments/transaction-links')
      .send({
        transaction_identifier: 'tx-1',
        transaction_vendor: 'vendor-1',
        account_id: 1,
      })
      .expect(503);
    expect(createLinkError.body.error).toBe('link create failed');

    querySpy.mockRejectedValueOnce({
      status: 502,
      message: 'link list failed',
    });
    const listLinkError = await request(app)
      .get('/api/investments/transaction-links?account_id=1')
      .expect(502);
    expect(listLinkError.body.error).toBe('link list failed');

    querySpy.mockRejectedValueOnce({
      status: 501,
      message: 'link delete failed',
    });
    const deleteLinkError = await request(app)
      .delete('/api/investments/transaction-links?transaction_identifier=tx-1&transaction_vendor=v-1')
      .expect(501);
    expect(deleteLinkError.body.error).toBe('link delete failed');
  });

  it('surfaces manual matching service errors across endpoints', async () => {
    vi.spyOn(manualMatchingService, 'getUnmatchedRepayments').mockRejectedValueOnce({
      statusCode: 503,
      message: 'unmatched failed',
    });
    const unmatchedError = await request(app)
      .get('/api/investments/manual-matching/unmatched-repayments')
      .query({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
      })
      .expect(503);
    expect(unmatchedError.body.error).toBe('unmatched failed');

    vi.spyOn(manualMatchingService, 'getAvailableExpenses').mockRejectedValueOnce({
      statusCode: 500,
      message: 'expenses failed',
    });
    const expensesError = await request(app)
      .get('/api/investments/manual-matching/available-expenses')
      .query({
        repaymentDate: '2025-01-31',
        creditCardVendor: 'isracard',
      })
      .expect(500);
    expect(expensesError.body.error).toBe('expenses failed');

    vi.spyOn(manualMatchingService, 'getAvailableProcessedDates').mockRejectedValueOnce({
      statusCode: 500,
      message: 'processed dates failed',
    });
    const processedDatesError = await request(app)
      .get('/api/investments/manual-matching/processed-dates')
      .query({ creditCardVendor: 'isracard' })
      .expect(500);
    expect(processedDatesError.body.error).toBe('processed dates failed');

    vi.spyOn(manualMatchingService, 'getBankRepaymentsForProcessedDate').mockRejectedValueOnce({
      statusCode: 500,
      message: 'bank repayments failed',
    });
    const bankRepaymentsError = await request(app)
      .get('/api/investments/manual-matching/bank-repayments-for-date')
      .query({
        processedDate: '2025-01-15',
        bankVendor: 'hapoalim',
      })
      .expect(500);
    expect(bankRepaymentsError.body.error).toBe('bank repayments failed');

    vi.spyOn(manualMatchingService, 'saveManualMatch').mockRejectedValueOnce({
      statusCode: 500,
      message: 'save failed',
    });
    const saveError = await request(app)
      .post('/api/investments/manual-matching/save-match')
      .send({
        repaymentTxnId: 'r-1',
        repaymentVendor: 'vendor-1',
        repaymentDate: '2025-01-31',
        repaymentAmount: 100,
        ccVendor: 'isracard',
        expenses: [],
      })
      .expect(500);
    expect(saveError.body.error).toBe('save failed');

    vi.spyOn(manualMatchingService, 'getMatchingStats').mockRejectedValueOnce({
      statusCode: 500,
      message: 'stats failed',
    });
    const statsError = await request(app)
      .get('/api/investments/manual-matching/stats')
      .query({ bankVendor: 'hapoalim' })
      .expect(500);
    expect(statsError.body.error).toBe('stats failed');

    vi.spyOn(manualMatchingService, 'getWeeklyMatchingStats').mockRejectedValueOnce({
      statusCode: 500,
      message: 'weekly failed',
    });
    const weeklyError = await request(app)
      .get('/api/investments/manual-matching/weekly-stats')
      .query({
        creditCardVendor: 'isracard',
        bankVendor: 'hapoalim',
      })
      .expect(500);
    expect(weeklyError.body.error).toBe('weekly failed');

    vi.spyOn(manualMatchingService, 'findMatchingCombinations').mockRejectedValueOnce({
      statusCode: 500,
      message: 'combinations failed',
    });
    const combinationsError = await request(app)
      .get('/api/investments/manual-matching/find-combinations')
      .query({
        repaymentTxnId: 'r-1',
        repaymentDate: '2025-01-31',
        repaymentAmount: '200',
        creditCardVendor: 'isracard',
      })
      .expect(500);
    expect(combinationsError.body.error).toBe('combinations failed');
  });

  it('exposes extended pikadon endpoints for analytics and lifecycle actions', async () => {
    vi.spyOn(pikadonService, 'getPikadonInterestIncome').mockResolvedValue({ byMonth: [{ month: '2025-01', amount: 300 }] });
    vi.spyOn(pikadonService, 'getPikadonMaturityBreakdown').mockResolvedValue({ events: [{ date: '2025-01-01' }] });
    vi.spyOn(pikadonService, 'autoDetectPikadonEvents').mockResolvedValue({ events: [{ id: 'evt-1' }] });
    const autoSetupSpy = vi.spyOn(pikadonService, 'autoSetupPikadon').mockResolvedValue({ created: 2 });
    vi.spyOn(pikadonService, 'createPikadon').mockResolvedValue({ id: 91, status: 'active' });
    const linkReturnSpy = vi.spyOn(pikadonService, 'linkReturnTransaction').mockResolvedValue({ success: true });
    const updateStatusSpy = vi.spyOn(pikadonService, 'updatePikadonStatus').mockResolvedValue({ id: 91, status: 'matured' });
    const deleteSpy = vi.spyOn(pikadonService, 'deletePikadon').mockResolvedValue({ success: true });
    vi.spyOn(pikadonService, 'rolloverPikadon').mockResolvedValue({ oldId: 91, newId: 92 });
    vi.spyOn(pikadonService, 'getRolloverChain').mockResolvedValue({ chain: [91, 92] });

    const interest = await request(app).get('/api/investments/pikadon/interest-income?startDate=2025-01-01').expect(200);
    expect(interest.body.byMonth[0].amount).toBe(300);

    const maturity = await request(app).get('/api/investments/pikadon/maturity-breakdown').expect(200);
    expect(maturity.body.events[0].date).toBe('2025-01-01');

    const autoDetect = await request(app).get('/api/investments/pikadon/auto-detect?vendor=hapoalim').expect(200);
    expect(autoDetect.body.events[0].id).toBe('evt-1');

    const autoSetup = await request(app)
      .post('/api/investments/pikadon/auto-setup')
      .send({ account_id: 7, vendor: 'hapoalim' })
      .expect(200);
    expect(autoSetup.body.created).toBe(2);
    expect(autoSetupSpy).toHaveBeenCalledWith(7, { vendor: 'hapoalim' });

    const created = await request(app)
      .post('/api/investments/pikadon')
      .send({ account_id: 7, cost_basis: 1000, as_of_date: '2025-01-01' })
      .expect(201);
    expect(created.body.id).toBe(91);

    const linked = await request(app)
      .put('/api/investments/pikadon/91/link-return')
      .send({ return_transaction_id: 'txn-1', return_transaction_vendor: 'hapoalim' })
      .expect(200);
    expect(linked.body.success).toBe(true);
    expect(linkReturnSpy).toHaveBeenCalledWith('91', {
      return_transaction_id: 'txn-1',
      return_transaction_vendor: 'hapoalim',
    });

    const status = await request(app)
      .put('/api/investments/pikadon/91/status')
      .send({ status: 'matured' })
      .expect(200);
    expect(status.body.status).toBe('matured');
    expect(updateStatusSpy).toHaveBeenCalledWith('91', 'matured');

    const deleted = await request(app).delete('/api/investments/pikadon/91').expect(200);
    expect(deleted.body.success).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith('91');

    const rolledOver = await request(app)
      .post('/api/investments/pikadon/91/rollover')
      .send({ new_maturity_date: '2025-07-01' })
      .expect(200);
    expect(rolledOver.body.newId).toBe(92);

    const chain = await request(app).get('/api/investments/pikadon/91/chain').expect(200);
    expect(chain.body.chain).toEqual([91, 92]);
  });

  it('surfaces errors for advanced pikadon endpoints', async () => {
    vi.spyOn(pikadonService, 'getPikadonInterestIncome').mockRejectedValueOnce({
      status: 503,
      message: 'upstream unavailable',
    });
    vi.spyOn(pikadonService, 'autoSetupPikadon').mockRejectedValueOnce(new Error('boom'));

    const incomeError = await request(app).get('/api/investments/pikadon/interest-income').expect(503);
    expect(incomeError.body.error).toBe('upstream unavailable');

    const autoSetupError = await request(app)
      .post('/api/investments/pikadon/auto-setup')
      .send({ account_id: 3 })
      .expect(500);
    expect(autoSetupError.body.error).toBe('boom');
  });

  it('surfaces errors for additional pikadon CRUD and analytics endpoints', async () => {
    vi.spyOn(pikadonService, 'listPikadon').mockRejectedValueOnce({ status: 500, message: 'list failed' });
    vi.spyOn(pikadonService, 'getPikadonSummary').mockRejectedValueOnce({ status: 500, message: 'summary failed' });
    vi.spyOn(pikadonService, 'detectPikadonPairs').mockRejectedValueOnce({ status: 500, message: 'detect failed' });
    vi.spyOn(pikadonService, 'getPikadonMaturityBreakdown').mockRejectedValueOnce({ status: 500, message: 'maturity failed' });
    vi.spyOn(pikadonService, 'autoDetectPikadonEvents').mockRejectedValueOnce({ status: 500, message: 'auto-detect failed' });
    vi.spyOn(pikadonService, 'createPikadon').mockRejectedValueOnce({ status: 500, message: 'create failed' });
    vi.spyOn(pikadonService, 'linkReturnTransaction').mockRejectedValueOnce({ status: 500, message: 'link return failed' });
    vi.spyOn(pikadonService, 'updatePikadonStatus').mockRejectedValueOnce({ status: 500, message: 'status failed' });
    vi.spyOn(pikadonService, 'deletePikadon').mockRejectedValueOnce({ status: 500, message: 'delete failed' });
    vi.spyOn(pikadonService, 'rolloverPikadon').mockRejectedValueOnce({ status: 500, message: 'rollover failed' });
    vi.spyOn(pikadonService, 'getRolloverChain').mockRejectedValueOnce({ status: 500, message: 'chain failed' });

    expect((await request(app).get('/api/investments/pikadon').expect(500)).body.error).toBe('list failed');
    expect((await request(app).get('/api/investments/pikadon/summary').expect(500)).body.error).toBe('summary failed');
    expect((await request(app).get('/api/investments/pikadon/detect').expect(500)).body.error).toBe('detect failed');
    expect((await request(app).get('/api/investments/pikadon/maturity-breakdown').expect(500)).body.error).toBe('maturity failed');
    expect((await request(app).get('/api/investments/pikadon/auto-detect').expect(500)).body.error).toBe('auto-detect failed');
    expect((await request(app).post('/api/investments/pikadon').send({}).expect(500)).body.error).toBe('create failed');
    expect((await request(app).put('/api/investments/pikadon/1/link-return').send({}).expect(500)).body.error).toBe('link return failed');
    expect((await request(app).put('/api/investments/pikadon/1/status').send({ status: 'active' }).expect(500)).body.error).toBe('status failed');
    expect((await request(app).delete('/api/investments/pikadon/1').expect(500)).body.error).toBe('delete failed');
    expect((await request(app).post('/api/investments/pikadon/1/rollover').send({}).expect(500)).body.error).toBe('rollover failed');
    expect((await request(app).get('/api/investments/pikadon/1/chain').expect(500)).body.error).toBe('chain failed');
  });
});
