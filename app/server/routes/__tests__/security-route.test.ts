import express from 'express';
import request from 'supertest';
import { describe, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const securityRouter = require('../security.js');

describe('security routes', () => {
  it('does not expose the retired authentication endpoint', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/security', securityRouter);

    await request(app).post('/api/security/authenticate').send({}).expect(404);
  });
});
