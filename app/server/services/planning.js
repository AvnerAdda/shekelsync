const { createHash } = require('crypto');
const math = require('./planning-math.js');
const { detectNextIncome, detectCardCommitments } = require('./planning-automation.js');
const { recentSpendingEstimate } = require('./planning-history.js');
const { normalizePlanningCurrency } = require('./planning-currency.js');

const DEFAULT_SETTINGS = {
  cash_buffer: 0,
  next_income_date: null,
  card_commitments_amount: null,
  card_commitments_confirmed_at: null,
};
const REASONS = {
  NO_BANK_BALANCE: 'Add a current bank balance to estimate available money.',
  MISSING_BANK_BALANCE: 'Every active bank account needs an explicit balance and date.',
  STALE_BANK_BALANCE: 'Update bank balances that are more than seven days old.',
  UNSUPPORTED_CURRENCY: 'This estimate requires all bank balances and recent spending to be in ILS.',
  UNSUPPORTED_BANK_CURRENCY: 'A bank balance is denominated in a currency this estimate cannot yet combine with shekels.',
  UNSUPPORTED_TRANSACTION_CURRENCY: 'Recent transactions contain amounts charged in a foreign currency that this estimate cannot yet convert.',
  UNSUPPORTED_CARD_CURRENCY: 'An outstanding card amount is charged in a foreign currency that this estimate cannot yet convert.',
  STALE_CARD_DATA: 'A card account has not synced successfully in more than seven days.',
  INVALID_CARD_AMOUNT: 'An imported card transaction is missing a usable amount.',
  NEXT_INCOME_OUTSIDE_HORIZON: 'Your next income date must fall within the projection period.',
  CARD_DATA_MISSING: 'Sync your card accounts to include their outstanding payments.',
  FORECAST_UNAVAILABLE: 'The spending forecast is temporarily unavailable.',
  INSUFFICIENT_HISTORY: 'Add recent completed transactions before estimating future spending.',
  INCOMPLETE_FORECAST: 'A complete daily spending forecast is needed for this period.',
};

function recordId(value) {
  const string = String(value);
  if (!/^[1-9]\d*$/.test(string) || !Number.isSafeInteger(Number(string))) throw math.invalid('Invalid planning record ID');
  return Number(string);
}

function publicSettings(row = DEFAULT_SETTINGS) {
  return {
    cash_buffer: Number(row.cash_buffer),
    next_income_date: row.next_income_date || null,
    card_commitments_amount: row.card_commitments_amount == null ? null : Number(row.card_commitments_amount),
    card_commitments_confirmed_at: row.card_commitments_confirmed_at || null,
  };
}

function scenarioRecord(row) {
  const { changes_json: changesJson, ...rest } = row;
  return { ...rest, id: Number(row.id), changes: JSON.parse(changesJson) };
}

function validateScenario(payload = {}, today) {
  const changes = math.validateChanges(payload.changes);
  changes.forEach((change) => {
    if (change.frequency === 'one_time' && change.date <= today) throw math.invalid('One-time changes must be dated tomorrow or later');
    if (change.frequency === 'monthly' && change.end_date) {
      const [year, month] = today.split('-').map(Number);
      const [startYear, startMonth] = change.date.split('-').map(Number);
      let offset = Math.max(0, (year - startYear) * 12 + month - startMonth);
      if (math.monthlyOccurrence(change.date, offset) <= today) offset += 1;
      if (math.monthlyOccurrence(change.date, offset) > change.end_date) throw math.invalid('Monthly changes need a future occurrence before their end date');
    }
  });
  return { name: math.title(payload.name), changes };
}

