const database = require('./database.js');
const { dialect } = require('../../lib/sql-dialect.js');
const { getVendorCodesByTypes } = require('./institutions.js');

function buildVendorQueryFragments(vendors) {
  if (!vendors || vendors.length === 0) {
    return null;
  }

  if (dialect.useSqlite) {
    const placeholders = vendors.map(() => '?').join(',');
    return {
      clause: `vendor IN (${placeholders})`,
      params: vendors,
    };
  }

  return {
    clause: 'vendor = ANY($1)',
    params: [vendors],
  };
}

async function getOnboardingStatus() {
  const client = await database.getClient();

  try {
    const [dbBankVendors, dbCreditVendors] = await Promise.all([
      getVendorCodesByTypes(database, ['bank']),
      getVendorCodesByTypes(database, ['credit_card']),
    ]);

    const bankVendors = Array.isArray(dbBankVendors) ? dbBankVendors : [];
    const creditVendors = Array.isArray(dbCreditVendors) ? dbCreditVendors : [];

    const profileResult = await client.query(
      `SELECT
         id,
         username,
         onboarding_dismissed,
         onboarding_dismissed_at,
         last_active_at
       FROM user_profile
       LIMIT 1`,
    );
    const hasProfile = profileResult.rows.length > 0;
    const profile = profileResult.rows[0] || null;

    const accountsResult = await client.query('SELECT COUNT(*) AS count FROM vendor_credentials');
    const accountCount = Number.parseInt(accountsResult.rows[0]?.count || 0, 10);

    let bankAccountCount = 0;
    const bankQuery = buildVendorQueryFragments(bankVendors);
    if (bankQuery) {
      const bankAccountsResult = await client.query(
        `SELECT COUNT(*) AS count FROM vendor_credentials WHERE ${bankQuery.clause}`,
        bankQuery.params,
      );
      bankAccountCount = Number.parseInt(bankAccountsResult.rows[0]?.count || 0, 10);
    }

    let creditCardCount = 0;
    const creditQuery = buildVendorQueryFragments(creditVendors);
    if (creditQuery) {
      const creditCardResult = await client.query(
        `SELECT COUNT(*) AS count FROM vendor_credentials WHERE ${creditQuery.clause}`,
        creditQuery.params,
      );
      creditCardCount = Number.parseInt(creditCardResult.rows[0]?.count || 0, 10);
    }

    const transactionsResult = await client.query('SELECT COUNT(*) AS count FROM transactions');
    const transactionCount = Number.parseInt(transactionsResult.rows[0]?.count || 0, 10);

    const lastScrapeResult = await client.query(
      `SELECT MAX(created_at) AS last_scrape
         FROM scrape_events
        WHERE status = 'success'`,
    );
    const lastScrapeDate = lastScrapeResult.rows[0]?.last_scrape || null;

    const completedSteps = {
      profile: hasProfile && profile.username !== null,
      bankAccount: bankAccountCount > 0,
      creditCard: creditCardCount > 0,
      firstScrape: transactionCount > 0,
      explored: profile?.onboarding_dismissed === 1 || transactionCount > 50,
    };

    const isComplete = Object.values(completedSteps).every(Boolean);

    let suggestedAction = null;
    if (!completedSteps.profile) {
      suggestedAction = 'profile';
    } else if (!completedSteps.bankAccount) {
      suggestedAction = 'bankAccount';
    } else if (!completedSteps.creditCard) {
      suggestedAction = 'creditCard';
    } else if (!completedSteps.firstScrape) {
      suggestedAction = 'scrape';
    } else if (!completedSteps.explored) {
      suggestedAction = 'explore';
    }

    return {
      isComplete,
      completedSteps,
      stats: {
        accountCount,
        bankAccountCount,
        creditCardCount,
        transactionCount,
        lastScrapeDate,
        hasProfile,
      },
      suggestedAction,
    };
  } finally {
    client.release();
  }
}

async function dismissOnboarding() {
  const client = await database.getClient();

  try {
    const now = new Date();
    const profileCheckResult = await client.query('SELECT id FROM user_profile LIMIT 1');

    if (profileCheckResult.rows.length === 0) {
      await client.query(
        `INSERT INTO user_profile (
           username,
           onboarding_dismissed,
           onboarding_dismissed_at,
           last_active_at
         ) VALUES ($1, $2, $3, $4)` ,
        ['User', 1, now, now],
      );
    } else {
      const profileId = profileCheckResult.rows[0].id;
      await client.query(
        `UPDATE user_profile
            SET onboarding_dismissed = $1,
                onboarding_dismissed_at = $2,
                last_active_at = $3,
                updated_at = $4
          WHERE id = $5`,
        [1, now, now, now, profileId],
      );
    }

    return {
      success: true,
      message: 'Onboarding dismissed successfully',
    };
  } finally {
    client.release();
  }
}

module.exports = {
  getOnboardingStatus,
  dismissOnboarding,
};

module.exports.default = module.exports;
