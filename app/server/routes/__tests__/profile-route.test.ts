import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createProfileRouter } = require('../../routes/profile.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const profileService = require('../../services/profile.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/profile', createProfileRouter());
  return app;
}

describe('Shared /api/profile routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns profile data', async () => {
    const profile = { name: 'ShekelSync User' };
    const spy = vi.spyOn(profileService, 'getProfile').mockResolvedValue(profile);

    const res = await request(app).get('/api/profile').expect(200);

    expect(res.body).toEqual(profile);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('saves profile data', async () => {
    const payload = { name: 'Updated User' };
    const spy = vi.spyOn(profileService, 'saveProfile').mockResolvedValue(payload);

    const res = await request(app).put('/api/profile').send(payload).expect(200);

    expect(res.body).toEqual(payload);
    expect(spy).toHaveBeenCalledWith(payload);
  });
});
