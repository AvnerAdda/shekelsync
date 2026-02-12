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

  it('handles pattern create errors', async () => {
    vi.spyOn(duplicatePatternsService, 'createPattern').mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/api/patterns').send({ vendor: 'x' }).expect(500);
    expect(res.body.error).toBeDefined();
  });

  it('handles list, update, and delete errors', async () => {
    vi.spyOn(duplicatePatternsService, 'listPatterns').mockRejectedValue({
      status: 503,
      message: 'list unavailable',
      stack: 'list-stack',
    });
    const listRes = await request(app).get('/api/patterns').expect(503);
    expect(listRes.body.error).toMatch(/list unavailable/i);
    expect(listRes.body.details).toBe('list-stack');

    vi.spyOn(duplicatePatternsService, 'updatePattern').mockRejectedValue(new Error('update boom'));
    const updateRes = await request(app).put('/api/patterns').send({ id: 'x' }).expect(500);
    expect(updateRes.body.error).toMatch(/update boom|failed to update/i);

    vi.spyOn(duplicatePatternsService, 'deletePattern').mockRejectedValue({
      status: 410,
      message: 'already deleted',
      stack: 'delete-stack',
    });
    const deleteRes = await request(app).delete('/api/patterns?id=2').expect(410);
    expect(deleteRes.body.error).toMatch(/already deleted/i);
    expect(deleteRes.body.details).toBe('delete-stack');
  });
});
