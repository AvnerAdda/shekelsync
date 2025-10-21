import { Pool } from 'pg';
import createSqlitePool from './sqlite-pool.js';

function shouldUseSqlite() {
  if (process.env.USE_SQLITE === 'true') return true;
  if (process.env.USE_SQLCIPHER === 'true') return true;
  if (process.env.SQLITE_DB_PATH) return true;
  if (process.env.SQLCIPHER_DB_PATH) return true;
  return false;
}

export default function createDbPool() {
  if (shouldUseSqlite()) {
    return createSqlitePool();
  }

  return new Pool({
    user: process.env.CLARIFY_DB_USER,
    host: process.env.CLARIFY_DB_HOST,
    database: process.env.CLARIFY_DB_NAME,
    password: process.env.CLARIFY_DB_PASSWORD,
    port: process.env.CLARIFY_DB_PORT ? parseInt(process.env.CLARIFY_DB_PORT, 10) : 5432,
    ssl: false,
  });
}
