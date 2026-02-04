import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCredentialsRouter } = require('../../routes/credentials.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const credentialsService = require('../../services/credentials.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/credentials', createCredentialsRouter());
  return app;
}

describe('Shared /api/credentials routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists credentials', async () => {
    const credentials = [{ id: 1, vendor: 'isracard' }];
    const spy = vi.spyOn(credentialsService, 'listCredentials').mockResolvedValue(credentials);

    const res = await request(app).get('/api/credentials?vendor=isracard').expect(200);

    expect(res.body).toEqual(credentials);
    expect(spy).toHaveBeenCalledWith({ vendor: 'isracard' });
  });

  it('creates a credential', async () => {
    const payload = { id: 42, vendor: 'isracard' };
    const spy = vi.spyOn(credentialsService, 'createCredential').mockResolvedValue(payload);

    const res = await request(app)
      .post('/api/credentials')
      .send({ vendor: 'isracard' })
      .expect(201);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ vendor: 'isracard' });
  });

  it('deletes a credential', async () => {
    const spy = vi.spyOn(credentialsService, 'deleteCredential').mockResolvedValue({ success: true });

    const res = await request(app).delete('/api/credentials/123').expect(200);

    expect(res.body).toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith({ id: 123 });
  });

  it('updates a credential', async () => {
    const payload = { id: 42, vendor: 'isracard' };
    const spy = vi.spyOn(credentialsService, 'updateCredential').mockResolvedValue(payload);

    const res = await request(app)
      .put('/api/credentials/42')
      .send({ password: 'new-secret' })
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({ id: 42, password: 'new-secret' });
  });

  it('handles credential creation errors', async () => {
    vi.spyOn(credentialsService, 'createCredential').mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/api/credentials').send({ vendor: 'err' }).expect(500);
    expect(res.body.error).toBeDefined();
  });

  it('handles credential deletion errors', async () => {
    vi.spyOn(credentialsService, 'deleteCredential').mockRejectedValue(
      Object.assign(new Error('forbidden'), { statusCode: 403 }),
    );

    const res = await request(app).delete('/api/credentials/999').expect(403);
    expect(res.body.error).toBeDefined();
  });

  it('handles credential update errors', async () => {
    vi.spyOn(credentialsService, 'updateCredential').mockRejectedValue(
      Object.assign(new Error('forbidden'), { statusCode: 403 }),
    );

    const res = await request(app).put('/api/credentials/999').send({ password: 'x' }).expect(403);
    expect(res.body.error).toBeDefined();
  });

  it('handles credential listing errors', async () => {
    vi.spyOn(credentialsService, 'listCredentials').mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/credentials').expect(500);
    expect(res.body.error).toBeDefined();
  });
});
