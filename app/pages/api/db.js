import createDbPool from '../../lib/create-db-pool.js';

const pool = createDbPool();

export async function getDB() {
  try {
    const client = await pool.connect();
    return client;
  } catch (error) {
    console.error('Error connecting to the database:', error);
    throw new Error('Database connection failed');
  }
}

export default pool;
