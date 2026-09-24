const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const express = require('express');
const request = require('supertest');
const { initializeSqliteDatabase } = require('../../../../scripts/init_sqlite_db.js');
const { MIGRATIONS, CURRENT_SCHEMA_VERSION, runSchemaMigrations } = require('../../../lib/schema-migrations.js');
const math = require('../planning-math.js');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-planning-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  process.env.SQLITE_DB_PATH = dbPath;
  let db;
  let globalDatabase;
  try {
    initializeSqliteDatabase({ output: dbPath, databaseCtor: Database });
    db = new Database(dbPath);
    // Fresh schema and upgrades have identical planning definitions.
    const freshSql = db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('savings_goals', 'cash_scenarios', 'planning_settings') ORDER BY name").all();
    assert.equal(freshSql.length, 3);
    db.exec("CREATE TABLE existing_user_data (value TEXT); INSERT INTO existing_user_data VALUES ('preserved'); DROP TABLE savings_goals; DROP TABLE cash_scenarios; DROP TABLE planning_settings;");
    db.pragma('user_version = 8');
    const migrated = runSchemaMigrations(db, { dbPath, logger: { log() {} } });
    assert.equal(migrated.fromVersion, 8);
    assert.equal(migrated.toVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated.applied, MIGRATIONS.filter((migration) => migration.version > 8)
      .map((migration) => `v${migration.version} ${migration.name}`));
    assert.ok(fs.existsSync(migrated.backupPath));
    assert.equal(db.prepare('SELECT value FROM existing_user_data').get().value, 'preserved');
    const migratedSql = db.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('savings_goals', 'cash_scenarios', 'planning_settings') ORDER BY name").all();
    assert.deepEqual(migratedSql, freshSql);
    assert.equal(runSchemaMigrations(db, { dbPath, logger: { log() {} } }).applied.length, 0);
    MIGRATIONS.find((migration) => migration.name === 'savings-goals-cash-scenarios-and-spendability-settings').up(db);

    const today = '2026-09-08';
    let clock = new Date(2026, 8, 8, 12);
    let forecastMode = 'complete';
    let forecastCalls = 0;
    const getForecast = async (options) => {
      forecastCalls += 1;
      assert.equal(options.includeToday, false);
      assert.equal(options.recordSnapshot, false, 'planning must not alter forecast calibration');
      if (forecastMode === 'error') throw new Error('offline');
      const days = Array.from({ length: options.forecastDays }, (_, i) => ({ date: math.shiftDays(math.dateKey(clock), i + 1), expectedOperatingIncome: i === 1 ? 5000 : 0, expectedOperatingExpenses: 100,
        predictions: i === 1 ? [{ patternKey: 'salary', categoryType: 'income', incomeType: 'operating', probabilityWeightedAmount: 5000, probability: 1, isChosenOccurrence: true }] : [] }));
      if (forecastMode === 'gap') days.splice(3, 1);
      if (forecastMode === 'null') days[0].expectedOperatingExpenses = null;
      if (forecastMode === 'resolved') days[0].predictions.push({ categoryType: 'expense', probabilityWeightedAmount: 100, isUserResolvedPattern: true });
      return { analysisInfo: { totalTransactions: forecastMode === 'empty' ? 0 : 50,
        projectedEvidenceTransactions: ['noEvidence', 'resolved'].includes(forecastMode) ? 0 : 50,
        firstTransaction: forecastMode === 'short' ? '2026-09-07' : '2026-06-01',
        lastTransaction: forecastMode === 'old' ? '2025-01-01' : today }, dailyForecasts: days,
        categoryPatterns: forecastMode === 'irregular' ? [] : [{ patternKey: 'salary', monthsOfHistory: 4, confidence: 0.8, patternType: 'monthly', lastOccurrence: '2026-08-10' }] };
    };
    const adapter = { query: async (sql, values = []) => {
      const statement = db.prepare(sql.replace(/\$\d+/g, '?'));
      return { rows: statement.reader ? statement.all(...values) : (statement.run(...values), []) };
    } };
    globalDatabase = require('../database.js');
    const { createPlanningService } = require('../planning.js');
    const realForecast = require('../forecast.js');
    const forecastOptions = { includeToday: false, forecastDays: 30, monteCarloRuns: 0, recordSnapshot: false, noCache: true, __workerThread: true };
    const emptyForecast = await realForecast.generateDailyForecast(forecastOptions);
    assert.equal(emptyForecast.dailyForecasts.length, 30, 'empty history also supports daily-only forecasts');
    assert.equal(emptyForecast.scenarios.p50, null);
    const service = createPlanningService({ database: adapter, now: () => clock, getForecast });
    const { createPlanningRouter } = require('../../routes/planning.js');
    const app = express();
    app.use(express.json());
    app.use('/api/planning', createPlanningRouter({ service }));
    let result = await request(app).get('/api/planning');
    assert.equal(result.status, 200);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.deepEqual(result.body.goals, []);
    assert.equal(result.body.settings.card_commitments_amount, null);
    assert.equal((await service.getProjection()).available_spend, null);

    const bankId = Number(db.prepare("INSERT INTO investment_accounts (account_name, account_type, account_number) VALUES ('Bank', 'bank_balance', '123')").run().lastInsertRowid);
    const bank2Id = Number(db.prepare("INSERT INTO investment_accounts (account_name, account_type, account_number) VALUES ('Second bank', 'bank_balance', '456')").run().lastInsertRowid);
    const savingId = Number(db.prepare("INSERT INTO investment_accounts (account_name, account_type, account_number) VALUES ('Deposit', 'savings', '123')").run().lastInsertRowid);
    db.prepare('INSERT INTO investment_holdings (account_id, current_value, as_of_date) VALUES (?, ?, ?)').run(bankId, 12000, today);
    db.prepare('INSERT INTO investment_holdings (account_id, current_value, as_of_date) VALUES (?, ?, ?)').run(bank2Id, 1000, today);
    db.prepare("INSERT INTO investment_holdings (account_id, current_value, as_of_date, holding_type) VALUES (?, ?, ?, 'pikadon')").run(savingId, 2000, today);
    db.prepare("INSERT INTO vendor_credentials (vendor) VALUES ('max')").run();
    db.prepare("INSERT INTO transactions (identifier, vendor, date, processed_date, name, price, type, status, charged_currency) VALUES ('card-bill', 'max', '2026-08-20', '2026-09-10', 'Purchase', -700, 'normal', 'completed', 'ILS')").run();
    const dailyOnlyForecast = await realForecast.generateDailyForecast(forecastOptions);
    assert.equal(dailyOnlyForecast.dailyForecasts.length, 30, 'the real model supports the planning card without simulations');
    assert.equal(dailyOnlyForecast.scenarios.p50, null);
    const automatic = await service.getProjection();
    assert.equal(automatic.status, 'ready', 'no settings or confirmation are required');
    assert.equal(automatic.next_income_date, '2026-09-10');
    assert.equal(automatic.next_income_source, 'detected');
    assert.equal(automatic.card_commitments, 700);
    assert.equal(automatic.card_commitments_source, 'imported');
    for (const label of ['₪', 'NIS', 'ש"ח', 'ש״ח']) {
      db.prepare("UPDATE transactions SET charged_currency = ? WHERE identifier = 'card-bill'").run(label);
      const importedCurrency = await service.getProjection();
      assert.equal(importedCurrency.status, 'ready', `the imported shekel label ${label} must not block the estimate`);
      assert.equal(importedCurrency.card_commitments, 700);
    }
    db.prepare("UPDATE transactions SET charged_currency = 'USD' WHERE identifier = 'card-bill'").run();
    const foreignCard = await service.getProjection();
    assert.equal(foreignCard.available_spend, null);
    assert.ok(foreignCard.reasons.some((reason) => reason.code === 'UNSUPPORTED_TRANSACTION_CURRENCY'));
    assert.ok(foreignCard.reasons.some((reason) => reason.code === 'UNSUPPORTED_CARD_CURRENCY'));
    assert.ok(!foreignCard.reasons.some((reason) => reason.code === 'CARD_DATA_MISSING' || reason.code === 'UNSUPPORTED_BANK_CURRENCY'));
    db.prepare("UPDATE transactions SET charged_currency = 'ILS' WHERE identifier = 'card-bill'").run();
    const fallbackService = createPlanningService({ database: adapter, now: () => clock,
      getForecast: () => { throw new Error('forecast unavailable'); } });
    const withoutSetup = await fallbackService.getProjection();
    assert.equal(withoutSetup.status, 'ready');
    assert.equal(withoutSetup.spending_source, 'recent_spending');
    assert.equal(withoutSetup.available_spend, 9600, 'imported cash minus cards and the next month of spending, with no manual settings');
    assert.equal(withoutSetup.forecast_expenses_until_income, 700);
    // Verify the fallback's real SQL selection, not just its arithmetic.
    db.exec('SAVEPOINT fallback_selection_review');
    const repaymentCategory = db.prepare("SELECT id FROM category_definitions WHERE name_en = 'Credit Card Repayment' LIMIT 1").get().id;
    const imported = db.prepare(`INSERT INTO transactions
      (identifier, vendor, date, name, price, type, status, category_type, category_definition_id)
      VALUES (?, 'bank-test', ?, 'Fallback review', ?, 'normal', ?, ?, ?)`);
    imported.run('refund-review', today + 'T23:50:00', 70, 'completed', 'expense', null);
    imported.run('repayment-review', today, -999, 'completed', 'expense', repaymentCategory);
    imported.run('investment-review', today, -999, 'completed', 'investment', null);
    imported.run('pending-review', today, -999, 'pending', 'expense', null);
    imported.run('future-review', math.shiftDays(today, 1), -999, 'completed', 'expense', null);
    imported.run('duplicate-review', today, -999, 'completed', 'expense', null);
    const pairingId = db.prepare("INSERT INTO account_pairings (credit_card_vendor, bank_vendor, is_active) VALUES ('max', 'bank-test', 0)").run().lastInsertRowid;
    db.prepare("INSERT INTO transaction_pairing_exclusions (transaction_identifier, transaction_vendor, pairing_id) VALUES ('duplicate-review', 'bank-test', ?)").run(pairingId);
    const { recentSpendingEstimate } = require('../planning-history.js');
    const reviewed = await recentSpendingEstimate(adapter, today, 30);
    assert.equal(reviewed.days.reduce((sum, day) => sum + Math.round(day.expectedOperatingExpenses * 100), 0), 63000);
    db.exec('ROLLBACK TO fallback_selection_review; RELEASE fallback_selection_review');
    await service.updateSettings({ cash_buffer: 500 });
    let projection = await service.getProjection();
    assert.equal(projection.cash_balance, 11000, 'exclude bank/deposit overlap');
    assert.equal(projection.available_spend, 9600);
    assert.equal(projection.card_confirmation_required, false);
    assert.equal(projection.card_commitments, 700);
    await service.updateSettings({ card_commitments_amount: 700 });
    projection = await service.getProjection();
    assert.equal(projection.status, 'ready');
    assert.equal(projection.available_spend, 9600);
    assert.equal(projection.card_commitments, 700);

    result = await request(app).post('/api/planning/goals').send({ name: 'Holiday', target_amount: 10000, saved_amount: 2000, monthly_contribution: 300, target_date: '2027-06-01', reserve_location: 'included_cash' });
    assert.equal(result.status, 201);
    const goal = result.body;
    assert.equal(goal.required_monthly_contribution, 888.89);
    projection = await service.getProjection();
    assert.equal(projection.available_spend, 7600);
    assert.equal(projection.planned_contributions, 0);
    assert.ok(projection.total_planned_contributions > 0);
    result = await request(app).put(`/api/planning/goals/${goal.id}`).send({ ...goal, reserve_location: 'external' });
    assert.equal(result.status, 200);
    assert.equal((await service.getProjection()).available_spend, 9600);
    assert.equal((await request(app).put('/api/planning/goals/99999').send(goal)).status, 404);
    assert.equal((await request(app).post('/api/planning/goals').send({ ...goal, target_amount: -1 })).status, 400);

    const scenario = { name: 'Buy a car', changes: [{ id: 'car', label: 'Deposit', date: '2026-09-10', amount: -1000, frequency: 'one_time' }] };
    result = await request(app).post('/api/planning/scenarios').send(scenario);
    assert.equal(result.status, 201);
    const scenarioId = result.body.id;
    const callsBeforePreview = forecastCalls;
    result = await request(app).post('/api/planning/scenarios/preview').send({ ...scenario, horizon_days: 180 });
    assert.equal(result.status, 200);
    assert.equal(forecastCalls - callsBeforePreview, 1, 'comparison uses one shared baseline');
    assert.equal(result.body.comparison.available_spend_delta, -1000);
    assert.equal(result.body.comparison.end_balance_delta, -1000);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM cash_scenarios').get().count, 1, 'preview does not persist');
    assert.equal((await request(app).put(`/api/planning/scenarios/${scenarioId}`).send({ ...scenario, name: 'New car' })).status, 200);
    assert.equal((await request(app).post('/api/planning/scenarios/preview').send({ ...scenario, horizon_days: 999 })).status, 400);
    assert.equal((await request(app).post('/api/planning/scenarios').send({ ...scenario, changes: [{ ...scenario.changes[0], date: today }] })).status, 400);
    assert.equal((await request(app).post('/api/planning/scenarios').send({ ...scenario, changes: [{ ...scenario.changes[0], date: '2026-08-31', end_date: '2026-09-10', frequency: 'monthly' }] })).status, 400);

    // Re-open persistence through another service instance.
    const reloaded = createPlanningService({ database: adapter, now: () => clock, getForecast });
    assert.equal((await reloaded.getPlanningData()).scenarios[0].name, 'New car');
    assert.equal((await reloaded.getPlanningData()).goals[0].reserve_location, 'external');
    assert.equal((await reloaded.getProjection()).status, 'ready');
    // Updating either snapshot discards the manual override and recalculates from imports.
    db.prepare('UPDATE investment_holdings SET current_value = 900 WHERE account_id = ?').run(bank2Id);
    projection = await service.getProjection();
    assert.equal(projection.card_confirmation_required, false);
    assert.equal(projection.card_commitments_source, 'imported');
    assert.equal(projection.available_spend, 9500);
    await service.updateSettings({ cash_buffer: 600 });
    assert.equal((await service.getProjection()).card_commitments_source, 'imported', 'buffer edits preserve automatic calculation');
    await service.updateSettings({ card_commitments_amount: 0 });
    assert.equal((await service.getProjection()).status, 'ready', 'explicit zero commitment is valid');
    db.prepare("INSERT INTO transactions (identifier, vendor, date, name, price, type, status, charged_currency) VALUES ('new-card', 'max', ?, 'Purchase', -50, 'normal', 'completed', 'ILS')").run(today);
    projection = await service.getProjection();
    assert.equal(projection.card_confirmation_required, false);
    assert.equal(projection.card_commitments, 750, 'new imports automatically replace a stale override');
    assert.equal(projection.card_commitments_source, 'estimated');
    await service.updateSettings({ card_commitments_amount: 50 });
    db.prepare('UPDATE investment_holdings SET as_of_date = ? WHERE account_id = ?').run('2026-08-31', bank2Id);
    projection = await service.getProjection();
    assert.equal(projection.cash_balance, null);
    assert.ok(projection.reasons.some((reason) => reason.code === 'STALE_BANK_BALANCE'));
    await assert.rejects(service.updateSettings({ card_commitments_amount: 0 }), /Update all bank balances/);
    db.prepare('UPDATE investment_holdings SET as_of_date = ? WHERE account_id = ?').run(today, bank2Id);
    db.prepare("UPDATE investment_accounts SET currency = 'USD' WHERE id = ?").run(bank2Id);
    assert.ok((await service.getProjection()).reasons.some((reason) => reason.code === 'UNSUPPORTED_BANK_CURRENCY'));
    db.prepare("UPDATE investment_accounts SET currency = 'ILS' WHERE id = ?").run(bank2Id);
    await service.updateSettings({ card_commitments_amount: 0 });
    for (const mode of ['gap', 'null', 'empty', 'short', 'noEvidence', 'old', 'error']) {
      forecastMode = mode;
      projection = await service.getProjection();
      assert.equal(projection.status, 'ready', `imported spending provides a fallback for ${mode}`);
      assert.equal(projection.spending_source, 'recent_spending');
      assert.equal(projection.spending_history_days, 20);
      assert.ok(Number.isFinite(projection.available_spend));
      assert.ok(Number.isFinite(projection.ending_balance));
      assert.ok(projection.forecast_expenses_until_income > 0);
      assert.deepEqual(projection.reasons, []);
      if (mode === 'error') {
        assert.equal(projection.forecast_expenses_until_income, 750);
        assert.equal(projection.available_spend, 9250, 'the fallback also reserves the upcoming goal contribution');
      }
    }
    forecastMode = 'resolved';
    assert.equal((await service.getProjection()).status, 'ready', 'shared recurring evidence remains usable when residual history is empty');
    forecastMode = 'complete';
    await service.updateSettings({ next_income_date: null, card_commitments_amount: null });
    assert.equal((await service.getProjection()).next_income_source, 'detected');
    forecastMode = 'irregular';
    projection = await service.getProjection();
    assert.equal(projection.status, 'ready');
    assert.equal(projection.next_income_date, null);
    assert.equal(projection.spending_period_end, '2026-10-08');
    assert.equal(projection.forecast_expenses_until_income, 3000);
    forecastMode = 'complete';
    await service.updateSettings({ next_income_date: '2026-09-10' });
    clock = new Date(2026, 8, 11, 12);
    projection = await service.getProjection();
    assert.equal(projection.status, 'ready');
    assert.equal(projection.next_income_date, '2026-09-13', 'expired override resumes automatic detection');
    assert.equal(projection.next_income_source, 'detected');
    db.prepare('UPDATE investment_holdings SET as_of_date = ? WHERE account_id IN (?, ?)').run('2026-09-11', bankId, bank2Id);
    assert.equal((await service.getProjection()).card_commitments, 50, 'settled billing cycle is no longer reserved after a balance sync');
    clock = new Date(2026, 8, 8, 12);
    db.prepare('UPDATE investment_holdings SET as_of_date = ? WHERE account_id IN (?, ?)').run(today, bankId, bank2Id);
    await service.updateSettings({ next_income_date: '2027-01-01' });
    assert.ok((await service.getProjection({ horizon_days: 7 })).reasons.some((reason) => reason.code === 'NEXT_INCOME_OUTSIDE_HORIZON'));
    assert.equal((await request(app).delete(`/api/planning/goals/${goal.id}`)).status, 200);
    assert.equal((await request(app).delete(`/api/planning/scenarios/${scenarioId}`)).status, 200);
    assert.equal((await request(app).delete(`/api/planning/scenarios/${scenarioId}`)).status, 404);
    assert.equal((await request(app).delete('/api/planning/goals/1%20OR%201=1')).status, 400);
    console.log('planning:integration:ok');
  } finally {
    if (globalDatabase) await globalDatabase.close();
    if (db) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