/** Dependencies are injected for tests; creating the service never opens a database. */
function createPlanningService(dependencies = {}) {
  const database = dependencies.database || require('./database.js');
  const now = dependencies.now || (() => new Date());
  const getAccounts = dependencies.getAccounts || (() => require('./investments/accounts.js').listAccounts());
  const getForecast = dependencies.getForecast || ((options) => require('./forecast.js').generateDailyForecast(options));

  async function storedSettings() {
    const result = await database.query('SELECT * FROM planning_settings WHERE id = 1');
    return result.rows[0] || { ...DEFAULT_SETTINGS, card_balance_signature: null };
  }

  async function getPlanningData() {
    const [goals, scenarios, settings] = await Promise.all([
      database.query('SELECT * FROM savings_goals ORDER BY created_at, id'),
      database.query('SELECT * FROM cash_scenarios ORDER BY created_at, id'),
      storedSettings(),
    ]);
    return { goals: goals.rows.map((goal) => math.describeGoal(goal, math.dateKey(now()))), scenarios: scenarios.rows.map(scenarioRecord), settings: publicSettings(settings) };
  }

  async function saveGoal(payload, id) {
    const goal = math.validateGoal(payload);
    const values = [goal.name, goal.target_amount, goal.saved_amount, goal.monthly_contribution, goal.target_date, goal.reserve_location];
    const result = id == null
      ? await database.query(`INSERT INTO savings_goals (name, target_amount, saved_amount, monthly_contribution, target_date, reserve_location)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, values)
      : await database.query(`UPDATE savings_goals SET name = $1, target_amount = $2, saved_amount = $3,
          monthly_contribution = $4, target_date = $5, reserve_location = $6, updated_at = $7 WHERE id = $8 RETURNING *`, [...values, now().toISOString(), recordId(id)]);
    if (!result.rows[0]) throw Object.assign(new Error('Savings goal not found'), { status: 404 });
    return math.describeGoal(result.rows[0], math.dateKey(now()));
  }

  async function saveScenario(payload, id) {
    const scenario = validateScenario(payload, math.dateKey(now()));
    const values = [scenario.name, JSON.stringify(scenario.changes)];
    const result = id == null
      ? await database.query('INSERT INTO cash_scenarios (name, changes_json) VALUES ($1, $2) RETURNING *', values)
      : await database.query('UPDATE cash_scenarios SET name = $1, changes_json = $2, updated_at = $3 WHERE id = $4 RETURNING *', [...values, now().toISOString(), recordId(id)]);
    if (!result.rows[0]) throw Object.assign(new Error('Cash scenario not found'), { status: 404 });
    return scenarioRecord(result.rows[0]);
  }

  async function deleteRecord(table, id) {
    // Table identifiers come only from the fixed wrappers below.
    const result = await database.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [recordId(id)]);
    if (!result.rows[0]) throw Object.assign(new Error('Planning record not found'), { status: 404 });
    return { success: true };
  }

  async function cashContext(today) {
    const [accountResult, snapshots, cards, currencies, cardActivity, pairings] = await Promise.all([
      getAccounts(),
      database.query(`SELECT ia.id AS account_id, ia.updated_at AS account_updated_at,
          ih.id AS snapshot_id, ih.current_value, ih.as_of_date, ih.updated_at AS snapshot_updated_at
        FROM investment_accounts ia
        LEFT JOIN investment_holdings ih ON ih.id = (
          SELECT h.id FROM investment_holdings h WHERE h.account_id = ia.id
            AND COALESCE(h.holding_type, 'standard') <> 'pikadon'
          ORDER BY h.as_of_date DESC, h.id DESC LIMIT 1)
        WHERE ia.is_active = 1 AND ia.account_type = 'bank_balance' ORDER BY ia.id`),
      database.query(`SELECT vendors.vendor, (SELECT MAX(vc.last_scrape_success) FROM vendor_credentials vc
          WHERE vc.vendor = vendors.vendor) AS last_scrape_success FROM (
          SELECT vc.vendor FROM vendor_credentials vc
          LEFT JOIN institution_nodes fi ON fi.id = vc.institution_id OR (fi.vendor_code = vc.vendor AND fi.node_type = 'institution')
          WHERE fi.institution_type = 'credit_card' OR vc.vendor IN ('max', 'visaCal', 'isracard', 'amex')
          UNION SELECT t.vendor FROM transactions t
          LEFT JOIN institution_nodes fi ON fi.vendor_code = t.vendor AND fi.node_type = 'institution'
          WHERE fi.institution_type = 'credit_card' OR t.vendor IN ('max', 'visaCal', 'isracard', 'amex')
          UNION SELECT credit_card_vendor AS vendor FROM account_pairings WHERE is_active = 1
        ) vendors ORDER BY vendor`),
      database.query(`SELECT DISTINCT UPPER(TRIM(charged_currency)) AS currency FROM transactions
        WHERE date >= $1 AND status = 'completed' AND charged_currency IS NOT NULL
          AND TRIM(charged_currency) <> '' AND UPPER(TRIM(charged_currency)) <> 'ILS'`, [math.shiftDays(today, -180)]),
      database.query(`SELECT t.vendor, t.identifier, t.account_number, t.date, t.price, t.status, t.processed_date, t.charged_currency
        FROM transactions t
        WHERE t.vendor IN ('max', 'visaCal', 'isracard', 'amex')
          OR EXISTS (SELECT 1 FROM institution_nodes fi WHERE fi.vendor_code = t.vendor
            AND fi.node_type = 'institution' AND fi.institution_type = 'credit_card')
          OR EXISTS (SELECT 1 FROM account_pairings ap WHERE ap.credit_card_vendor = t.vendor AND ap.is_active = 1)
        ORDER BY t.vendor, t.identifier`),
      database.query('SELECT * FROM account_pairings WHERE is_active = 1 ORDER BY id'),
    ]);
    const banks = accountResult.accounts.filter((account) => account.account_type === 'bank_balance' && account.is_active !== false && account.is_active !== 0)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const codes = [];
    if (!banks.length) codes.push('NO_BANK_BALANCE');
    const finiteBalance = (account) => account.current_value_explicit != null && Number.isFinite(Number(account.current_value_explicit));
    const snapshotDate = (account) => String(account.last_update_date || '').slice(0, 10);
    if (banks.some((account) => !finiteBalance(account) || !math.validDate(snapshotDate(account)) || snapshotDate(account) > today)) codes.push('MISSING_BANK_BALANCE');
    if (banks.some((account) => math.validDate(snapshotDate(account)) && snapshotDate(account) < math.shiftDays(today, -7))) codes.push('STALE_BANK_BALANCE');
    if (banks.some((account) => normalizePlanningCurrency(account.currency, '') !== 'ILS')) codes.push('UNSUPPORTED_BANK_CURRENCY');
    if (currencies.rows.some((row) => normalizePlanningCurrency(row.currency) !== 'ILS')) codes.push('UNSUPPORTED_TRANSACTION_CURRENCY');
    const dates = banks.map(snapshotDate).filter(math.validDate).sort();
    // Include every snapshot, including same-day replacements and reconciled deposit overlap.
    const signature = createHash('sha256').update(JSON.stringify({ snapshots: snapshots.rows, banks: banks.map((account) => [account.id, account.current_value_explicit, account.currency]), cards: cards.rows, cardActivity: cardActivity.rows, pairings: pairings.rows })).digest('hex');
    return {
      codes,
      balance: codes.length ? null : banks.reduce((total, account) => total + Math.round(Number(account.current_value_explicit) * 100), 0) / 100,
      latestBalanceDate: dates[0] || null, // Oldest included snapshot describes the aggregate's freshness.
      hasCards: cards.rows.length > 0,
      automaticCards: detectCardCommitments({ today, banks, cards: cards.rows, transactions: cardActivity.rows, pairings: pairings.rows }),
      signature,
    };
  }

  async function updateSettings(payload = {}) {
    const current = await storedSettings();
    const today = math.dateKey(now());
    const next = { ...current };
    if (Object.hasOwn(payload, 'cash_buffer')) next.cash_buffer = math.money(payload.cash_buffer, 'Cash buffer');
    if (Object.hasOwn(payload, 'next_income_date')) {
      next.next_income_date = payload.next_income_date || null;
      if (next.next_income_date !== null && (!math.validDate(next.next_income_date) || next.next_income_date <= today || next.next_income_date > math.shiftDays(today, 365))) {
        throw math.invalid('Next income date must be within the next 365 days');
      }
    }
    if (Object.hasOwn(payload, 'card_commitments_amount')) {
      next.card_commitments_amount = payload.card_commitments_amount === null ? null : math.money(payload.card_commitments_amount, 'Outstanding card payments');
      if (next.card_commitments_amount === null) {
        next.card_commitments_confirmed_at = null;
        next.card_balance_signature = null;
      } else {
        const context = await cashContext(today);
        if (context.codes.length) throw math.invalid('Update all bank balances before confirming outstanding card payments');
        next.card_commitments_confirmed_at = now().toISOString();
        next.card_balance_signature = context.signature;
      }
    }
    await database.query(`INSERT INTO planning_settings (id, cash_buffer, next_income_date, card_commitments_amount, card_commitments_confirmed_at, card_balance_signature, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $6)
      ON CONFLICT(id) DO UPDATE SET cash_buffer = excluded.cash_buffer, next_income_date = excluded.next_income_date,
        card_commitments_amount = excluded.card_commitments_amount, card_commitments_confirmed_at = excluded.card_commitments_confirmed_at,
        card_balance_signature = excluded.card_balance_signature, updated_at = excluded.updated_at`,
    [next.cash_buffer, next.next_income_date, next.card_commitments_amount, next.card_commitments_confirmed_at, next.card_balance_signature || null, now().toISOString()]);
    return publicSettings(next);
  }

  async function projectionInputs(options = {}) {
    const horizon = math.validateHorizon(options.horizon_days);
    const today = math.dateKey(now());
    const [data, settings, forecastResult] = await Promise.all([
      getPlanningData(), storedSettings(),
      Promise.resolve().then(() => getForecast({ includeToday: false, forecastDays: horizon, monteCarloRuns: 0, recordSnapshot: false }))
        .then((value) => ({ value }), () => ({ error: true })),
    ]);
    const cash = await cashContext(today);
    const codes = [...cash.codes];
    const forecast = forecastResult.value;
    if (forecastResult.error) codes.push('FORECAST_UNAVAILABLE');
    else {
      const history = forecast?.analysisInfo;
      const first = String(history?.firstTransaction || '').slice(0, 10);
      const last = String(history?.lastTransaction || '').slice(0, 10);
      // Resolved recurring transactions leave the residual forecast dataset, but
      // their shared predictions still provide valid spending evidence.
      const resolvedSpending = forecast?.dailyForecasts?.some((day) => day.predictions?.some((prediction) =>
        prediction.isUserResolvedPattern && prediction.categoryType === 'expense' && prediction.probabilityWeightedAmount > 0));
      if (!history || !(Number(history.totalTransactions) > 0) || (!(Number(history.projectedEvidenceTransactions) > 0) && !resolvedSpending)
        || history.insufficientHistory || !math.validDate(first) || first > math.shiftDays(today, -30)
        || !math.validDate(last) || last < math.shiftDays(today, -60) || last > today) codes.push('INSUFFICIENT_HISTORY');
    }
    let days = (forecast?.dailyForecasts || []).filter((day) => day.date > today && day.date <= math.shiftDays(today, horizon));
    const dayMap = new Map(days.map((day) => [day.date, day]));
    let completeForecast = days.length === horizon && dayMap.size === horizon;
    for (let i = 1; i <= horizon && completeForecast; i += 1) {
      const day = dayMap.get(math.shiftDays(today, i));
      completeForecast = !!day && ['expectedOperatingIncome', 'expectedOperatingExpenses'].every((key) => typeof day[key] === 'number' && Number.isFinite(day[key]) && day[key] >= 0);
    }
    if (!forecastResult.error && !completeForecast) codes.push('INCOMPLETE_FORECAST');
    let spendingSource = 'forecast';
    let historyDays = null;
    if (codes.some((code) => ['FORECAST_UNAVAILABLE', 'INCOMPLETE_FORECAST', 'INSUFFICIENT_HISTORY'].includes(code))) {
      const fallback = await recentSpendingEstimate(database, today, horizon, days);
      if (fallback) {
        days = fallback.days;
        completeForecast = true;
        spendingSource = 'recent_spending';
        historyDays = fallback.historyDays;
        for (let i = codes.length - 1; i >= 0; i--) {
          if (['FORECAST_UNAVAILABLE', 'INCOMPLETE_FORECAST', 'INSUFFICIENT_HISTORY'].includes(codes[i])) codes.splice(i, 1);
        }
      }
    }
    const manualIncomeDate = math.validDate(settings.next_income_date) && settings.next_income_date > today ? settings.next_income_date : null;
    const incomeDate = manualIncomeDate || detectNextIncome(forecast, today, math.shiftDays(today, horizon));
    const incomeSource = manualIncomeDate ? 'manual' : incomeDate ? 'detected' : null;
    if (incomeDate > math.shiftDays(today, horizon)) codes.push('NEXT_INCOME_OUTSIDE_HORIZON');
    const spendingUntil = incomeDate || math.shiftDays(today, Math.min(30, horizon));
    const cardConfirmed = settings.card_commitments_amount != null && settings.card_commitments_confirmed_at && settings.card_balance_signature === cash.signature;
    const cardCommitments = cash.hasCards && cardConfirmed ? Number(settings.card_commitments_amount) : cash.automaticCards.amount;
    const cardSource = cash.hasCards && cardConfirmed ? 'manual' : cash.automaticCards.source;
    if (cardCommitments === null) codes.push(cash.automaticCards.reason || 'CARD_DATA_MISSING');
    return { today, horizon, goals: data.goals, settings: { ...publicSettings(settings), next_income_date: incomeDate }, cash, days,
      codes: [...new Set(codes)], completeForecast, cardCommitments, cardSource, incomeSource, spendingUntil, spendingSource, historyDays };
  }

  function project(input, changes = []) {
    const { today, horizon, settings, cash, goals, days, codes, completeForecast, cardCommitments, cardSource, incomeSource, spendingUntil } = input;
    const forecastReady = completeForecast && !codes.includes('INSUFFICIENT_HISTORY') && !codes.includes('FORECAST_UNAVAILABLE');
    const ledgerReady = cash.balance !== null && forecastReady && cardCommitments !== null;
    const calculated = math.calculateProjection({ today, horizon, cashBalance: cash.balance || 0, settings, spendingUntil, goals, cardCommitments: cardCommitments || 0, changes,
      forecastDays: completeForecast ? days : Array.from({ length: horizon }, (_, i) => ({ date: math.shiftDays(today, i + 1), expectedOperatingIncome: 0, expectedOperatingExpenses: 0 })) });
    return {
      status: codes.length ? 'incomplete' : 'ready', currency: 'ILS', generated_at: now().toISOString(), as_of_date: today, horizon_days: horizon,
      next_income_date: settings.next_income_date, cash_balance: cash.balance, cash_buffer: settings.cash_buffer,
      next_income_source: incomeSource, spending_period_end: spendingUntil,
      spending_source: input.spendingSource, spending_history_days: input.historyDays,
      card_commitments: cardCommitments, card_commitments_source: cardSource, card_confirmation_required: false, latest_balance_date: cash.latestBalanceDate,
      ...calculated,
      available_spend: codes.length ? null : calculated.available_spend,
      shortfall: codes.length ? null : calculated.shortfall,
      forecast_expenses_until_income: forecastReady && !codes.includes('NEXT_INCOME_OUTSIDE_HORIZON') ? calculated.forecast_expenses_until_income : null,
      lowest_balance: ledgerReady ? calculated.lowest_balance : null,
      ending_balance: ledgerReady ? calculated.ending_balance : null,
      daily: forecastReady ? calculated.daily.map((day) => ({ ...day, balance: ledgerReady ? day.balance : null })) : [],
      monthly: forecastReady ? calculated.monthly.map((month) => ({ ...month, ending_balance: ledgerReady ? month.ending_balance : null })) : [],
      reasons: codes.map((code) => ({ code, message: REASONS[code] })),
      assumptions: [
        ...(input.spendingSource === 'recent_spending' ? ['Upcoming spending uses recent completed transactions, with refunds netted within each category and duplicate card repayments excluded. Short histories use a minimum 30-day averaging period. Available forecast amounts are retained when higher.'] : []),
        'Only explicit, reconciled ILS bank balances updated within seven days are included; investment and deposit accounts are excluded.',
        'Future operating spending is reserved on its predicted purchase date, starting tomorrow. Future income does not increase available spending.',
        'Outstanding card payments are derived from imported billing dates and deducted once at the start. Undated recent purchases are reserved conservatively for 45 days. Manual card overrides expire when the source data changes.',
        'The next recurring operating income is detected from the shared forecast. Without a reliable date, spending is reserved for the next 30 days (or the shorter projection period).',
        'Included-cash savings are reserved now. Planned contributions are reserved on the first of each upcoming month, up to each goal target and deadline.',
        'The next income date includes that day’s spending because bills may debit before salary arrives. Forecasts are estimates and scenario changes are incremental.',
      ],
    };
  }

  async function getProjection(options = {}) { return project(await projectionInputs(options)); }
  async function previewScenario(payload = {}) {
    const scenario = validateScenario(payload, math.dateKey(now()));
    const input = await projectionInputs(payload);
    const baseline = project(input);
    const projected = project(input, scenario.changes);
    const delta = (key) => baseline[key] == null || projected[key] == null ? null : Math.round((projected[key] - baseline[key]) * 100) / 100;
    return { baseline, scenario: projected, comparison: { end_balance_delta: delta('ending_balance'), lowest_balance_delta: delta('lowest_balance'), available_spend_delta: delta('available_spend') } };
  }

  return { getPlanningData, saveGoal, saveScenario, updateSettings, getProjection, previewScenario,
    deleteGoal: (id) => deleteRecord('savings_goals', id), deleteScenario: (id) => deleteRecord('cash_scenarios', id) };
}

module.exports = { ...createPlanningService(), createPlanningService, _internal: { validateScenario, recordId, REASONS } };
