import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createDataExportRouter } = require('../../routes/data-export.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dataExportService = require('../../services/data/export.js');

function buildApp() {
  const app = express();
  app.use('/api/data', createDataExportRouter());
  return app;
}

describe('Electron /api/data/export route', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns JSON payload when export succeeds', async () => {
    const payload = {
      format: 'json',
      contentType: 'application/json',
      filename: 'clarify-export-transactions.json',
      body: { ok: true, items: [] },
    };
    const spy = vi
      .spyOn(dataExportService, 'exportData')
      .mockResolvedValue(payload);

    const res = await request(app)
      .get('/api/data/export?format=json&dataType=transactions')
      .expect(200);

    expect(res.body).toEqual(payload.body);
    expect(res.headers['content-disposition']).toContain(payload.filename);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'json',
        dataType: 'transactions',
      }),
    );
  });

  it('returns structured error when export fails with EXPORT_ERROR', async () => {
    const errorPayload = {
      error: {
        code: 'EXPORT_ERROR',
        message: 'boom',
      },
      message: 'boom',
    };
    vi.spyOn(dataExportService, 'exportData').mockRejectedValue(errorPayload);

    const res = await request(app).get('/api/data/export').expect(500);
    expect(res.body).toEqual(errorPayload);
  });

  it('returns 400 on invalid export parameters', async () => {
    vi.spyOn(dataExportService, 'exportData').mockRejectedValue({
      error: { code: 'VALIDATION_ERROR', message: 'invalid format' },
    });

    const res = await request(app).get('/api/data/export').expect(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('sends non-json export payloads', async () => {
    vi.spyOn(dataExportService, 'exportData').mockResolvedValue({
      format: 'csv',
      contentType: 'text/csv',
      filename: 'export.csv',
      body: 'a,b\n1,2\n',
    });

    const res = await request(app).get('/api/data/export?format=csv').expect(200);

    expect(res.text).toBe('a,b\n1,2\n');
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('export.csv');
  });

  it('returns generic 500 payload when error is not structured', async () => {
    vi.spyOn(dataExportService, 'exportData').mockRejectedValue(new Error('plain failure'));

    const res = await request(app).get('/api/data/export').expect(500);

    expect(res.body).toEqual({
      error: 'Failed to export data',
      message: 'plain failure',
    });
  });
});
