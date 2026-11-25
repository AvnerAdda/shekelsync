import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createStatementImportRouter } = require('../statement-import.js');

describe('/api/statement-import routes', () => {
  const statementImportService = {
    previewStatementImport: vi.fn(),
    commitStatementImport: vi.fn(),
  };

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/statement-import', createStatementImportRouter({ services: { statementImportService } }));
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rows = [{ date: '2026-05-01', description: 'Example', amount: -10 }];

  it('previews without passing duplicate overrides to the service', async () => {
    statementImportService.previewStatementImport.mockResolvedValue({ summary: { total: 1 } });

    const res = await request(buildApp())
      .post('/api/statement-import/preview')
      .send({ credentialId: '4', accountNumber: 1234, rows, includeDuplicateIndexes: [0] })
      .expect(200);

    expect(res.body).toEqual({ summary: { total: 1 } });
    expect(statementImportService.previewStatementImport).toHaveBeenCalledWith({
      credentialId: 4,
      accountNumber: '1234',
      rows,
    });
  });

  it('commits with duplicate overrides', async () => {
    statementImportService.commitStatementImport.mockResolvedValue({ inserted: 1 });

    await request(buildApp())
      .post('/api/statement-import/commit')
      .send({ credentialId: 4, rows, includeDuplicateIndexes: [0] })
      .expect(200);

    expect(statementImportService.commitStatementImport).toHaveBeenCalledWith({
      credentialId: 4,
      accountNumber: null,
      rows,
      includeDuplicateIndexes: [0],
    });
  });

  it('rejects a missing credential id', async () => {
    await request(buildApp()).post('/api/statement-import/preview').send({ rows }).expect(400);
    expect(statementImportService.previewStatementImport).not.toHaveBeenCalled();
  });

  it('passes client error codes and hides server errors', async () => {
    const clientError: any = new Error('Pick one of this account\'s numbers');
    clientError.statusCode = 400;
    clientError.code = 'unknown_account_number';
    statementImportService.previewStatementImport.mockRejectedValueOnce(clientError);

    const bad = await request(buildApp())
      .post('/api/statement-import/preview')
      .send({ credentialId: 4, rows })
      .expect(400);
    expect(bad.body).toMatchObject({ code: 'unknown_account_number', error: 'Pick one of this account\'s numbers' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    statementImportService.commitStatementImport.mockRejectedValueOnce(new Error('SQLITE_FULL: database or disk is full'));
    const failed = await request(buildApp())
      .post('/api/statement-import/commit')
      .send({ credentialId: 4, rows })
      .expect(500);
    expect(failed.body).toMatchObject({ error: 'Failed to import the statement', code: null });
  });
});
