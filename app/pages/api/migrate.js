import { getDB } from './db.js';
import fs from 'fs';
import path from 'path';

/**
 * Database Migration API
 * POST /api/migrate - Run pending migrations
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    // Read the migration file
    const migrationPath = path.join(process.cwd(), '..', 'db-init', 'migration_investments.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute the migration
    await client.query(migrationSQL);

    return res.status(200).json({
      success: true,
      message: 'Investment tables migration completed successfully',
    });

  } catch (error) {
    console.error('Error running migration:', error);
    return res.status(500).json({
      error: 'Failed to run migration',
      details: error.message,
      hint: 'Tables may already exist. Check if migration was already run.',
    });
  } finally {
    client.release();
  }
}
