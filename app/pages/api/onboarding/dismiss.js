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

    if (profileCheckResult.rows.length === 0) {
      // Create a minimal profile if it doesn't exist
      await client.query(`
        INSERT INTO user_profile (
          username,
          onboarding_dismissed,
          onboarding_dismissed_at,
          last_active_at
        ) VALUES (
          'User',
          1,
          datetime('now'),
          datetime('now')
        )
      `);
    } else {
      // Update existing profile
      await client.query(`
        UPDATE user_profile
        SET
          onboarding_dismissed = 1,
          onboarding_dismissed_at = datetime('now'),
          last_active_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = $1
      `, [profileCheckResult.rows[0].id]);
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
