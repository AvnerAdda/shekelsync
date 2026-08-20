const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const optimizerService = require('../optimizer.js');
const optimizerV2Service = require('../optimizer-v2.js');
const profileService = require('../profile.js');
const createSqlitePool = require('../../../lib/sqlite-pool.js');
const { initializeSqliteDatabase } = require('../../../../scripts/init_sqlite_db.js');

function completion(title, evidenceFactKey = 'start.location') {
  return {
    success: true,
    model: 'gpt-4o-mini',
    finishReason: 'stop',
    message: {
      content: JSON.stringify({
        recommendations: [{
          title,
          section: 'subscriptions',
          rationale: `${title} rationale`,
          evidence: [evidenceFactKey],
          estimatedMonthlyImpact: 120,
          hassleLevel: 'low',
          confidence: 0.8,
          nextAction: `${title} next action`,
          caveat: `${title} caveat`,
        }],
      }),
    },
  };
}

async function withDatabase(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-optimizer-'));
  const databasePath = path.join(tempDir, 'optimizer.sqlite');
  let pool;
  const originalLog = console.log;
  try {
    console.log = () => {};
    initializeSqliteDatabase({ output: databasePath, force: true, withDemo: false });
    console.log = originalLog;
    pool = createSqlitePool({ databasePath });
    optimizerService.__setDatabase({ getClient: () => pool.connect() });
    optimizerV2Service.__setDatabase({ getClient: () => pool.connect() });
    await run(pool);
  } finally {
    console.log = originalLog;
    optimizerService.__resetDatabase();
    optimizerService.__resetOpenAI();
    optimizerService.__resetGenerationState();
    optimizerV2Service.__resetDatabase();
    optimizerV2Service.__resetOpenAI();
    pool?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function completedMonthDate(monthsAgo, day = 15) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day))
    .toISOString().slice(0, 10);
}

