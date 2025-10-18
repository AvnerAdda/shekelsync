import { getDB } from '../db.js';

/**
 * Spouse Profile API
 * Handles CRUD operations for spouse information
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
        'SELECT * FROM spouse_profile WHERE user_profile_id = $1',
        [profileId]
      );

      const spouse = result.rows.length > 0 ? result.rows[0] : null;
      res.status(200).json(spouse);

    } else if (req.method === 'POST' || req.method === 'PUT') {
      const {
        name,
        birth_date,
        occupation,
        industry,
        monthly_income,
        employment_status,
        education_level
      } = req.body;

      // Validation
      if (!name || !birth_date) {
        return res.status(400).json({ error: 'Name and birth date are required' });
      }

      // Check if spouse exists
      const existingSpouse = await client.query(
        'SELECT id FROM spouse_profile WHERE user_profile_id = $1',
        [profileId]
      );

      let result;
      if (existingSpouse.rows.length === 0) {
        // Insert new spouse
        result = await client.query(
          `INSERT INTO spouse_profile
           (user_profile_id, name, birth_date, occupation, industry, monthly_income, employment_status, education_level)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [profileId, name, birth_date, occupation, industry, monthly_income, employment_status, education_level]
        );
      } else {
        // Update existing spouse
        result = await client.query(
          `UPDATE spouse_profile
           SET name = $1,
               birth_date = $2,
               occupation = $3,
               industry = $4,
               monthly_income = $5,
               employment_status = $6,
               education_level = $7,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_profile_id = $8
           RETURNING *`,
          [name, birth_date, occupation, industry, monthly_income, employment_status, education_level, profileId]
        );
      }

      res.status(200).json(result.rows[0]);

    } else if (req.method === 'DELETE') {
      await client.query('DELETE FROM spouse_profile WHERE user_profile_id = $1', [profileId]);
      res.status(200).json({ success: true, message: 'Spouse profile deleted' });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in spouse API:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}