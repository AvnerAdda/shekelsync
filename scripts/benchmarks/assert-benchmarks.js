#!/usr/bin/env node
/**
 * Run analytics benchmarks against the demo dataset and assert thresholds.
 * Mirrors the scenarios documented in docs/benchmarks.md (months=3, default dataset).
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BREAKDOWN_LIMITS_MS = {
  expense: 120,
  income: 120,
  investment: 120,
};
const DASHBOARD_LIMIT_MS = 80;
const BENCHMARK_BASE_DATE = process.env.DEMO_BASE_DATE || new Date().toISOString();

function getRuntimeCandidates() {
  const runtimes = [
    {
      label: 'Node.js',
      executable: process.execPath,
      env: {},
    },
  ];

  try {
    const electronExecutable = require(path.join(ROOT, 'app', 'node_modules', 'electron'));
    if (electronExecutable && electronExecutable !== process.execPath) {
      runtimes.push({
        label: 'Electron (Node mode)',
        executable: electronExecutable,
        env: { ELECTRON_RUN_AS_NODE: '1' },
      });
    }
  } catch {
    // Electron is optional for benchmark environments that have a Node-native build.
  }

  return runtimes;
}

function buildChildEnv(runtime, databasePath) {
  return {
    ...process.env,
    ...runtime.env,
    SQLITE_DB_PATH: databasePath,
    USE_SQLITE: 'true',
    DEMO_BASE_DATE: BENCHMARK_BASE_DATE,
  };
}

function parseJsonResult(result, script) {
  const trimmed = result.trim();
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed[index] !== '{' && trimmed[index] !== '[') continue;
    try {
      return JSON.parse(trimmed.slice(index));
    } catch {
      // Keep walking back until the start of the final JSON payload is found.
    }
  }
  throw new Error(`Benchmark did not emit a JSON result: ${script}`);
}

function runNode(runtime, databasePath, script, args = []) {
  const result = execFileSync(runtime.executable, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildChildEnv(runtime, databasePath),
  });
  return parseJsonResult(result, script);
}

function removeBenchmarkDatabase(databasePath) {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

function errorText(error) {
  return [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .map(String)
    .join('\n');
}

function isNativeModuleVersionMismatch(error) {
  const message = errorText(error);
  return message.includes('NODE_MODULE_VERSION')
    || message.includes('compiled against a different Node.js version');
}

function runSetup(runtime, databasePath) {
  const options = {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildChildEnv(runtime, databasePath),
  };

  execFileSync(runtime.executable, [
    'scripts/init_sqlite_db.js',
    '--output',
    databasePath,
  ], options);
  execFileSync(runtime.executable, ['scripts/seed_realistic_demo.js'], options);
}

function prepareBenchmarkDatabase(databasePath) {
  const runtimes = getRuntimeCandidates();
  let lastError = null;

  for (const runtime of runtimes) {
    removeBenchmarkDatabase(databasePath);
    try {
      runSetup(runtime, databasePath);
      return runtime;
    } catch (error) {
      lastError = error;
      if (!isNativeModuleVersionMismatch(error)) {
        throw error;
      }
    }
  }

  const details = errorText(lastError);
  throw new Error(
    `No installed runtime can load better-sqlite3 for the benchmark.\n${details}`,
  );
}

function formatResultLabel(bucket, type) {
  return type ? `${bucket}:${type}` : bucket;
}

function main() {
  const failures = [];
  const benchmarkDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shekelsync-benchmark-'));
  const databasePath = path.join(benchmarkDirectory, 'benchmark.sqlite');

  try {
    const runtime = prepareBenchmarkDatabase(databasePath);
    const breakdownResults = runNode(
      runtime,
      databasePath,
      'scripts/benchmarks/analytics-breakdown-benchmark.js',
      ['--all', '--months', '3'],
    );
    breakdownResults.forEach((entry) => {
      const limit = BREAKDOWN_LIMITS_MS[entry.type] ?? 150;
      if (entry.durationMs > limit) {
        failures.push(
          `${formatResultLabel('breakdown', entry.type)} regressed: ${entry.durationMs}ms > ${limit}ms`,
        );
      }
    });

    const dashboardResult = runNode(
      runtime,
      databasePath,
      'scripts/benchmarks/analytics-dashboard-benchmark.js',
      ['--months', '3', '--aggregation', 'monthly'],
    );
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
          runtime: runtime.label,
          breakdown: breakdownResults,
          dashboard: dashboardResult,
          thresholds: { breakdown: BREAKDOWN_LIMITS_MS, dashboard: DASHBOARD_LIMIT_MS },
        },
        null,
        2,
      ),
    );
  } finally {
    fs.rmSync(benchmarkDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildChildEnv,
  isNativeModuleVersionMismatch,
  parseJsonResult,
  removeBenchmarkDatabase,
};
