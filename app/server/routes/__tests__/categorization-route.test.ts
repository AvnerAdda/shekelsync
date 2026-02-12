import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCategorizationRouter } = require('../../routes/categorization.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const categorizationService = require('../../services/categorization/rules.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const categorizeTransactionService = require('../../services/categorization/categorize-transaction.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createCategorizationRouter());
  return app;
}

describe('Shared categorization routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists categorization rules', async () => {
    const rules = [{ id: 1 }];
    vi.spyOn(categorizationService, 'listRules').mockResolvedValue(rules);

    const res = await request(app).get('/api/categorization_rules').expect(200);

    expect(res.body).toEqual(rules);
  });

  it('creates a new rule', async () => {
    const payload = { id: 2 };
    vi.spyOn(categorizationService, 'createRule').mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/categorization_rules')
      .send({ name_pattern: 'COFFEE' })
      .expect(201);

    expect(res.body).toEqual(payload);
  });

  it('categorizes a transaction', async () => {
    const result = { success: true };
    vi.spyOn(categorizeTransactionService, 'categorizeTransaction').mockResolvedValue(result);

    const res = await request(app)
      .post('/api/categorize_transaction')
      .send({ identifier: 'txn-1' })
      .expect(200);

    expect(res.body).toEqual(result);
  });

  it('previews rule matches', async () => {
    const preview = { matches: [] };
    vi.spyOn(categorizationService, 'previewRuleMatches').mockResolvedValue(preview);

    const res = await request(app)
      .get('/api/categorization_rules/preview?id=1')
      .expect(200);

    expect(res.body).toEqual(preview);
  });

  it('handles merge categories', async () => {
    const mergeResult = { success: true };
    vi.spyOn(categorizationService, 'mergeCategories').mockResolvedValue(mergeResult);

    const res = await request(app)
      .post('/api/merge_categories')
      .send({ sourceCategoryId: 1, targetCategoryId: 2 })
      .expect(200);

    expect(res.body).toEqual(mergeResult);
  });

  it('updates and deletes rules via both delete routes', async () => {
    const updateSpy = vi.spyOn(categorizationService, 'updateRule').mockResolvedValue({ id: 2, is_active: true });
    const deleteSpy = vi.spyOn(categorizationService, 'deleteRule').mockResolvedValue({ success: true });

    const updated = await request(app)
      .put('/api/categorization_rules')
      .send({ id: 2, is_active: true })
      .expect(200);
    expect(updated.body.id).toBe(2);
    expect(updateSpy).toHaveBeenCalledWith({ id: 2, is_active: true });

    const deletedByQuery = await request(app)
      .delete('/api/categorization_rules?id=2')
      .expect(200);
    expect(deletedByQuery.body.success).toBe(true);

    const deletedByParam = await request(app)
      .delete('/api/categorization_rules/5')
      .expect(200);
    expect(deletedByParam.body.success).toBe(true);
    expect(deleteSpy).toHaveBeenNthCalledWith(1, { id: '2' });
    expect(deleteSpy).toHaveBeenNthCalledWith(2, { id: '5' });
  });

  it('applies categorization rules and auto-creates rules', async () => {
    vi.spyOn(categorizationService, 'applyCategorizationRules').mockResolvedValue({ updated: 14 });
    vi.spyOn(categorizationService, 'createAutoRule').mockResolvedValue({ id: 40, created: true });

    const applied = await request(app)
      .post('/api/apply_categorization_rules')
      .expect(200);
    expect(applied.body.updated).toBe(14);

    const autoCreated = await request(app)
      .post('/api/categorization_rules/auto-create')
      .send({ transaction_id: 't-1' })
      .expect(201);
    expect(autoCreated.body.id).toBe(40);
  });

  it('surfaces service errors with status codes and payload details', async () => {
    vi.spyOn(categorizationService, 'listRules').mockRejectedValueOnce({ status: 503, message: 'list failed' });
    const listErr = await request(app).get('/api/categorization_rules').expect(503);
    expect(listErr.body.error).toBe('list failed');

    vi.spyOn(categorizationService, 'createRule').mockRejectedValueOnce({ status: 422, message: 'bad rule' });
    const createErr = await request(app).post('/api/categorization_rules').send({}).expect(422);
    expect(createErr.body.error).toBe('bad rule');

    vi.spyOn(categorizationService, 'updateRule').mockRejectedValueOnce({ status: 409, message: 'conflict' });
    const updateErr = await request(app).put('/api/categorization_rules').send({ id: 1 }).expect(409);
    expect(updateErr.body.error).toBe('conflict');

    vi.spyOn(categorizationService, 'deleteRule').mockRejectedValueOnce({ status: 404, message: 'missing' });
    const deleteErr = await request(app).delete('/api/categorization_rules/99').expect(404);
    expect(deleteErr.body.error).toBe('missing');

    vi.spyOn(categorizeTransactionService, 'categorizeTransaction').mockRejectedValueOnce({
      status: 400,
      message: 'invalid transaction',
    });
    const categorizeErr = await request(app).post('/api/categorize_transaction').send({}).expect(400);
    expect(categorizeErr.body.error).toBe('invalid transaction');

    vi.spyOn(categorizationService, 'applyCategorizationRules').mockRejectedValueOnce({
      status: 500,
      message: 'apply failed',
    });
    const applyErr = await request(app).post('/api/apply_categorization_rules').expect(500);
    expect(applyErr.body.error).toBe('apply failed');

    vi.spyOn(categorizationService, 'previewRuleMatches').mockRejectedValueOnce({
      status: 418,
      message: 'teapot',
      stack: 'stack-preview',
    });
    const previewErr = await request(app).get('/api/categorization_rules/preview?id=7').expect(418);
    expect(previewErr.body.error).toBe('teapot');
    expect(previewErr.body.details).toBe('stack-preview');

    vi.spyOn(categorizationService, 'mergeCategories').mockRejectedValueOnce({
      status: 400,
      message: 'cannot merge',
    });
    const mergeErr = await request(app).post('/api/merge_categories').send({}).expect(400);
    expect(mergeErr.body.error).toBe('cannot merge');
  });

  it('handles auto-create client and server errors, including returned rule id', async () => {
    vi.spyOn(categorizationService, 'createAutoRule').mockRejectedValueOnce({
      status: 409,
      message: 'Rule already exists',
      ruleId: 123,
      stack: 'conflict-stack',
    });

    const conflict = await request(app)
      .post('/api/categorization_rules/auto-create')
      .send({ transaction_id: 't-dup' })
      .expect(409);

    expect(conflict.body.error).toBe('Rule already exists');
    expect(conflict.body.ruleId).toBe(123);
    expect(conflict.body.details).toBe('conflict-stack');

    vi.spyOn(categorizationService, 'createAutoRule').mockRejectedValueOnce({
      status: 500,
      message: 'internal error',
      stack: 'server-stack',
    });

    const serverErr = await request(app)
      .post('/api/categorization_rules/auto-create')
      .send({ transaction_id: 't-fail' })
      .expect(500);

    expect(serverErr.body.error).toBe('internal error');
    expect(serverErr.body.details).toBe('server-stack');
  });
});
