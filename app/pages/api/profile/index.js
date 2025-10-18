import { getDB } from '../db.js';

/**
 * Enhanced User Profile API
 * Handles GET and PUT for user profile with family information (spouse & children)
 */
export default async function handler(req, res) {
  const client = await getDB();

  try {
    if (req.method === 'GET') {
      // Get user profile with related spouse and children data
      const profileResult = await client.query('SELECT * FROM user_profile LIMIT 1');

      if (profileResult.rows.length === 0) {
        // Create default profile if none exists
        const newProfile = await client.query(
          `INSERT INTO user_profile (username, marital_status, age, location)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          ['User', 'Single', 28, 'Tel Aviv']
        );
        return res.status(200).json({
          profile: newProfile.rows[0],
          spouse: null,
          children: []
        });
      }

      const profile = profileResult.rows[0];
      const profileId = profile.id;

      // Get spouse information if exists
      const spouseResult = await client.query(
        'SELECT * FROM spouse_profile WHERE user_profile_id = $1',
        [profileId]
      );
      const spouse = spouseResult.rows.length > 0 ? spouseResult.rows[0] : null;

      // Get children information
      const childrenResult = await client.query(
        'SELECT * FROM children_profile WHERE user_profile_id = $1 ORDER BY birth_date ASC',
        [profileId]
      );
      const children = childrenResult.rows;

      res.status(200).json({
        profile,
        spouse,
        children
      });
    } else if (req.method === 'PUT') {
      const {
        profile: profileData,
        spouse: spouseData,
        children: childrenData
      } = req.body;

      // Begin transaction for data consistency
      await client.query('BEGIN');

      try {
        // Get or create profile
        const existingProfile = await client.query('SELECT id FROM user_profile LIMIT 1');
        let profileId;
        let updatedProfile;

        if (existingProfile.rows.length === 0) {
          // Insert new profile
          const profileResult = await client.query(
            `INSERT INTO user_profile
             (username, marital_status, age, birth_date, occupation, monthly_income,
              family_status, location, industry, children_count, household_size,
              home_ownership, education_level, employment_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
            [
              profileData.username,
              profileData.marital_status,
              profileData.age,
              profileData.birth_date,
              profileData.occupation,
              profileData.monthly_income,
              profileData.family_status,
              profileData.location,
              profileData.industry,
              profileData.children_count || 0,
              profileData.household_size || 1,
              profileData.home_ownership,
              profileData.education_level,
              profileData.employment_status
            ]
          );
          updatedProfile = profileResult.rows[0];
          profileId = updatedProfile.id;
        } else {
          profileId = existingProfile.rows[0].id;
          // Update existing profile
          const profileResult = await client.query(
            `UPDATE user_profile
             SET username = $1,
                 marital_status = $2,
                 age = $3,
                 birth_date = $4,
                 occupation = $5,
                 monthly_income = $6,
                 family_status = $7,
                 location = $8,
                 industry = $9,
                 home_ownership = $10,
                 education_level = $11,
                 employment_status = $12,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $13
             RETURNING *`,
            [
              profileData.username,
              profileData.marital_status,
              profileData.age,
              profileData.birth_date,
              profileData.occupation,
              profileData.monthly_income,
              profileData.family_status,
              profileData.location,
              profileData.industry,
              profileData.home_ownership,
              profileData.education_level,
              profileData.employment_status,
              profileId
            ]
          );
          updatedProfile = profileResult.rows[0];
        }

        // Handle spouse data
        let updatedSpouse = null;
        if (profileData.marital_status === 'Married' && spouseData) {
          // Check if spouse exists
          const existingSpouse = await client.query(
            'SELECT id FROM spouse_profile WHERE user_profile_id = $1',
            [profileId]
          );

          if (existingSpouse.rows.length === 0) {
            // Insert new spouse
            const spouseResult = await client.query(
              `INSERT INTO spouse_profile
               (user_profile_id, name, birth_date, occupation, industry, monthly_income, employment_status, education_level)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
              [
                profileId,
                spouseData.name,
                spouseData.birth_date,
                spouseData.occupation,
                spouseData.industry,
                spouseData.monthly_income,
                spouseData.employment_status,
                spouseData.education_level
              ]
            );
            updatedSpouse = spouseResult.rows[0];
          } else {
            // Update existing spouse
            const spouseResult = await client.query(
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
              [
                spouseData.name,
                spouseData.birth_date,
                spouseData.occupation,
                spouseData.industry,
                spouseData.monthly_income,
                spouseData.employment_status,
                spouseData.education_level,
                profileId
              ]
            );
            updatedSpouse = spouseResult.rows[0];
          }
        } else {
          // Remove spouse if not married or no spouse data
          await client.query('DELETE FROM spouse_profile WHERE user_profile_id = $1', [profileId]);
        }

        // Handle children data
        let updatedChildren = [];
        if (childrenData && Array.isArray(childrenData)) {
          // Remove all existing children first
          await client.query('DELETE FROM children_profile WHERE user_profile_id = $1', [profileId]);

          // Insert new children
          for (const child of childrenData) {
            if (child.birth_date) {
              const childResult = await client.query(
                `INSERT INTO children_profile
                 (user_profile_id, name, birth_date, gender, education_stage, special_needs)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [
                  profileId,
                  child.name || '',
                  child.birth_date,
                  child.gender,
                  child.education_stage,
                  child.special_needs || false
                ]
              );
              updatedChildren.push(childResult.rows[0]);
            }
          }
        }

        // Update household size manually since we removed triggers
        const finalHouseholdSize = 1 + (updatedSpouse ? 1 : 0) + updatedChildren.length;
        await client.query(
          'UPDATE user_profile SET household_size = $1, children_count = $2 WHERE id = $3',
          [finalHouseholdSize, updatedChildren.length, profileId]
        );

        // Get updated profile
        const finalProfileResult = await client.query('SELECT * FROM user_profile WHERE id = $1', [profileId]);
        const finalProfile = finalProfileResult.rows[0];

        // Commit transaction
        await client.query('COMMIT');

        res.status(200).json({
          profile: finalProfile,
          spouse: updatedSpouse,
          children: updatedChildren
        });
      } catch (transactionError) {
        await client.query('ROLLBACK');
        throw transactionError;
      }
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
