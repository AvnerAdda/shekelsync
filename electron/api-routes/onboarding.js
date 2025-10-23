const { dbManager } = require('../database');

// Onboarding API route handlers for Electron
class OnboardingAPIRoutes {
  // GET /api/onboarding/status
  async getStatus(req, res) {
    try {
      // Check if user profile exists
      const profileResult = await dbManager.query(`
        SELECT
          id,
          username,
          onboarding_dismissed,
          onboarding_dismissed_at,
          last_active_at
        FROM user_profile
        LIMIT 1
      `);
      const hasProfile = profileResult.rows.length > 0;
      const profile = profileResult.rows[0] || null;

      // Count vendor credentials (accounts)
      const accountsResult = await dbManager.query(`
        SELECT COUNT(*) as count
        FROM vendor_credentials
      `);
      const accountCount = parseInt(accountsResult.rows[0].count);

      // Count transactions
      const transactionsResult = await dbManager.query(`
        SELECT COUNT(*) as count
        FROM transactions
      `);
      const transactionCount = parseInt(transactionsResult.rows[0].count);

      // Get last scrape date
      const lastScrapeResult = await dbManager.query(`
        SELECT MAX(created_at) as last_scrape
        FROM scrape_events
        WHERE status = 'success'
      `);
      const lastScrapeDate = lastScrapeResult.rows[0]?.last_scrape || null;

      // Determine completion status for each step
      const completedSteps = {
        profile: hasProfile && profile.username !== null && profile.username !== 'User',
        accounts: accountCount > 0,
        firstScrape: transactionCount > 0,
        explored: profile?.onboarding_dismissed === 1 || transactionCount > 50 // Auto-complete if 50+ transactions
      };

      // Calculate overall completion
      const isComplete = Object.values(completedSteps).every(step => step === true);

      // Suggest next action based on completion
      let suggestedAction = null;
      if (!completedSteps.profile) {
        suggestedAction = 'profile';
      } else if (!completedSteps.accounts) {
        suggestedAction = 'accounts';
      } else if (!completedSteps.firstScrape) {
        suggestedAction = 'scrape';
      } else if (!completedSteps.explored) {
        suggestedAction = 'explore';
      }

      // Return onboarding status
      res.json({
        isComplete,
        completedSteps,
        stats: {
          accountCount,
          transactionCount,
          lastScrapeDate,
          hasProfile
        },
        suggestedAction
      });

    } catch (error) {
      console.error('Error fetching onboarding status:', error);
      res.status(500).json({
        error: 'Failed to fetch onboarding status',
        message: error.message
      });
    }
  }

  // POST /api/onboarding/dismiss
  async dismiss(req, res) {
    try {
      // Check if user profile exists
      const profileCheckResult = await dbManager.query(`
        SELECT id FROM user_profile LIMIT 1
      `);

      if (profileCheckResult.rows.length === 0) {
        // Create a minimal profile if it doesn't exist
        await dbManager.query(`
          INSERT INTO user_profile (
            username,
            onboarding_dismissed,
            onboarding_dismissed_at,
            last_active_at,
            household_size,
            children_count
          ) VALUES (?, 1, datetime('now'), datetime('now'), 1, 0)
        `, ['User']);
      } else {
        // Update existing profile
        await dbManager.query(`
          UPDATE user_profile
          SET
            onboarding_dismissed = 1,
            onboarding_dismissed_at = datetime('now'),
            last_active_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?
        `, [profileCheckResult.rows[0].id]);
      }

      res.json({
        success: true,
        message: 'Onboarding dismissed successfully'
      });

    } catch (error) {
      console.error('Error dismissing onboarding:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to dismiss onboarding',
        message: error.message
      });
    }
  }
}

module.exports = new OnboardingAPIRoutes();
