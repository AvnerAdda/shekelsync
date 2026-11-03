import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createDataExportRouter } = require('../../routes/data-export.js');

const dataExportService = {
  exportData: vi.fn(),
};

function buildApp() {
  const app = express();
  app.use('/api/data', createDataExportRouter({
    services: {
      dataExportService,
    },
  }));
  return app;
}

describe('Electron /api/data/export route', () => {
  let app: express.Express;

  beforeEach(() => {
    dataExportService.exportData.mockReset();
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
    const spy = dataExportService.exportData.mockResolvedValue(payload);

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
    dataExportService.exportData.mockRejectedValue(errorPayload);

    const res = await request(app).get('/api/data/export').expect(500);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'EXPORT_ERROR', message: 'Failed to export data' },
    });
  });

  it('returns 400 on invalid export parameters', async () => {
    dataExportService.exportData.mockRejectedValue({
      error: { code: 'VALIDATION_ERROR', message: 'invalid format' },
    });

    const res = await request(app).get('/api/data/export').expect(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(res.body.error?.message).toBe('Invalid export parameters');
  });

  it('sends non-json export payloads', async () => {
    dataExportService.exportData.mockResolvedValue({
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
    dataExportService.exportData.mockRejectedValue(new Error('plain failure'));

    const res = await request(app).get('/api/data/export').expect(500);

    expect(res.body).toEqual({
      success: false,
      error: { code: 'EXPORT_ERROR', message: 'Failed to export data' },
    });
  });

  it.each(['INVALID_FORMAT', 'INVALID_DATA_TYPE', 'DATABASE_ERROR', '__proto__'])(
    'never serializes internal details for structured %s errors', async (code) => {
      const secret = 'PRIVATE_DATABASE_BACKUP_PATH';
      dataExportService.exportData.mockRejectedValue({
        error: { code, message: secret, details: { stack: secret } },
        stack: secret,
        cause: { password: secret },
      });

      const status = code === 'INVALID_FORMAT' || code === 'INVALID_DATA_TYPE' ? 400 : 500;
      const res = await request(app).get('/api/data/export').expect(status);

      expect(JSON.stringify(res.body)).not.toContain(secret);
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message']);
    },
  );
});