async function runOptimizerV2Lifecycle() {
  await withDatabase(async (pool) => {
    const profile = await pool.query(`
      INSERT INTO user_profile (
        username, marital_status, age, monthly_income, location, household_size,
        home_ownership, employment_status
      ) VALUES ('v2-profile', 'married', 39, 999999, 'Israel', 2, 'rent', 'employed')
      RETURNING id
    `);
    assert.ok(profile.rows[0].id);
    const salaryCategory = await pool.query(`
      INSERT INTO category_definitions (name, name_en, category_type, is_counted_as_income)
      VALUES ('Integration Salary', 'Salary', 'income', 1)
      RETURNING id
    `);
    const irregularCategory = await pool.query(`
      INSERT INTO category_definitions (name, name_en, category_type, is_counted_as_income)
      VALUES ('Integration Other Income', 'Other income', 'income', 1)
      RETURNING id
    `);
    const salaryId = salaryCategory.rows[0].id;
    const irregularId = irregularCategory.rows[0].id;
    for (const [index, amount] of [24000, 24500, 23500].entries()) {
      await pool.query(`
        INSERT INTO transactions (
          identifier, vendor, date, name, price, type, status,
          category_definition_id, category_type, is_pikadon_related
        ) VALUES ($1, 'integration', $2, $3, $4, 'income', 'completed', $5, 'income', 0)
      `, [`salary-${index}`, completedMonthDate(3 - index), `Private employer ${9000 + index}`, amount, salaryId]);
    }
    await pool.query(`
      INSERT INTO transactions (
        identifier, vendor, date, name, price, type, status,
        category_definition_id, category_type, is_pikadon_related
      ) VALUES ('irregular-1', 'integration', $1, 'One-time private sale', 100000, 'income', 'completed', $2, 'income', 0)
    `, [completedMonthDate(1), irregularId]);
    await pool.query(`
      INSERT INTO subscriptions (
        pattern_key, display_name, detected_frequency, detected_amount, status
      ) VALUES ('integration-subscription', 'Streaming service', 'monthly', 200, 'review')
    `);

    const initial = await optimizerV2Service.getOptimizerV2Status();
    assert.equal(initial.review.groups.length, 5);
    assert.equal(initial.review.ready, false);
    const cashFlow = initial.review.groups.find((group) => group.key === 'cash_flow');
    const recurring = cashFlow.facts.find((item) => item.key === 'recurring_income');
    const observed = cashFlow.facts.find((item) => item.key === 'observed_inflows');
    assert.equal(recurring.value, 24000);
    assert.ok(observed.value > recurring.value);
    assert.ok(!cashFlow.facts.some((item) => item.label.toLowerCase().includes('reported monthly income')));

    for (const group of initial.review.groups) {
      await optimizerV2Service.updateReviewGroup(group.key, {
        status: 'confirmed',
        fingerprint: group.fingerprint,
      });
    }
    const reviewed = await optimizerV2Service.getOptimizerV2Status();
    assert.equal(reviewed.review.ready, true);

    const generated = await optimizerV2Service.generateOptimizerV2({
      researchMode: 'offline',
      scope: {
        primary: 'spending_subscriptions',
        extras: [],
        change: 'negotiate_only',
        effort: 'low',
        liquidity: 'no_lockup',
        selectedProviders: [],
      },
    });
    assert.ok(generated.run.candidates.length > 0);
    assert.equal((await pool.query('SELECT COUNT(*) AS count FROM smart_action_items')).rows[0].count, 0);
    const candidate = generated.run.candidates[0];
    const added = await optimizerV2Service.updateCandidateStatus(candidate.id, { status: 'added' });
    assert.equal(added.candidate.lifecycleState, 'added');
    assert.equal((await pool.query('SELECT COUNT(*) AS count FROM smart_action_items')).rows[0].count, 1);
    await optimizerV2Service.updateCandidateStatus(candidate.id, {
      status: 'feedback',
      feedbackCode: 'useful',
      feedbackReasons: ['already_done'],
    });
    const done = await optimizerV2Service.updateCandidateStatus(candidate.id, {
      status: 'done',
      outcomeBand: 'within_estimate',
    });
    assert.equal(done.candidate.outcomeBand, 'within_estimate');

    const responsesPayloads = [];
    optimizerV2Service.__setOpenAI({
      getClient: () => ({
        responses: {
          create: async (payload) => {
            responsesPayloads.push(payload);
            if (payload.tools) return { output_text: JSON.stringify({ offers: [] }) };
            const input = JSON.parse(payload.input);
            return {
              output_text: JSON.stringify({
                wording: input.actions.map((action) => ({
                  actionId: action.actionId,
                  title: action.title,
                  rationale: action.rationale,
                  nextAction: action.nextAction,
                  caveat: action.caveat,
                })),
              }),
            };
          },
        },
      }),
    });
    const live = await optimizerV2Service.generateOptimizerV2({
      openaiApiKey: 'sk-test',
      researchMode: 'live',
      scope: {
        primary: 'general', extras: [], change: 'negotiate_only', effort: 'low',
        liquidity: 'no_lockup', selectedProviders: [],
      },
    });
    assert.equal(live.run.researchStatus, 'complete');
    const webPayloads = responsesPayloads.filter((payload) => payload.tools);
    assert.equal(webPayloads.length, 3);
    const serializedWebPayloads = JSON.stringify(webPayloads);
    for (const forbidden of ['24000', '999999', 'Private employer', 'One-time private sale', 'Streaming service']) {
      assert.ok(!serializedWebPayloads.includes(forbidden));
    }

    const persisted = JSON.stringify({
      runs: (await pool.query('SELECT * FROM optimizer_v2_runs')).rows,
      candidates: (await pool.query('SELECT * FROM optimizer_v2_candidates')).rows,
    });
    assert.ok(!persisted.includes('Private employer'));
    assert.ok(!persisted.includes('One-time private sale'));
    assert.ok(!persisted.includes('999999'));
    assert.equal((await pool.query('SELECT COUNT(*) AS count FROM optimizer_runs')).rows[0].count, 0);

    await pool.query(`
      INSERT INTO transactions (
        identifier, vendor, date, name, price, type, status,
        category_definition_id, category_type, is_pikadon_related
      ) VALUES ('changed-data', 'integration', $1, 'Changed data marker', 25000, 'income', 'completed', $2, 'income', 0)
    `, [completedMonthDate(1, 20), salaryId]);
    const changed = await optimizerV2Service.getOptimizerV2Status();
    assert.equal(changed.review.groups.find((group) => group.key === 'cash_flow').status, 'pending');
  });
}

