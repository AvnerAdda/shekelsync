#!/usr/bin/env node
/**
 * Run analytics benchmarks against the synthetic dataset and assert thresholds.
 * Mirrors the scenarios documented in docs/benchmarks.md (months=3, default dataset).
 */

const { execFileSync } = require('node:child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BREAKDOWN_LIMITS_MS = {
  expense: 120,
  income: 120,
  investment: 120,
};
const DASHBOARD_LIMIT_MS = 80;

function runNode(script, args = []) {
  const result = execFileSync('node', [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const trimmed = result.trim();
  const lastLine = trimmed.split('\n').pop();
  return JSON.parse(lastLine);
}

function runSetup() {
  try {
    execFileSync('node', ['scripts/init_sqlite_db.js', '--force'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('node', ['scripts/seed_synthetic_transactions.js'], { cwd: ROOT, stdio: 'inherit' });
  } catch (error) {
    // Common pitfall: native better-sqlite3 built for a different Node version
    const hint =
      'Hint: if you see a NODE_MODULE_VERSION mismatch, run `npm --prefix app rebuild better-sqlite3` (or reinstall deps) to rebuild against the current Node version.';
    const message = error?.message || String(error);
    throw new Error(`${message}\n${hint}`);
  }
}

function formatResultLabel(bucket, type) {
  return type ? `${bucket}:${type}` : bucket;
}

function main() {
  const failures = [];
  runSetup();

  const breakdownResults = runNode('scripts/benchmarks/analytics-breakdown-benchmark.js', [
    '--all',
    '--months',
    '3',
  ]);
  breakdownResults.forEach((entry) => {
    const limit = BREAKDOWN_LIMITS_MS[entry.type] ?? 150;
    if (entry.durationMs > limit) {
      failures.push(
        `${formatResultLabel('breakdown', entry.type)} regressed: ${entry.durationMs}ms > ${limit}ms`,
      );
    }
  });

  const dashboardResult = runNode('scripts/benchmarks/analytics-dashboard-benchmark.js', [
    '--months',
    '3',
    '--aggregation',
    'monthly',
  ]);
  if (dashboardResult.durationMs > DASHBOARD_LIMIT_MS) {
    failures.push(
      `${formatResultLabel('dashboard')} regressed: ${dashboardResult.durationMs}ms > ${DASHBOARD_LIMIT_MS}ms`,
    );
  }

  if (failures.length) {
    console.error('Benchmark regressions detected:\n- ' + failures.join('\n- '));
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        breakdown: breakdownResults,
        dashboard: dashboardResult,
        thresholds: { breakdown: BREAKDOWN_LIMITS_MS, dashboard: DASHBOARD_LIMIT_MS },
      },
      null,
      2,
    ),
  );
}

main();
