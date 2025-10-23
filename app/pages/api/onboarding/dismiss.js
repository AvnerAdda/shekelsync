import { getDB } from '../db.js';

/**
 * POST /api/onboarding/dismiss
 *
 * Marks onboarding as dismissed by the user.
 * Updates user_profile.onboarding_dismissed = 1
 *
 * Body: (empty)
 *
 * Response:
 * {
 *   success: boolean,
 *   message: string
 * }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    client = await getDB();

    // Check if user profile exists
    const profileCheckResult = await client.query(`
      SELECT id FROM user_profile LIMIT 1
    `);

    const now = new Date().toISOString();

    if (profileCheckResult.rows.length === 0) {
      // Create a minimal profile if it doesn't exist
      await client.query(`
        INSERT INTO user_profile (
          username,
          onboarding_dismissed,
          onboarding_dismissed_at,
          last_active_at
        ) VALUES (
          $1,
          $2,
          $3,
          $4
        )
      `, ['User', 1, now, now]);
    } else {
      // Update existing profile
      await client.query(`
        UPDATE user_profile
        SET
          onboarding_dismissed = $1,
          onboarding_dismissed_at = $2,
          last_active_at = $3,
          updated_at = $4
        WHERE id = $5
      `, [1, now, now, now, profileCheckResult.rows[0].id]);
    }

    return res.status(200).json({
      success: true,
      message: 'Onboarding dismissed successfully'
    });

  } catch (error) {
    console.error('Error dismissing onboarding:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to dismiss onboarding',
      message: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}