async function runLifecycle() {
  await withDatabase(async (pool) => {
    const institutionRows = (await pool.query(`
      SELECT id, vendor_code, institution_type
      FROM institution_nodes
      WHERE node_type = 'institution'
        AND institution_type IN ('bank', 'credit_card')
      ORDER BY id ASC
    `)).rows;
    const bank = institutionRows.find((row) => row.institution_type === 'bank');
    const card = institutionRows.find((row) => row.institution_type === 'credit_card');
    assert.ok(bank);
    assert.ok(card);
    await pool.query(`
      INSERT INTO vendor_credentials (
        id_number, username, vendor, current_balance, balance_updated_at, institution_id
      ) VALUES
        ('optimizer-bank', 'optimizer-bank', $1, 5000, '2026-07-01', $2),
        ('optimizer-card', 'optimizer-card', $3, 7000, '2026-07-02', $4)
    `, [bank.vendor_code, bank.id, card.vendor_code, card.id]);

    const initialStatus = await optimizerService.getOptimizerStatus();
    const cashFact = initialStatus.facts.find((fact) => fact.factKey === 'banking.cash_balance');
    assert.equal(cashFact?.value, 5000);
    await optimizerService.saveOptimizerFacts({
      facts: [{
        factKey: 'banking.cash_balance',
        value: cashFact.value,
        status: 'confirmed',
        source: 'detected_confirmed',
        confidence: cashFact.confidence,
        evidence: cashFact.evidence,
      }],
    });

    const responses = [
      completion('First plan', 'banking.cash_balance'),
      completion('Current plan', 'banking.cash_balance'),
      {
        success: true,
        model: 'gpt-4o-mini',
        finishReason: 'stop',
        message: { content: '{invalid json' },
      },
    ];
    optimizerService.__setOpenAI({
      isConfigured: () => true,
      createCompletion: async () => responses.shift(),
    });

    const first = await optimizerService.generateOptimizerPlan({ openaiApiKey: 'sk-test' });
    const second = await optimizerService.generateOptimizerPlan({ openaiApiKey: 'sk-test' });
    await assert.rejects(
      optimizerService.generateOptimizerPlan({ openaiApiKey: 'sk-test' }),
      /invalid JSON/i,
    );

    const status = await optimizerService.getOptimizerStatus();
    assert.equal(status.latestRun.id, second.latestRun.id);
    assert.deepEqual(status.recommendations.map((item) => item.title), ['Current plan']);

    const recommendationRows = (await pool.query(`
      SELECT id, run_id, status, smart_action_item_id, next_action, caveat
      FROM optimizer_recommendations
      ORDER BY id ASC
    `)).rows;
    assert.equal(recommendationRows.length, 2);
    assert.deepEqual(
      recommendationRows.map((row) => [row.run_id, row.status]),
      [[first.latestRun.id, 'dismissed'], [second.latestRun.id, 'active']],
    );
    assert.equal(recommendationRows[1].next_action, 'Current plan next action');
    assert.equal(recommendationRows[1].caveat, 'Current plan caveat');

    const actionRows = (await pool.query(`
      SELECT id, user_status
      FROM smart_action_items
      WHERE action_type = 'optimization'
      ORDER BY id ASC
    `)).rows;
    assert.deepEqual(actionRows.map((row) => row.user_status), ['dismissed', 'active']);

    const client = await pool.connect();
    const chatContext = await optimizerService.getOptimizerContextForChat(client);
    assert.deepEqual(chatContext.recommendations.map((item) => item.title), ['Current plan']);

    const currentRecommendation = status.recommendations[0];
    const snoozed = await optimizerService.updateRecommendationStatus(currentRecommendation.id, {
      status: 'snoozed',
      userNote: 'Review after renewal',
    });
    assert.equal(snoozed.recommendation.status, 'active');
    assert.ok(snoozed.recommendation.snoozedUntil);
    const snoozedAction = (await pool.query(`
      SELECT user_status, snoozed_until
      FROM smart_action_items
      WHERE id = $1
    `, [currentRecommendation.smartActionItemId])).rows[0];
    assert.equal(snoozedAction.user_status, 'snoozed');
    assert.ok(snoozedAction.snoozed_until);

    const completed = await optimizerService.updateRecommendationStatus(currentRecommendation.id, {
      status: 'done',
      userNote: 'Cancelled after checking usage',
      realizedMonthlySavings: 95,
    });
    assert.equal(completed.recommendation.status, 'done');
    assert.equal(completed.recommendation.realizedMonthlySavings, 95);
    assert.equal(completed.recommendation.userNote, 'Cancelled after checking usage');
    assert.ok(completed.recommendation.completedAt);

    const completedStatus = await optimizerService.getOptimizerStatus();
    assert.equal(completedStatus.recommendations[0].status, 'done');
    assert.equal(completedStatus.recommendations[0].realizedMonthlySavings, 95);
    const history = await optimizerService.getOptimizerHistory({ limit: 20 });
    const currentRunHistory = history.runs.find((run) => run.id === second.latestRun.id);
    assert.equal(currentRunHistory.doneCount, 1);
    assert.equal(currentRunHistory.realizedMonthlySavings, 95);

    await pool.query(`
      UPDATE vendor_credentials
      SET current_balance = 10000,
          balance_updated_at = '2026-07-15'
      WHERE id_number = 'optimizer-bank'
    `);
    const driftedStatus = await optimizerService.getOptimizerStatus();
    const driftedCash = driftedStatus.facts.find((fact) => fact.factKey === 'banking.cash_balance');
    assert.equal(driftedCash?.value, 10000);
    assert.equal(driftedCash?.status, 'detected');
    assert.equal(driftedCash?.persisted, false);
    assert.equal(driftedStatus.isStale, true);
    assert.ok(driftedStatus.questions.some((question) => question.factKey === 'banking.cash_balance'));
    const driftedChatContext = await optimizerService.getOptimizerContextForChat(client);
    assert.deepEqual(driftedChatContext.recommendations, []);
    assert.ok(!driftedChatContext.facts.some((fact) => fact.factKey === 'banking.cash_balance'));

  });
}

