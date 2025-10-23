import { getDB } from '../db.js';

/**
 * GET /api/onboarding/status
 *
 * Returns onboarding completion status for new users.
 * Checks: profile, accounts, transactions, and dismissed flag
 *
 * Response:
 * {
 *   isComplete: boolean,
 *   completedSteps: {
 *     profile: boolean,
 *     accounts: boolean,
 *     firstScrape: boolean,
 *     explored: boolean
 *   },
 *   stats: {
 *     accountCount: number,
 *     transactionCount: number,
 *     lastScrapeDate: string | null,
 *     hasProfile: boolean
 *   },
 *   suggestedAction: 'profile' | 'accounts' | 'scrape' | 'explore' | null
 * }
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    client = await getDB();

    // Check if user profile exists
    const profileResult = await client.query(`
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
    const accountsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM vendor_credentials
    `);
    const accountCount = parseInt(accountsResult.rows[0].count);

    // Count transactions
    const transactionsResult = await client.query(`
      SELECT COUNT(*) as count
      FROM transactions
    `);
    const transactionCount = parseInt(transactionsResult.rows[0].count);

    // Get last scrape date
    const lastScrapeResult = await client.query(`
      SELECT MAX(created_at) as last_scrape
      FROM scrape_events
      WHERE status = 'success'
    `);
    const lastScrapeDate = lastScrapeResult.rows[0]?.last_scrape || null;

    // Determine completion status for each step
    const completedSteps = {
      profile: hasProfile && profile.username !== null,
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
    return res.status(200).json({
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
    return res.status(500).json({
      error: 'Failed to fetch onboarding status',
      message: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}
