#!/usr/bin/env node
/**
 * Quick regression benchmark for the analytics breakdown service.
 * Usage:
 *    node scripts/benchmarks/analytics-breakdown-benchmark.js --type expense --months 6
 */

const { performance } = require('node:perf_hooks');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATHS = [
  path.join(PROJECT_ROOT, 'dist', 'shekelsync.sqlite'),
  path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite'),
];
const detectedDbPath = DEFAULT_DB_PATHS.find((candidate) => fs.existsSync(candidate));
if (!process.env.SQLITE_DB_PATH && detectedDbPath) {
  process.env.SQLITE_DB_PATH = detectedDbPath;
  process.env.USE_SQLITE = process.env.USE_SQLITE || 'true';
}

const service = require(path.join(__dirname, '..', '..', 'app', 'server', 'services', 'analytics', 'breakdown.js'));

function parseArgs(argv) {
  const args = {
    type: undefined,
    months: 3,
    all: false,
  };

  argv.forEach((arg, idx) => {
    if (!arg.startsWith('--')) {
      return;
    }
    const key = arg.slice(2);
    if (key === 'all') {
      args.all = true;
      return;
    }
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

async function runBenchmark(type, months) {
  const timerStart = performance.now();
  const result = await service.getBreakdownAnalytics({ type, months });
  const durationMs = Number((performance.now() - timerStart).toFixed(2));
  return {
    type,
    months,
    durationMs,
    categories: result.breakdowns?.byCategory?.length ?? 0,
    vendors: result.breakdowns?.byVendor?.length ?? 0,
    transactions: result.transactions?.length ?? 0,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const types = options.all
    ? ['expense', 'income', 'investment']
    : [options.type || 'expense'];

  const results = [];
  for (const type of types) {
    results.push(await runBenchmark(type, options.months));
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error('Benchmark failed', error);
  process.exitCode = 1;
});
