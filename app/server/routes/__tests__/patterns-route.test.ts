import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createPatternsRouter } = require('../../routes/patterns.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const duplicatePatternsService = require('../../services/patterns/duplicate-patterns.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/patterns', createPatternsRouter());
  return app;
}

describe('Shared /api/patterns routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists duplicate patterns', async () => {
    const patterns = [{ id: 'pattern-1' }];
    const spy = vi
      .spyOn(duplicatePatternsService, 'listPatterns')
      .mockResolvedValue(patterns);

    const res = await request(app).get('/api/patterns').expect(200);

    expect(res.body).toEqual(patterns);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('creates a duplicate pattern', async () => {
    const payload = { id: 'pattern-2' };
    const spy = vi
      .spyOn(duplicatePatternsService, 'createPattern')
      .mockResolvedValue(payload);

    const res = await request(app).post('/api/patterns').send({ vendor: 'test' }).expect(201);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ vendor: 'test' });
  });

  it('updates a duplicate pattern', async () => {
    const payload = { id: 'pattern-2', vendor: 'updated' };
    const spy = vi
      .spyOn(duplicatePatternsService, 'updatePattern')
      .mockResolvedValue(payload);

    const res = await request(app).put('/api/patterns').send(payload).expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith(payload);
  });

  it('deletes a duplicate pattern', async () => {
    const payload = { success: true };
    const spy = vi
      .spyOn(duplicatePatternsService, 'deletePattern')
      .mockResolvedValue(payload);

    const res = await request(app).delete('/api/patterns?id=1').expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ id: '1' });
  });
});
