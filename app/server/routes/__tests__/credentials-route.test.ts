import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCredentialsRouter } = require('../../routes/credentials.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const credentialsService = require('../../services/credentials.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const oneZeroVerification = require('../../services/scraping/one-zero-verification.js');

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
    expect(spy).toHaveBeenCalledWith({ vendor: 'isracard', skipDecrypt: true });
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

  it('never returns decrypted secrets from create or update', async () => {
    const decrypted = {
      id: 42,
      vendor: 'isracard',
      nickname: 'Card',
      username: 'user',
      password: 'secret',
      id_number: '123456789',
      identification_code: '778899',
    };
    vi.spyOn(credentialsService, 'updateCredential').mockResolvedValue(decrypted);
    vi.spyOn(credentialsService, 'createCredential').mockResolvedValue(decrypted);

    const updated = await request(app).put('/api/credentials/42').send({ password: 'secret' }).expect(200);
    expect(updated.body).toEqual({ id: 42, vendor: 'isracard', nickname: 'Card' });

    const created = await request(app).post('/api/credentials').send({ vendor: 'isracard' }).expect(201);
    expect(created.body).toEqual({ id: 42, vendor: 'isracard', nickname: 'Card' });
  });

  it('updates a credential with AccountsModal edit payload fields', async () => {
    const payload = { id: 42, vendor: 'visaCal' };
    const spy = vi.spyOn(credentialsService, 'updateCredential').mockResolvedValue(payload);

    const res = await request(app)
      .put('/api/credentials/42')
      .send({
        username: 'updated-user',
        id_number: '123456789',
        card6_digits: '654321',
        bank_account_number: '111222',
        identification_code: '778899',
        password: 'updated-password',
      })
      .expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith({
      id: 42,
      username: 'updated-user',
      id_number: '123456789',
      card6_digits: '654321',
      bank_account_number: '111222',
      identification_code: '778899',
      password: 'updated-password',
    });
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

  describe('One Zero phone verification', () => {
    it('starts a verification and returns only the masked number', async () => {
      const spy = vi.spyOn(oneZeroVerification, 'startVerification').mockResolvedValue({
        sessionId: 'session-1',
        expiresAt: '2026-01-15T10:10:00.000Z',
        maskedPhoneNumber: '•••• 4567',
      });

      const res = await request(app)
        .post('/api/credentials/7/one-zero/verification')
        .send({ phoneNumber: '0501234567' })
        .expect(200);

      expect(spy).toHaveBeenCalledWith({ credentialId: 7, phoneNumber: '0501234567' });
      expect(res.body).toEqual({
        sessionId: 'session-1',
        expiresAt: '2026-01-15T10:10:00.000Z',
        maskedPhoneNumber: '•••• 4567',
      });
    });

    it('confirms a code and never echoes the token', async () => {
      const spy = vi.spyOn(oneZeroVerification, 'confirmVerification').mockResolvedValue({ verified: true });

      const res = await request(app)
        .post('/api/credentials/7/one-zero/verification/confirm')
        .send({ sessionId: 'session-1', code: '123456' })
        .expect(200);

      expect(spy).toHaveBeenCalledWith({ credentialId: 7, sessionId: 'session-1', code: '123456' });
      expect(res.body).toEqual({ verified: true });
    });

    it('passes service error codes and remaining attempts to the client', async () => {
      const error: any = new Error('One Zero did not accept that code');
      error.statusCode = 400;
      error.code = 'code_rejected';
      error.attemptsRemaining = 3;
      vi.spyOn(oneZeroVerification, 'confirmVerification').mockRejectedValue(error);

      const res = await request(app)
        .post('/api/credentials/7/one-zero/verification/confirm')
        .send({ sessionId: 'session-1', code: '000000' })
        .expect(400);

      expect(res.body).toMatchObject({
        error: 'One Zero did not accept that code',
        code: 'code_rejected',
        attemptsRemaining: 3,
      });
    });

    it('hides unexpected internal error details', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(oneZeroVerification, 'startVerification').mockRejectedValue(new Error('SQLITE_BUSY: database is locked'));

      const res = await request(app)
        .post('/api/credentials/7/one-zero/verification')
        .send({ phoneNumber: '0501234567' })
        .expect(500);

      expect(res.body.error).toBe('Failed to send the verification code');
      expect(res.body.code).toBeNull();
    });

    it('rejects a non-numeric credential id', async () => {
      const spy = vi.spyOn(oneZeroVerification, 'startVerification');
      await request(app).post('/api/credentials/abc/one-zero/verification').send({}).expect(400);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