async function runConcurrency() {
  await withDatabase(async () => {
    await optimizerService.saveOptimizerFacts({
      facts: [{ factKey: 'start.location', value: 'Haifa', status: 'confirmed' }],
    });
    let releaseCompletion;
    optimizerService.__setOpenAI({
      isConfigured: () => true,
      createCompletion: () => new Promise((resolve) => {
        releaseCompletion = resolve;
      }),
    });

    const firstGeneration = optimizerService.generateOptimizerPlan({ openaiApiKey: 'sk-test' });
    while (!releaseCompletion) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      optimizerService.generateOptimizerPlan({ openaiApiKey: 'sk-test' }),
      (error) => error?.status === 409 && error?.code === 'OPTIMIZER_GENERATION_IN_PROGRESS',
    );
    releaseCompletion(completion('Only plan'));
    const result = await firstGeneration;
    assert.equal(result.recommendations[0].title, 'Only plan');
  });
}

async function runCompletedTransactionsOnly() {
  await withDatabase(async (pool) => {
    const transactionDate = profileService.utils.getCompletedMonthWindow(new Date(), 6).endDate;
    await pool.query(`
      INSERT INTO transactions (
        identifier, vendor, date, name, price, type, status, category_type
      ) VALUES
        ('optimizer-completed', 'optimizer-test', $1, 'Completed expense', -1000, 'normal', 'completed', 'expense'),
        ('optimizer-pending', 'optimizer-test', $2, 'Pending expense', -9000, 'normal', 'pending', 'expense')
    `, [transactionDate, transactionDate]);

    const client = await pool.connect();
    try {
      const facts = await optimizerService.utils.buildDetectedFacts(client);
      const total = facts.find((fact) => fact.factKey === 'expenses.monthly_total');
      const topExpenses = facts.find((fact) => fact.factKey === 'pain.top_expenses');
      assert.equal(total?.value, 1000);
      assert.match(topExpenses?.valueText || '', /1,000/);
      assert.doesNotMatch(topExpenses?.valueText || '', /10,000/);
    } finally {
      client.release();
    }
  });
}

