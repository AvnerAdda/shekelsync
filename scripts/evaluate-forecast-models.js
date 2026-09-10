#!/usr/bin/env node
/**
 * Compare realized forecast accuracy for pattern-v1 vs ensemble-v1 from stored snapshots.
 *
 * Read-only: reads forecast_prediction_snapshots and completed transactions.
 *
 * Examples:
 *   node scripts/evaluate-forecast-models.js
 *   node scripts/evaluate-forecast-models.js --days 120
 *   node scripts/evaluate-forecast-models.js --champion pattern-v1 --challenger ensemble-v1 --json
 *   SQLITE_DB_PATH=/path/to/shekelsync.sqlite node scripts/evaluate-forecast-models.js
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATHS = [
  path.join(PROJECT_ROOT, 'dist', 'shekelsync.sqlite'),
  path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite'),
  path.join(PROJECT_ROOT, 'app', 'dist', 'shekelsync.sqlite'),
  path.join(PROJECT_ROOT, 'app', 'dist', 'clarify.sqlite'),
];

const detectedDbPath = DEFAULT_DB_PATHS.find((candidate) => fs.existsSync(candidate));
if (!process.env.SQLITE_DB_PATH && detectedDbPath) {
  process.env.SQLITE_DB_PATH = detectedDbPath;
  process.env.USE_SQLITE = process.env.USE_SQLITE || 'true';
}

const forecastService = require(path.join(PROJECT_ROOT, 'app', 'server', 'services', 'forecast.js'));
const registry = require(path.join(PROJECT_ROOT, 'app', 'server', 'services', 'forecast-models', 'registry.js'));
const { openForecastDb, summarizeAccuracyRows, summarizeAccuracyReadiness } = forecastService._internal;

const HORIZON_BUCKETS = [
  { key: 'days_1_7', label: '1-7 days', min: 1, max: 7 },
  { key: 'days_8_30', label: '8-30 days', min: 8, max: 30 },
  { key: 'days_31_90', label: '31-90 days', min: 31, max: 90 },
];

function parseArgs(argv) {
  const args = {
    days: 90,
    champion: registry.DEFAULT_ACTIVE_MODEL,
    challenger: 'ensemble-v1',
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  args.days = Math.max(7, Math.min(365, Number.parseInt(String(args.days), 10) || 90));
  args.json = args.json === true || args.json === 'true';
  args.champion = registry.normalizeModelId(args.champion) || registry.DEFAULT_ACTIVE_MODEL;
  args.challenger = registry.normalizeModelId(args.challenger) || 'ensemble-v1';
  return args;
}

function printHelp() {
  console.log(`
Compare forecast model accuracy from stored prediction snapshots.

Options:
  --days <n>            Evaluation window in days (default: 90, min: 7, max: 365)
  --champion <model>    Champion model id (default: pattern-v1)
  --challenger <model>  Challenger model id (default: ensemble-v1)
  --json                Print JSON output
  --help                Show this help

Environment:
  SQLITE_DB_PATH        SQLite database path (auto-detected from dist/ when omitted)

Run with Electron Node (required for better-sqlite3 in this repo):
  npm run evaluate:forecast
  ELECTRON_RUN_AS_NODE=1 app/node_modules/electron/cli.js scripts/evaluate-forecast-models.js

Metrics:
  Residual = expected - actual (positive bias means the model over-forecasted).
  Reports MAE, MAPE (when actual > 0), bias, and cash-flow interval coverage.
`);
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function summarizeExtendedMetrics(rows) {
  if (!rows.length) {
    return {
      sampleCount: 0,
      incomeMae: null,
      incomeMape: null,
      incomeBias: null,
      expenseMae: null,
      expenseMape: null,
      expenseBias: null,
      cashFlowMae: null,
      cashFlowBias: null,
      intervalCoverage: null,
    };
  }

  const base = summarizeAccuracyRows(rows);
  let incomeAbsoluteError = 0;
  let incomeError = 0;
  let incomePercentageError = 0;
  let incomePercentageSamples = 0;
  let expenseError = 0;

  rows.forEach((row) => {
    const actualIncome = Number(row.actual_income) || 0;
    const expectedIncome = Number(row.expected_income) || 0;
    const actualExpenses = Number(row.actual_expenses) || 0;
    const expectedExpenses = Number(row.expected_expenses) || 0;

    incomeAbsoluteError += Math.abs(expectedIncome - actualIncome);
    incomeError += expectedIncome - actualIncome;
    expenseError += expectedExpenses - actualExpenses;

    if (actualIncome > 0) {
      incomePercentageError += Math.abs(expectedIncome - actualIncome) / actualIncome;
      incomePercentageSamples += 1;
    }
  });

  return {
    ...base,
    incomeMae: round(incomeAbsoluteError / rows.length),
    incomeMape: incomePercentageSamples
      ? round((incomePercentageError / incomePercentageSamples) * 100)
      : null,
    incomeBias: round(incomeError / rows.length),
    expenseBias: round(expenseError / rows.length),
  };
}

function buildModelReport(rows, days, modelId) {
  const readiness = summarizeAccuracyReadiness(rows);
  const overall = summarizeExtendedMetrics(rows);
  const byHorizon = Object.fromEntries(HORIZON_BUCKETS.map((bucket) => [
    bucket.key,
    summarizeExtendedMetrics(rows.filter((row) => (
      Number(row.horizon_days) >= bucket.min && Number(row.horizon_days) <= bucket.max
    ))),
  ]));

  return {
    modelId,
    evaluationWindowDays: days,
    available: rows.length > 0,
    ...readiness,
    overall,
    byHorizon,
  };
}

function loadAccuracyRows(db, days, modelId) {
  return db.prepare(`
    WITH actuals AS (
      SELECT substr(t.date, 1, 10) AS target_date,
        SUM(CASE WHEN t.category_type = 'income' AND t.price > 0 THEN t.price ELSE 0 END) AS actual_income,
        SUM(CASE WHEN t.category_type = 'expense' AND t.price < 0 THEN ABS(t.price) ELSE 0 END) AS actual_expenses
      FROM transactions t
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) excluded
        ON excluded.transaction_identifier = t.identifier AND excluded.transaction_vendor = t.vendor
      WHERE t.status = 'completed'
        AND excluded.transaction_identifier IS NULL
        AND t.category_type IN ('income', 'expense')
      GROUP BY substr(t.date, 1, 10)
    )
    SELECT snapshot.*,
      COALESCE(actual.actual_income, 0) AS actual_income,
      COALESCE(actual.actual_expenses, 0) AS actual_expenses,
      COALESCE(actual.actual_income, 0) - COALESCE(actual.actual_expenses, 0) AS actual_cash_flow
    FROM forecast_prediction_snapshots snapshot
    LEFT JOIN actuals actual ON actual.target_date = snapshot.target_date
    WHERE snapshot.model_id = ?
      AND snapshot.target_date < date('now', 'localtime')
      AND snapshot.target_date >= date('now', 'localtime', ?)
      AND snapshot.target_date <= (SELECT MAX(target_date) FROM actuals)
      AND snapshot.horizon_days BETWEEN 1 AND 90
    ORDER BY snapshot.target_date, snapshot.horizon_days
  `).all(modelId, `-${days} days`);
}

function assertSnapshotSchema(db) {
  const columns = new Set(
    db.prepare("PRAGMA table_info('forecast_prediction_snapshots')").all().map((column) => column.name),
  );
  if (!columns.has('model_id')) {
    throw new Error(
      'forecast_prediction_snapshots.model_id is missing. Run schema migration v9 before evaluating models.',
    );
  }
}

function delta(challengerValue, championValue) {
  if (!Number.isFinite(challengerValue) || !Number.isFinite(championValue)) return null;
  return round(challengerValue - championValue);
}

function buildComparison(champion, challenger) {
  const recommendation = forecastService.recommendActiveModel({
    champion: {
      readiness: champion.readiness,
      expenseMae: champion.overall.expenseMae,
      cashFlowBias: champion.overall.cashFlowBias,
      intervalCoverage: champion.overall.intervalCoverage,
      byHorizon: champion.byHorizon,
    },
    challenger: {
      readiness: challenger.readiness,
      expenseMae: challenger.overall.expenseMae,
      cashFlowBias: challenger.overall.cashFlowBias,
      intervalCoverage: challenger.overall.intervalCoverage,
      byHorizon: challenger.byHorizon,
    },
    championId: champion.modelId,
    challengerId: challenger.modelId,
  });

  return {
    incomeMaeDelta: delta(challenger.overall.incomeMae, champion.overall.incomeMae),
    expenseMaeDelta: delta(challenger.overall.expenseMae, champion.overall.expenseMae),
    cashFlowMaeDelta: delta(challenger.overall.cashFlowMae, champion.overall.cashFlowMae),
    incomeBiasDelta: delta(challenger.overall.incomeBias, champion.overall.incomeBias),
    expenseBiasDelta: delta(challenger.overall.expenseBias, champion.overall.expenseBias),
    cashFlowBiasDelta: delta(challenger.overall.cashFlowBias, champion.overall.cashFlowBias),
    intervalCoverageDelta: delta(challenger.overall.intervalCoverage, champion.overall.intervalCoverage),
    recommendation,
  };
}

function formatMetric(value, suffix = '') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${value}${suffix}`;
}

function printMetricBlock(title, metrics) {
  console.log(`  ${title}`);
  console.log(`    income   MAE ${formatMetric(metrics.incomeMae)} | MAPE ${formatMetric(metrics.incomeMape, '%')} | bias ${formatMetric(metrics.incomeBias)}`);
  console.log(`    expenses MAE ${formatMetric(metrics.expenseMae)} | MAPE ${formatMetric(metrics.expenseMape, '%')} | bias ${formatMetric(metrics.expenseBias)}`);
  console.log(`    cashflow MAE ${formatMetric(metrics.cashFlowMae)} | bias ${formatMetric(metrics.cashFlowBias)} | coverage ${formatMetric(metrics.intervalCoverage, '%')}`);
}

function printReport(payload) {
  console.log(`Forecast model evaluation (${payload.evaluationWindowDays} days)`);
  console.log(`DB: ${payload.dbPath}`);
  console.log('');

  [payload.champion, payload.challenger].forEach((model) => {
    console.log(`${model.modelId}${model.modelId === payload.champion.modelId ? ' (champion)' : ' (challenger)'}`);
    console.log(`  samples: ${model.overall.sampleCount} | readiness: ${model.readiness} | observed days: ${model.observedDays}`);
    if (model.evaluatedFrom && model.evaluatedThrough) {
      console.log(`  window: ${model.evaluatedFrom} -> ${model.evaluatedThrough}`);
    }
    printMetricBlock('overall', model.overall);
    HORIZON_BUCKETS.forEach((bucket) => {
      const metrics = model.byHorizon[bucket.key];
      if (!metrics?.sampleCount) return;
      printMetricBlock(bucket.label, metrics);
    });
    console.log('');
  });

  console.log('Comparison (challenger - champion; negative MAE delta = challenger better)');
  console.log(`  income MAE delta: ${formatMetric(payload.comparison.incomeMaeDelta)}`);
  console.log(`  expense MAE delta: ${formatMetric(payload.comparison.expenseMaeDelta)}`);
  console.log(`  cashflow MAE delta: ${formatMetric(payload.comparison.cashFlowMaeDelta)}`);
  console.log(`  income bias delta: ${formatMetric(payload.comparison.incomeBiasDelta)}`);
  console.log(`  expense bias delta: ${formatMetric(payload.comparison.expenseBiasDelta)}`);
  console.log(`  cashflow bias delta: ${formatMetric(payload.comparison.cashFlowBiasDelta)}`);
  console.log(`  coverage delta: ${formatMetric(payload.comparison.intervalCoverageDelta, ' pts')}`);
  console.log(`  recommendation: ${payload.comparison.recommendation.recommendedModel} (${payload.comparison.recommendation.reason})`);
  if (payload.comparison.recommendation.readyToPromote) {
    console.log('  promotion gate: ready (review before switching FORECAST_ACTIVE_MODEL)');
  }
}

function evaluateModels(options) {
  const db = openForecastDb();
  try {
    assertSnapshotSchema(db);
    const championRows = loadAccuracyRows(db, options.days, options.champion);
    const challengerRows = loadAccuracyRows(db, options.days, options.challenger);
    const champion = buildModelReport(championRows, options.days, options.champion);
    const challenger = buildModelReport(challengerRows, options.days, options.challenger);

    return {
      dbPath: process.env.SQLITE_DB_PATH || forecastService._internal.resolveForecastDbPath(),
      evaluationWindowDays: options.days,
      champion,
      challenger,
      comparison: buildComparison(champion, challenger),
    };
  } finally {
    db.close();
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const payload = evaluateModels(options);
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    printReport(payload);
  } catch (error) {
    console.error(`evaluate-forecast-models: ${error?.message || error}`);
    process.exitCode = 1;
  }
}

main();
