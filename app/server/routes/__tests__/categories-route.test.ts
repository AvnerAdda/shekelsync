import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCategoriesRouter } = require('../../routes/categories.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hierarchyService = require('../../services/categories/hierarchy.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const transactionsService = require('../../services/categories/transactions.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/categories', createCategoriesRouter());
  return app;
}

describe('Shared categories routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists category hierarchy', async () => {
    const hierarchy = { categories: [] };
    vi.spyOn(hierarchyService, 'listHierarchy').mockResolvedValue(hierarchy);

    const res = await request(app).get('/api/categories/hierarchy').expect(200);

    expect(res.body).toEqual(hierarchy);
  });

  it('creates a category', async () => {
    const category = { id: 1 };
    vi.spyOn(hierarchyService, 'createCategory').mockResolvedValue(category);

    const res = await request(app)
      .post('/api/categories/hierarchy')
      .send({ name: 'New' })
      .expect(201);

    expect(res.body).toEqual(category);
  });

  it('deletes a category', async () => {
    vi.spyOn(hierarchyService, 'deleteCategory').mockResolvedValue({ success: true });

    const res = await request(app).delete('/api/categories/hierarchy?id=1').expect(200);

    expect(res.body).toEqual({ success: true });
  });

  it('lists category transactions', async () => {
    const transactions = [{ id: 'txn-1' }];
    vi.spyOn(transactionsService, 'listCategoryTransactions').mockResolvedValue(transactions);

    const res = await request(app)
      .get('/api/categories/transactions?categoryId=1')
      .expect(200);

    expect(res.body).toEqual(transactions);
  });
});
