import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createPayrollRouter } = require('../../routes/payroll.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const payrollService = require('../../services/payroll/service.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payroll', createPayrollRouter());
  return app;
}

describe('/api/payroll routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the payroll setup', async () => {
    const setup = { members: [], accounts: [], defaults: {} };
    vi.spyOn(payrollService, 'getPayrollSetup').mockResolvedValue(setup);
    const res = await request(app).get('/api/payroll').expect(200);
    expect(res.body).toEqual(setup);
  });

  it('returns salary candidates', async () => {
    vi.spyOn(payrollService, 'getSalaryCandidates').mockResolvedValue({ candidates: [{ key: 'k' }] });
    const res = await request(app).get('/api/payroll/salary-candidates').expect(200);
    expect(res.body.candidates).toHaveLength(1);
  });

  it('saves a member employment', async () => {
    const spy = vi.spyOn(payrollService, 'saveEmployment').mockResolvedValue({ member: 'spouse' });
    await request(app).put('/api/payroll/spouse').send({ gross_monthly: 1 }).expect(200);
    expect(spy).toHaveBeenCalledWith('spouse', { gross_monthly: 1 });
  });

  it('passes validation errors through as 400 with their message', async () => {
    const error = Object.assign(new Error('member must be one of: self, spouse'), { status: 400 });
    vi.spyOn(payrollService, 'saveEmployment').mockRejectedValue(error);
    const res = await request(app).put('/api/payroll/child').send({}).expect(400);
    expect(res.body).toEqual({ success: false, error: 'member must be one of: self, spouse' });
  });

  it('hides internal error details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(payrollService, 'deleteEmployment').mockRejectedValue(new Error('SQLITE_BUSY at /secret/path'));
    const res = await request(app).delete('/api/payroll/self').expect(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to delete employment' });
  });
});
