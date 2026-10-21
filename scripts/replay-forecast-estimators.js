#!/usr/bin/env node
/** Read-only retrospective comparison of adaptive selection and its incumbent. */
const path = require('path');
const root = path.resolve(__dirname, '..');
const Database = require(path.join(root, 'app/node_modules/better-sqlite3'));
const forecast = require('../app/server/services/forecast.js');
const model = require('../app/server/services/forecast-models/pattern.js');
const truthService = require('../app/server/services/financial-truth.js');
const OriginalDate = Date;

function parseOptions(argv) {
  const options = {};
  const allowed = ['db', 'from', 'through', 'actual-through', 'split', 'category-limit', 'compare'];
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index].replace(/^--/, '');
    if (!argv[index].startsWith('--') || !allowed.includes(name) || !argv[index + 1]) {
      throw new Error(`Invalid option: ${argv[index]}`);
    }
    options[name] = argv[index + 1];
  }
  for (const name of ['from', 'through', 'actual-through', ...(options.split ? ['split'] : [])]) {
    const value = options[name];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')
      || new OriginalDate(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) {
      throw new Error(`--${name} must be a valid YYYY-MM-DD date`);
    }
  }
  if (options.from > options.through || options.through > options['actual-through']) {
    throw new Error('Dates must satisfy from <= through <= actual-through');
  }
  if (options['category-limit'] != null) {
    const limit = Number(options['category-limit']);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('--category-limit must be an integer between 1 and 100');
    }
    options['category-limit'] = limit;
  }
  if (options.compare && !['adaptive', 'infrequent'].includes(options.compare)) {
    throw new Error('--compare must be adaptive or infrequent');
  }
  options.db = path.resolve(options.db || process.env.SQLITE_DB_PATH || path.join(root, 'dist/shekelsync.sqlite'));
  return options;
}

function summarize(rows) {
  if (!rows.length) return { windows: 0 };
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    windows: rows.length,
    incumbentMae: average(rows.map(row => Math.abs(row.incumbent - row.actual))),
    selectedMae: average(rows.map(row => Math.abs(row.selected - row.actual))),
    calendarAverageMae: average(rows.map(row => Math.abs(row.calendarAverage - row.actual))),
    incumbentDailyMae: average(rows.map(row => row.incumbentDailyMae)),
    selectedDailyMae: average(rows.map(row => row.selectedDailyMae)),
  };
}

function summarizeCategories(observations, windows, limit) {
  if (!windows) return [];
  const groups = new Map();
  for (const row of observations) {
    const key = row.categoryDefinitionId == null ? 'uncategorized' : String(row.categoryDefinitionId);
    if (!groups.has(key)) groups.set(key, { categoryDefinitionId: row.categoryDefinitionId,
      category: row.category, affectedWindows: 0, absoluteError: 0, signedError: 0, predictionKinds: {} });
    const group = groups.get(key);
    group.affectedWindows++;
    group.absoluteError += Math.abs(row.predicted - row.actual);
    group.signedError += row.predicted - row.actual;
    for (const [kind, amount] of Object.entries(row.predictionKinds)) {
      group.predictionKinds[kind] = (group.predictionKinds[kind] || 0) + amount;
    }
  }
  return [...groups.values()].map(group => ({
    categoryDefinitionId: group.categoryDefinitionId, category: group.category,
    windows, affectedWindows: group.affectedWindows,
    mae: group.absoluteError / windows, bias: group.signedError / windows,
    predictionKinds: group.predictionKinds,
  })).sort((left, right) => right.mae - left.mae).slice(0, limit);
}

function categoryErrors(transactions, days, cutoff, horizon) {
  const dates = new Set(days.map(day => day.date));
  const categories = new Map();
  const get = (id, category) => {
    const key = id == null ? 'uncategorized' : String(id);
    if (!categories.has(key)) categories.set(key, {
      cutoff, horizon, categoryDefinitionId: id ?? null, category,
      actual: 0, predicted: 0, predictionKinds: {},
    });
    return categories.get(key);
  };
  for (const transaction of transactions) {
    if (transaction.category_type !== 'expense' || transaction.price >= 0
      || !dates.has(transaction.date.slice(0, 10))) continue;
    get(transaction.category_definition_id, transaction.category_name_en || transaction.category_name || 'Uncategorized')
      .actual -= transaction.price;
  }
  for (const day of days) for (const prediction of day.predictions || []) {
    const amount = Number(prediction.probabilityWeightedAmount) || 0;
    if (prediction.categoryType !== 'expense' || amount <= 0) continue;
    const category = get(prediction.categoryDefinitionId, prediction.category || 'Uncategorized');
    category.predicted += amount;
    const kind = prediction.isBaselineForecast ? 'daily_average' : prediction.predictionKind || 'category_pattern';
    category.predictionKinds[kind] = (category.predictionKinds[kind] || 0) + amount;
  }
  return [...categories.values()];
}

