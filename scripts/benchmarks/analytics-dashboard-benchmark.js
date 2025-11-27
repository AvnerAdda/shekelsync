#!/usr/bin/env node
/**
 * Benchmark the dashboard analytics service.
 *
 * Usage:
 *   node scripts/benchmarks/analytics-dashboard-benchmark.js --months 3 --aggregation monthly
 */

const { performance } = require('node:perf_hooks');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');
if (!process.env.SQLITE_DB_PATH && fs.existsSync(DEFAULT_DB_PATH)) {
  process.env.SQLITE_DB_PATH = DEFAULT_DB_PATH;
  process.env.USE_SQLITE = process.env.USE_SQLITE || 'true';
}

const service = require(path.join(__dirname, '..', '..', 'app', 'server', 'services', 'analytics', 'dashboard.js'));

function parseArgs(argv) {
  const args = {
    months: 3,
    aggregation: 'daily',
  };

  argv.forEach((arg, idx) => {
    if (!arg.startsWith('--')) {
      return;
    }
    const key = arg.slice(2);
    const value = argv[idx + 1];
    if (value && !value.startsWith('--')) {
      args[key] = value;
    } else {
      args[key] = true;
    }
  });

  args.months = Number(args.months) || 3;
  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const timerStart = performance.now();
  const result = await service.getDashboardAnalytics({
    months: options.months,
    aggregation: options.aggregation,
  });
  const durationMs = Number((performance.now() - timerStart).toFixed(2));

  console.log(
    JSON.stringify(
      {
        months: options.months,
        aggregation: options.aggregation,
        durationMs,
        historyPoints: result.history?.length ?? 0,
        categories: result.breakdowns?.byCategory?.length ?? 0,
        vendors: result.breakdowns?.byVendor?.length ?? 0,
        bankAccounts: result.breakdowns?.byBankAccount?.length ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('Dashboard benchmark failed', error);
  process.exitCode = 1;
});