async function runLegacySmartActionUpgrade() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-optimizer-legacy-'));
  const databasePath = path.join(tempDir, 'optimizer.sqlite');
  let pool;
  const originalLog = console.log;
  try {
    console.log = () => {};
    initializeSqliteDatabase({ output: databasePath, force: true, withDemo: false });
    console.log = originalLog;

    const Database = require(path.join(__dirname, '../../../node_modules/better-sqlite3'));
    const legacyDb = new Database(databasePath);
    try {
      legacyDb.pragma('foreign_keys = OFF');
      legacyDb.exec(`
        DROP TRIGGER IF EXISTS update_smart_action_items_timestamp;
        DROP TRIGGER IF EXISTS log_smart_action_item_status_change;
        DROP TABLE action_item_history;
        DROP TABLE smart_action_items;
        CREATE TABLE smart_action_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action_type TEXT NOT NULL CHECK(action_type IN ('anomaly', 'budget_overrun', 'optimization')),
          trigger_category_id INTEGER,
          severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high')),
          title TEXT NOT NULL,
          description TEXT,
          detected_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT,
          dismissed_at TEXT,
          user_status TEXT NOT NULL DEFAULT 'active' CHECK(user_status IN ('active', 'dismissed', 'resolved')),
          metadata TEXT,
          potential_impact REAL,
          detection_confidence REAL DEFAULT 0.5,
          is_recurring INTEGER NOT NULL DEFAULT 0,
          recurrence_key TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (trigger_category_id) REFERENCES category_definitions(id) ON DELETE SET NULL
        );
        CREATE TABLE action_item_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          smart_action_item_id INTEGER NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('created', 'dismissed', 'resolved', 'accepted', 'completed', 'failed')),
          previous_status TEXT,
          new_status TEXT,
          user_note TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (smart_action_item_id) REFERENCES smart_action_items(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_action_item_history_item_id
          ON action_item_history(smart_action_item_id, created_at DESC);
        INSERT INTO smart_action_items (
          id, action_type, severity, title, description, detected_at,
          dismissed_at, user_status, metadata, potential_impact,
          detection_confidence, is_recurring, recurrence_key, created_at, updated_at
        ) VALUES (
          41, 'optimization', 'high', 'Legacy action', 'Keep me',
          '2026-01-01 10:00:00', '2026-01-02 10:00:00', 'dismissed',
          '{"legacy":true}', 250, 0.8, 0, 'legacy-41',
          '2026-01-01 10:00:00', '2026-01-02 10:00:00'
        );
        INSERT INTO action_item_history (
          id, smart_action_item_id, action, previous_status, new_status,
          user_note, metadata, created_at
        ) VALUES (
          73, 41, 'dismissed', 'active', 'dismissed',
          'legacy note', '{"source":"legacy"}', '2026-01-02 10:00:00'
        );
      `);
    } finally {
      legacyDb.close();
    }

    const assertUpgradedState = async (activePool) => {
      const action = (await activePool.query(`
        SELECT id, title, user_status, created_at, updated_at
        FROM smart_action_items WHERE id = 41
      `)).rows[0];
      assert.deepEqual(action, {
        id: 41,
        title: 'Legacy action',
        user_status: action.user_status,
        created_at: '2026-01-01 10:00:00',
        updated_at: action.updated_at,
      });
      const originalHistory = (await activePool.query(`
        SELECT id, smart_action_item_id, action, user_note, metadata, created_at
        FROM action_item_history WHERE id = 73
      `)).rows[0];
      assert.deepEqual(originalHistory, {
        id: 73,
        smart_action_item_id: 41,
        action: 'dismissed',
        user_note: 'legacy note',
        metadata: '{"source":"legacy"}',
        created_at: '2026-01-02 10:00:00',
      });
      const tableSql = (await activePool.query(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'action_item_history'
      `)).rows[0]?.sql || '';
      for (const actionName of ['snoozed', 'reactivated', 'updated']) {
        assert.match(tableSql, new RegExp(`'${actionName}'`));
      }
      const indexes = (await activePool.query("PRAGMA index_list('action_item_history')")).rows;
      assert.ok(indexes.some((index) => index.name === 'idx_action_item_history_item_id'));
      assert.deepEqual((await activePool.query('PRAGMA foreign_key_check')).rows, []);
      return action;
    };

    pool = createSqlitePool({ databasePath });
    const migratedAction = await assertUpgradedState(pool);
    assert.equal(migratedAction.user_status, 'dismissed');
    assert.equal(migratedAction.updated_at, '2026-01-02 10:00:00');
    await pool.query("UPDATE smart_action_items SET user_status = 'active' WHERE id = 41");
    await pool.query("UPDATE smart_action_items SET user_status = 'snoozed' WHERE id = 41");
    const transitionActions = (await pool.query(`
      SELECT action FROM action_item_history
      WHERE smart_action_item_id = 41 AND id != 73
      ORDER BY id ASC
    `)).rows.map((row) => row.action);
    assert.deepEqual(transitionActions, ['reactivated', 'snoozed']);

    pool.close();
    pool = createSqlitePool({ databasePath });
    const reopenedAction = await assertUpgradedState(pool);
    assert.equal(reopenedAction.user_status, 'snoozed');
    const historyCount = (await pool.query(`
      SELECT COUNT(*) AS count FROM action_item_history WHERE smart_action_item_id = 41
    `)).rows[0]?.count;
    assert.equal(historyCount, 3);
  } finally {
    console.log = originalLog;
    pool?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runNearCurrentSmartActionUpgrade() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-optimizer-near-current-'));
  const databasePath = path.join(tempDir, 'optimizer.sqlite');
  let pool;
  const originalLog = console.log;
  try {
    console.log = () => {};
    initializeSqliteDatabase({ output: databasePath, force: true, withDemo: false });
    console.log = originalLog;

    const Database = require(path.join(__dirname, '../../../node_modules/better-sqlite3'));
    const nearCurrentDb = new Database(databasePath);
    try {
      const smartActionSql = nearCurrentDb.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'smart_action_items'
      `).get()?.sql;
      const historySql = nearCurrentDb.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'action_item_history'
      `).get()?.sql;
      assert.ok(smartActionSql);
      assert.ok(historySql);
      const nearCurrentSql = smartActionSql
        .replace(
          /^CREATE TABLE\s+(?:"smart_action_items"|smart_action_items)/i,
          'CREATE TABLE smart_action_items__near_current',
        )
        .replace(/'optimization'\s*,\s*/i, '');
      assert.notEqual(nearCurrentSql, smartActionSql);
      assert.doesNotMatch(nearCurrentSql, /'optimization'/);
      assert.match(nearCurrentSql, /'optimization_reallocate'/);

      nearCurrentDb.pragma('foreign_keys = OFF');
      nearCurrentDb.exec('DROP TRIGGER IF EXISTS update_smart_action_items_timestamp');
      nearCurrentDb.exec('DROP TRIGGER IF EXISTS log_smart_action_item_status_change');
      nearCurrentDb.exec(nearCurrentSql);
      nearCurrentDb.exec('DROP TABLE action_item_history');
      nearCurrentDb.exec('DROP TABLE smart_action_items');
      nearCurrentDb.exec('ALTER TABLE smart_action_items__near_current RENAME TO smart_action_items');
      nearCurrentDb.exec(historySql);
      nearCurrentDb.exec(`
        CREATE INDEX idx_action_item_history_item_id
        ON action_item_history(smart_action_item_id, created_at DESC)
      `);
      nearCurrentDb.pragma('foreign_keys = ON');
    } finally {
      nearCurrentDb.close();
    }

    pool = createSqlitePool({ databasePath });
    const upgradedSql = (await pool.query(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'smart_action_items'
    `)).rows[0]?.sql || '';
    assert.match(upgradedSql, /'optimization'/);
    await pool.query(`
      INSERT INTO smart_action_items (action_type, title)
      VALUES ('optimization', 'Generic optimizer action')
    `);
    const inserted = (await pool.query(`
      SELECT action_type, title FROM smart_action_items
      WHERE title = 'Generic optimizer action'
    `)).rows[0];
    assert.deepEqual(inserted, {
      action_type: 'optimization',
      title: 'Generic optimizer action',
    });
    assert.deepEqual((await pool.query('PRAGMA foreign_key_check')).rows, []);
  } finally {
    console.log = originalLog;
    pool?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runLegacyOptimizerFollowThroughUpgrade() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-optimizer-follow-through-'));
  const databasePath = path.join(tempDir, 'optimizer.sqlite');
  let pool;
  const originalLog = console.log;
  try {
    console.log = () => {};
    initializeSqliteDatabase({ output: databasePath, force: true, withDemo: false });
    console.log = originalLog;

    const Database = require(path.join(__dirname, '../../../node_modules/better-sqlite3'));
    const legacyDb = new Database(databasePath);
    try {
      for (const column of ['completed_at', 'snoozed_until', 'realized_monthly_savings', 'user_note']) {
        legacyDb.exec(`ALTER TABLE optimizer_recommendations DROP COLUMN ${column}`);
      }
      const legacyColumns = legacyDb.prepare("PRAGMA table_info('optimizer_recommendations')").all();
      assert.ok(!legacyColumns.some((column) => column.name === 'user_note'));
    } finally {
      legacyDb.close();
    }

    const assertFollowThroughColumns = async (activePool) => {
      const columns = (await activePool.query("PRAGMA table_info('optimizer_recommendations')")).rows;
      const columnNames = new Set(columns.map((column) => column.name));
      for (const column of ['user_note', 'realized_monthly_savings', 'snoozed_until', 'completed_at']) {
        assert.ok(columnNames.has(column));
      }
    };

    pool = createSqlitePool({ databasePath });
    await assertFollowThroughColumns(pool);
    pool.close();
    pool = createSqlitePool({ databasePath });
    await assertFollowThroughColumns(pool);
  } finally {
    console.log = originalLog;
    pool?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const scenario = process.argv[2];
  if (scenario === 'lifecycle') {
    await runLifecycle();
  } else if (scenario === 'concurrency') {
    await runConcurrency();
  } else if (scenario === 'completed-transactions-only') {
    await runCompletedTransactionsOnly();
  } else if (scenario === 'legacy-smart-action-upgrade') {
    await runLegacySmartActionUpgrade();
  } else if (scenario === 'near-current-smart-action-upgrade') {
    await runNearCurrentSmartActionUpgrade();
  } else if (scenario === 'legacy-optimizer-follow-through-upgrade') {
    await runLegacyOptimizerFollowThroughUpgrade();
  } else if (scenario === 'v2-lifecycle') {
    await runOptimizerV2Lifecycle();
  } else {
    throw new Error(`Unknown optimizer integration scenario: ${scenario}`);
  }
  process.stdout.write(`optimizer-integration:${scenario}:ok\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
