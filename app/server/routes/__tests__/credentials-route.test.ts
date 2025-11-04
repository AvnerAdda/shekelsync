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
    expect(spy).toHaveBeenCalledWith({ id: '123' });
  });
});
