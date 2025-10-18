import { getDB } from '../db.js';

/**
 * Children Profile API
 * Handles CRUD operations for children information
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    // Get user profile ID (assuming single user system)
    const userProfileResult = await client.query('SELECT id FROM user_profile LIMIT 1');
    if (userProfileResult.rows.length === 0) {
      return res.status(400).json({ error: 'User profile not found' });
    }
    const profileId = userProfileResult.rows[0].id;

    if (req.method === 'GET') {
      const result = await client.query(
        'SELECT * FROM children_profile WHERE user_profile_id = $1 ORDER BY birth_date ASC',
        [profileId]
      );

      res.status(200).json(result.rows);

    } else if (req.method === 'POST') {
      const {
        name,
        birth_date,
        gender,
        education_stage,
        special_needs = false
      } = req.body;

      // Validation
      if (!birth_date) {
        return res.status(400).json({ error: 'Birth date is required' });
      }

      const result = await client.query(
        `INSERT INTO children_profile
         (user_profile_id, name, birth_date, gender, education_stage, special_needs)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [profileId, name || '', birth_date, gender, education_stage, special_needs]
      );

      res.status(201).json(result.rows[0]);

    } else if (req.method === 'PUT') {
      const { id } = req.query;
      const {
        name,
        birth_date,
        gender,
        education_stage,
        special_needs
      } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Child ID is required for updates' });
      }

      const result = await client.query(
        `UPDATE children_profile
         SET name = $1,
             birth_date = $2,
             gender = $3,
             education_stage = $4,
             special_needs = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6 AND user_profile_id = $7
         RETURNING *`,
        [name, birth_date, gender, education_stage, special_needs, id, profileId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Child not found' });
      }

      res.status(200).json(result.rows[0]);

    } else if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Child ID is required for deletion' });
      }

      const result = await client.query(
        'DELETE FROM children_profile WHERE id = $1 AND user_profile_id = $2 RETURNING id',
        [id, profileId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Child not found' });
      }

      res.status(200).json({ success: true, message: 'Child profile deleted', id: result.rows[0].id });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in children API:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}