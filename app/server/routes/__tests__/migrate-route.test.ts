import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrationsRoutes = require('../../../../electron/api-routes/migrations.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrationsService = require('../../services/migrations/run.js');

const originalFlag = process.env.ALLOW_DB_MIGRATE;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/migrate', migrationsRoutes.runInvestmentsMigration.bind(migrationsRoutes));
  return app;
}

describe('Electron /api/migrate route', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof originalFlag === 'undefined') {
      delete process.env.ALLOW_DB_MIGRATE;
    } else {
      process.env.ALLOW_DB_MIGRATE = originalFlag;
    }
    migrationsService.__setMigrationEnabledForTests(process.env.ALLOW_DB_MIGRATE === 'true');
  });

  it('returns 403 when migrations are disabled', async () => {
    delete process.env.ALLOW_DB_MIGRATE;
    migrationsService.__setMigrationEnabledForTests(false);
    const serviceSpy = vi.spyOn(migrationsService, 'runInvestmentsMigration');

    const res = await request(app).post('/api/migrate').expect(403);

    expect(res.body.error).toMatch(/disabled/i);
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it('executes the migration when enabled', async () => {
    process.env.ALLOW_DB_MIGRATE = 'true';
    migrationsService.__setMigrationEnabledForTests(true);
    const payload = {
      success: true,
      message: 'ok',
      path: '/tmp/migration.sql',
    };
    const serviceSpy = vi
      .spyOn(migrationsService, 'runInvestmentsMigration')
      .mockResolvedValue(payload);

    const res = await request(app).post('/api/migrate').expect(200);

    expect(res.body).toEqual(payload);
    expect(serviceSpy).toHaveBeenCalledTimes(1);
  });
});