function replay(options) {
  const engine = { ...forecast._internal, log: () => {} };
  const incumbentEngine = options.compare === 'infrequent' ? {
    ...engine, buildInfrequentExpenseEstimates: () => new Map(),
  } : {
    ...engine,
    buildVariableExpenseMonthlyBaselines: (...args) => Object.fromEntries(
      Object.entries(engine.buildVariableExpenseMonthlyBaselines(...args)).map(([key, baseline]) => [key, {
        ...baseline, estimator: 'robust_monthly', dailyRate: null, validation: null,
      }]),
    ),
  };
  const source = new Database(options.db, { readonly: true, fileMustExist: true });
  let image;
  let transactions;
  try {
    image = source.serialize();
    transactions = engine.getAllTransactions(source);
  } finally {
    source.close();
  }
  // Deserialized in-memory databases cannot open a WAL sidecar.
  image[18] = 1;
  image[19] = 1;
  const actuals = new Map();
  for (const transaction of transactions) {
    if (transaction.category_type !== 'expense' || transaction.price >= 0) continue;
    const date = transaction.date.slice(0, 10);
    actuals.set(date, (actuals.get(date) || 0) - transaction.price);
  }
  const offset = (date, days) => {
    const value = new OriginalDate(date + 'T12:00:00');
    value.setDate(value.getDate() + days);
    return engine.formatDate(value);
  };
  const rows = [];
  const categories = [];
  const cutoffs = [];
  for (let cutoff = options.from; cutoff <= options.through; cutoff = offset(cutoff, 1)) {
    if (![1, 8, 15, 22].includes(Number(cutoff.slice(-2)))) continue;
    cutoffs.push(cutoff);
    const db = new Database(image);
    // Older schedule code consults the wall clock; freeze it as well as passing now.
    global.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [cutoff + 'T12:00:00'])); }
      static now() { return new OriginalDate(cutoff + 'T12:00:00').getTime(); }
    };
    try {
      db.exec('DELETE FROM financial_corrections; DELETE FROM financial_pattern_transactions; DELETE FROM subscriptions; DELETE FROM financial_patterns;');
      db.prepare('DELETE FROM transactions WHERE substr(date,1,10) > ?').run(cutoff);
      const truthSnapshot = truthService.getProjectionSnapshotFromDb(db, { materialize: true });
      const past = engine.getAllTransactions(db);
      const generate = forecastEngine => model.generateForecast({
        engine: forecastEngine, db, now: new Date(), currentMonth: cutoff.slice(0, 7),
        currentDay: Number(cutoff.slice(-2)), allTransactions: past, historicalTransactions: past,
        truthSnapshot, historicalTransactionSummary: { count: past.length },
        config: { includeToday: false, forecastDays: 30, forecastMonths: 1, monteCarloRuns: 0 },
      });
      const incumbent = generate(incumbentEngine);
      const selected = generate(engine);
      const calendarRate = transactions.filter(transaction => transaction.date.slice(0, 10) >= offset(cutoff, -90)
        && transaction.date.slice(0, 10) < cutoff && transaction.category_type === 'expense' && transaction.price < 0)
        .reduce((sum, transaction) => sum - transaction.price, 0) / 90;
      for (const horizon of [7, 30]) {
        if (offset(cutoff, horizon) > options['actual-through']) continue;
        const days = selected.dailyForecasts.slice(0, horizon);
        if (options['category-limit']) categories.push(...categoryErrors(transactions, days, cutoff, horizon));
        const total = result => result.dailyForecasts.slice(0, horizon).reduce((sum, day) => sum + day.expectedExpenses, 0);
        const dailyMae = result => result.dailyForecasts.slice(0, horizon)
          .reduce((sum, day) => sum + Math.abs(day.expectedExpenses - (actuals.get(day.date) || 0)), 0) / horizon;
        rows.push({
          cutoff, horizon, actual: days.reduce((sum, day) => sum + (actuals.get(day.date) || 0), 0),
          incumbent: total(incumbent), selected: total(selected), calendarAverage: calendarRate * horizon,
          incumbentDailyMae: dailyMae(incumbent), selectedDailyMae: dailyMae(selected),
        });
      }
    } finally {
      global.Date = OriginalDate;
      db.close();
    }
  }
  const byHorizon = observations => Object.fromEntries([7, 30].map(horizon => [horizon,
    summarize(observations.filter(row => row.horizon === horizon)),
  ]));
  return {
    model: model.id,
    comparison: options.compare || 'adaptive',
    method: 'Fresh in-memory ledger per cutoff, no future transactions or current manual controls; fixed current categories and pairing exclusions; overlapping retrospective windows, no simulation or interval coverage assessment.',
    cutoffs, actualThrough: options['actual-through'], byHorizon: byHorizon(rows),
    ...(options.split ? { laterPeriod: { from: options.split, byHorizon: byHorizon(rows.filter(row => row.cutoff >= options.split)) } } : {}),
    ...(options['category-limit'] ? { categoryErrors: Object.fromEntries([7, 30].map(horizon => [horizon,
      summarizeCategories(categories.filter(row => row.horizon === horizon),
        rows.filter(row => row.horizon === horizon).length, options['category-limit']),
    ])) } : {}),
  };
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('Usage: npm run replay:forecast -- --from YYYY-MM-DD --through YYYY-MM-DD --actual-through YYYY-MM-DD [--split YYYY-MM-DD] [--db PATH] [--category-limit 10] [--compare adaptive|infrequent]\nUses the 1st, 8th, 15th and 22nd of each month. Reads the ledger without modifying it. Outputs aggregate JSON; optional category errors show where forecasts miss.');
    return;
  }
  console.log(JSON.stringify(replay(parseOptions(argv)), null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { parseOptions, summarize, summarizeCategories, categoryErrors, replay, main };
