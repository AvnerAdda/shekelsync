import { getDB } from '../db.js';

/**
 * User Profile API
 * Handles GET and PUT for user profile with all demographic fields
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      const result = await client.query('SELECT * FROM user_profile LIMIT 1');

      if (result.rows.length === 0) {
        // Create default profile if none exists
        const newProfile = await client.query(
          `INSERT INTO user_profile (username, marital_status, age, location)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          ['User', 'Single', 28, 'Tel Aviv']
        );
        return res.status(200).json(newProfile.rows[0]);
      }

      res.status(200).json(result.rows[0]);
    } else if (req.method === 'PUT') {
      const {
        username,
        marital_status,
        age,
        occupation,
        monthly_income,
        family_status,
        location,
        industry,
      } = req.body;

      // Get or create profile
      const existingProfile = await client.query('SELECT id FROM user_profile LIMIT 1');

      let result;
      if (existingProfile.rows.length === 0) {
        // Insert new profile with all fields
        result = await client.query(
          `INSERT INTO user_profile
           (username, marital_status, age, occupation, monthly_income, family_status, location, industry)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [username, marital_status, age, occupation, monthly_income, family_status, location, industry]
        );
      } else {
        // Update existing profile with all fields
        result = await client.query(
          `UPDATE user_profile
           SET username = $1,
               marital_status = $2,
               age = $3,
               occupation = $4,
               monthly_income = $5,
               family_status = $6,
               location = $7,
               industry = $8,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $9
           RETURNING *`,
          [
            username,
            marital_status,
            age,
            occupation,
            monthly_income,
            family_status,
            location,
            industry,
            existingProfile.rows[0].id,
          ]
        );
      }

      res.status(200).json(result.rows[0]);
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in profile API:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}
