import { getDB } from '@/pages/api/db.js';

/**
 * Generic API handler utility for database operations.
 * Centralised here to keep Next.js from exposing it as a route.
 */
export function createApiHandler({ query, validate, transform }) {
  return async function handler(req, res) {
    const client = await getDB();

    try {
      if (validate) {
        const validationError = await validate(req);
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }
      }

      const { sql, params = [] } = await query(req);
      const result = await client.query(sql, params);
      const data = transform ? await transform(result, req) : result.rows;

      res.status(200).json(data);
    } catch (error) {
      console.error('Error executing query:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        details: error.message,
      });
    } finally {
      client.release();
    }
  };
}
