const express = require('express');

const database = require('../services/database.js');
const { getVendorCodesByTypes } = require('../services/institutions.js');
const { dialect } = require('../../lib/sql-dialect.js');

// Test helpers for dependency injection
let testDatabase = null;

function __setDatabase(db) {
  testDatabase = db;
}

function __resetDatabase() {
  testDatabase = null;
}

function getDatabase() {
  return testDatabase || database;
}

const TIP_IDS = [
  'add_bank',
  'add_credit_cards',
  'pair_accounts',
  'manage_categories',
  'categorize',
  'create_rules',
  'search_transactions',
  'categorize_investments',
  'add_investments',
  'set_budgets',
  'add_notes_tags',
  'try_chatbot',
  'accept_quest',
  'sync_reminder',
];

function buildInClause(values) {
  if (!values || values.length === 0) return null;
  if (dialect.useSqlite) {
    const placeholders = values.map(() => '?').join(',');
    return { clause: `(${placeholders})`, params: values };
  }
  return { clause: '(ANY($1))', params: [values] };
}

let columnEnsured = false;
async function ensureGuideTipsColumn(client) {
  if (columnEnsured) return;
  try {
    const cols = await client.query("PRAGMA table_info(user_profile)");
    const has = (cols.rows || cols).some((c) => c.name === 'guide_tips_dismissed');
    if (!has) {
      await client.query("ALTER TABLE user_profile ADD COLUMN guide_tips_dismissed TEXT DEFAULT '[]'");
    }
    columnEnsured = true;
  } catch {
    // ignore - column may already exist
    columnEnsured = true;
  }
}

async function getGuideTipsStatus(client) {
  await ensureGuideTipsColumn(client);
  const [dbBankVendors, dbCreditVendors] = await Promise.all([
    getVendorCodesByTypes(getDatabase(), ['bank']),
    getVendorCodesByTypes(getDatabase(), ['credit_card']),
  ]);

  const bankVendors = Array.isArray(dbBankVendors) ? dbBankVendors : [];
  const creditVendors = Array.isArray(dbCreditVendors) ? dbCreditVendors : [];

  // 1. Bank account count
  let bankAccountCount = 0;
  const bankIn = buildInClause(bankVendors);
  if (bankIn) {
    const r = await client.query(
      `SELECT COUNT(*) AS count FROM vendor_credentials WHERE vendor IN ${bankIn.clause}`,
      bankIn.params,
    );
    bankAccountCount = Number.parseInt(r.rows[0]?.count || 0, 10);
  }

  // 2. Credit card count
  let creditCardCount = 0;
  const creditIn = buildInClause(creditVendors);
  if (creditIn) {
    const r = await client.query(
      `SELECT COUNT(*) AS count FROM vendor_credentials WHERE vendor IN ${creditIn.clause}`,
      creditIn.params,
    );
    creditCardCount = Number.parseInt(r.rows[0]?.count || 0, 10);
  }

  // 3. Unpaired credit card accounts
  let unpairedCount = 0;
  if (creditIn) {
    const r = await client.query(
      `SELECT COUNT(*) AS count FROM vendor_credentials vc
       WHERE vc.vendor IN ${creditIn.clause}
         AND NOT EXISTS (
           SELECT 1 FROM account_pairings ap
           WHERE ap.credit_card_vendor = vc.vendor
             AND ap.is_active = 1
         )`,
      creditIn.params,
    );
    unpairedCount = Number.parseInt(r.rows[0]?.count || 0, 10);
  }

  // 4. Uncategorized transactions count
  const uncatResult = await client.query(
    `SELECT COUNT(*) AS count FROM transactions
     WHERE category_definition_id IS NULL`,
  );
  const uncategorizedCount = Number.parseInt(uncatResult.rows[0]?.count || 0, 10);

  // 5. Categorization rules count
  const rulesResult = await client.query(
    'SELECT COUNT(*) AS count FROM categorization_rules WHERE is_active = 1',
  );
  const ruleCount = Number.parseInt(rulesResult.rows[0]?.count || 0, 10);

  // 6. Investment accounts count
  const investResult = await client.query(
    'SELECT COUNT(*) AS count FROM investment_accounts WHERE is_active = 1',
  );
  const investmentAccountCount = Number.parseInt(investResult.rows[0]?.count || 0, 10);

  // 7. Budget count
  const budgetResult = await client.query(
    'SELECT COUNT(*) AS count FROM category_budgets WHERE is_active = 1',
  );
  const budgetCount = Number.parseInt(budgetResult.rows[0]?.count || 0, 10);

  // 8. Notes and tags count
  const notesResult = await client.query(
    `SELECT COUNT(*) AS count FROM transactions WHERE memo IS NOT NULL AND memo != ''`,
  );
  const notesCount = Number.parseInt(notesResult.rows[0]?.count || 0, 10);

  const tagsResult = await client.query(
    `SELECT COUNT(*) AS count FROM transactions WHERE tags IS NOT NULL AND tags != '' AND tags != '[]'`,
  );
  const tagsCount = Number.parseInt(tagsResult.rows[0]?.count || 0, 10);

  // 9. Chat conversations (chatbot usage)
  const chatResult = await client.query(
    'SELECT COUNT(*) AS count FROM chat_conversations',
  );
  const chatCount = Number.parseInt(chatResult.rows[0]?.count || 0, 10);

  // 10. Quests accepted
  const questResult = await client.query(
    `SELECT COUNT(*) AS count FROM smart_action_items
     WHERE user_status IN ('accepted', 'resolved')
       AND action_type LIKE 'quest_%'`,
  );
  const acceptedQuestCount = Number.parseInt(questResult.rows[0]?.count || 0, 10);

  // 11. Last sync date
  const syncResult = await client.query(
    `SELECT MAX(last_scrape_success) AS last_sync FROM vendor_credentials`,
  );
  const lastSync = syncResult.rows[0]?.last_sync || null;

  // 12. Get manually dismissed tips
  const dismissedResult = await client.query(
    `SELECT guide_tips_dismissed FROM user_profile LIMIT 1`,
  );
  let manuallyDone = [];
  const rawDismissed = dismissedResult.rows[0]?.guide_tips_dismissed;
  if (rawDismissed) {
    try {
      const parsed = typeof rawDismissed === 'string' ? JSON.parse(rawDismissed) : rawDismissed;
      manuallyDone = Array.isArray(parsed) ? parsed : [];
    } catch {
      // ignore parse errors
    }
  }

  // Check sync freshness (within last 2 days)
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const syncFresh = lastSync
    ? Date.now() - new Date(lastSync).getTime() < TWO_DAYS_MS
    : false;

  const tips = [
    {
      id: 'add_bank',
      completed: bankAccountCount > 0,
      data: { bankAccountCount },
    },
    {
      id: 'add_credit_cards',
      completed: creditCardCount > 0 || manuallyDone.includes('add_credit_cards'),
      data: { creditCardCount },
    },
    {
      id: 'pair_accounts',
      completed: unpairedCount === 0,
      data: { unpairedCount },
    },
    {
      id: 'manage_categories',
      completed: manuallyDone.includes('manage_categories'),
      data: {},
    },
    {
      id: 'categorize',
      completed: uncategorizedCount === 0,
      data: { uncategorizedCount },
    },
    {
      id: 'create_rules',
      completed: ruleCount > 0 || manuallyDone.includes('create_rules'),
      data: { ruleCount },
    },
    {
      id: 'search_transactions',
      completed: manuallyDone.includes('search_transactions'),
      data: {},
    },
    {
      id: 'categorize_investments',
      completed: manuallyDone.includes('categorize_investments'),
      data: {},
    },
    {
      id: 'add_investments',
      completed: investmentAccountCount > 0 || manuallyDone.includes('add_investments'),
      data: { investmentAccountCount },
    },
    {
      id: 'set_budgets',
      completed: budgetCount > 0,
      data: { budgetCount },
    },
    {
      id: 'add_notes_tags',
      completed: (notesCount > 0 || tagsCount > 0) || manuallyDone.includes('add_notes_tags'),
      data: { notesCount, tagsCount },
    },
    {
      id: 'try_chatbot',
      completed: chatCount > 0 || manuallyDone.includes('try_chatbot'),
      data: {},
    },
    {
      id: 'accept_quest',
      completed: acceptedQuestCount > 0,
      data: { acceptedCount: acceptedQuestCount },
    },
    {
      id: 'sync_reminder',
      completed: syncFresh,
      data: { lastSync },
    },
  ];

  return { tips, manuallyDone };
}

