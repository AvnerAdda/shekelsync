const fs = require('fs');
const path = require('path');
const databaseModule = require('../database.js');

const MIGRATION_ENV_FLAG = 'ALLOW_DB_MIGRATE';

let currentDatabase = databaseModule;

function serviceError(status, message, extras = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extras);
  return error;
}

function isMigrationEnabled() {
  return process.env[MIGRATION_ENV_FLAG] === 'true';
}

function resolveMigrationFile() {
  const projectRoot = path.join(__dirname, '..', '..', '..');
  const candidates = [
    path.join(projectRoot, 'db-init', 'migration_investments.sql'),
    path.join(projectRoot, 'db-migrations', 'migration_investments.sql'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw serviceError(404, 'Migration file not found', {
    details: `Searched paths: ${candidates.join(', ')}`,
  });
}

async function runInvestmentsMigration() {
  if (!isMigrationEnabled()) {
    throw serviceError(403, 'Database migration API disabled', {
      hint: `Set ${MIGRATION_ENV_FLAG}=true before invoking this endpoint.`,
    });
  }

  const migrationPath = resolveMigrationFile();
  const sql = fs.readFileSync(migrationPath, 'utf8');
  let client;

  try {
    client = await currentDatabase.getClient?.();

    if (!client) {
      throw new Error('Database client unavailable');
    }

    if (typeof client.query !== 'function') {
      throw new Error('Database client does not expose query()');
    }

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    return {
      success: true,
      message: 'Investment tables migration completed successfully',
      path: migrationPath,
    };
  } catch (error) {
    if (client && typeof client.query === 'function') {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Migration rollback failed:', rollbackError);
      }
    }

    throw serviceError(500, 'Failed to run migration', {
      details: error.message,
      hint: 'Tables may already exist. Check if migration was already run.',
    });
  } finally {
    if (client && typeof client.release === 'function') {
      await client.release();
    }
  }
}

module.exports = {
  runInvestmentsMigration,
  isMigrationEnabled,
  __setDatabaseForTests(overrides = null) {
    if (!overrides) {
      currentDatabase = databaseModule;
    } else {
      currentDatabase = overrides;
    }
  },
  __setMigrationEnabledForTests(value) {
    process.env[MIGRATION_ENV_FLAG] = value ? 'true' : 'false';
  },
  MIGRATION_ENV_FLAG,
};
module.exports.default = module.exports;
