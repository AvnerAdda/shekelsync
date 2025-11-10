const { resolveAppPath } = require('../paths');
const migrationsService = require(resolveAppPath(
  'server',
  'services',
  'migrations',
  'run.js',
));

class MigrationsAPIRoutes {
  async runInvestmentsMigration(req, res) {
    if (!migrationsService.isMigrationEnabled()) {
      return res.status(403).json({
        error: 'Database migration API disabled',
        hint: `Set ${migrationsService.MIGRATION_ENV_FLAG}=true before invoking this endpoint.`,
      });
    }

    try {
      const result = await migrationsService.runInvestmentsMigration();
      res.json(result);
    } catch (error) {
      console.error('Migrations route error:', error);
      const status = error?.status || 500;
      res.status(status).json({
        error: error?.message || 'Failed to run migration',
        ...(error?.details ? { details: error.details } : {}),
        ...(error?.hint ? { hint: error.hint } : {}),
      });
    }
  }
}

module.exports = new MigrationsAPIRoutes();