function createGuideTipsRouter() {
  const router = express.Router();

  router.get('/status', async (_req, res) => {
    let client = null;
    try {
      client = await getDatabase().getClient();
      const status = await getGuideTipsStatus(client);
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('[GuideTips] Status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch guide tips status',
        message: error?.message,
      });
    } finally {
      if (client && typeof client.release === 'function') {
        client.release();
      }
    }
  });

  router.post('/dismiss', async (req, res) => {
    let client = null;
    try {
      const { tipId } = req.body || {};
      if (!tipId || !TIP_IDS.includes(tipId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid tip ID',
        });
      }

      client = await getDatabase().getClient();

      // Read current dismissed state from user_profile
      const profileResult = await client.query(
        'SELECT guide_tips_dismissed FROM user_profile LIMIT 1',
      );

      let dismissedList = [];
      const raw = profileResult.rows[0]?.guide_tips_dismissed;
      if (raw) {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          dismissedList = Array.isArray(parsed) ? parsed : [];
        } catch {
          dismissedList = [];
        }
      }

      if (!dismissedList.includes(tipId)) {
        dismissedList.push(tipId);
      }

      await client.query(
        'UPDATE user_profile SET guide_tips_dismissed = ? WHERE 1=1',
        [JSON.stringify(dismissedList)],
      );

      res.json({ success: true });
    } catch (error) {
      console.error('[GuideTips] Dismiss error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to dismiss tip',
        message: error?.message,
      });
    } finally {
      if (client && typeof client.release === 'function') {
        client.release();
      }
    }
  });

  return router;
}

module.exports = { createGuideTipsRouter, __setDatabase, __resetDatabase };
