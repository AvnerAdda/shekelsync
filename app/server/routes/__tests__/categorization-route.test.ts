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
});
