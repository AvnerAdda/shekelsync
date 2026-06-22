#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'renderer', 'dist');
const MANIFEST_PATH = path.join(DIST_DIR, '.vite', 'manifest.json');
const BUDGETS_PATH = path.join(__dirname, 'performance-budgets.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function collectStaticImports(manifest, entryKeys) {
  const visited = new Set();
  const visit = (key) => {
    if (!key || visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Manifest entry not found: ${key}`);
    visited.add(key);
    (entry.imports || []).forEach(visit);
  };
  entryKeys.forEach(visit);
  return visited;
}

function javascriptBytesForEntries(manifest, entryKeys) {
  return [...entryKeys].reduce((total, key) => {
    const file = manifest[key]?.file;
    if (!file?.endsWith('.js')) return total;
    return total + fs.statSync(path.join(DIST_DIR, file)).size;
  }, 0);
}

function findManifestKeyBySource(manifest, source) {
  return Object.keys(manifest).find((key) => manifest[key]?.src === source);
}

function findMaterialIconBarrelImports(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findMaterialIconBarrelImports(entryPath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    const source = fs.readFileSync(entryPath, 'utf8');
    return /from\s+['"]@mui\/icons-material['"]/.test(source)
      ? [path.relative(ROOT, entryPath)]
      : [];
  });
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Renderer manifest not found at ${MANIFEST_PATH}. Run the renderer build first.`);
  }

  const manifest = readJson(MANIFEST_PATH);
  const budgets = readJson(BUDGETS_PATH);
  const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
  const dashboardKey = findManifestKeyBySource(
    manifest,
    'src/features/dashboard/pages/HomePage.tsx',
  );
  if (!entryKey || !dashboardKey) {
    throw new Error('Unable to identify renderer entry or dashboard entry in the Vite manifest.');
  }

  const initialEntries = collectStaticImports(manifest, [entryKey]);
  const dashboardEntries = collectStaticImports(manifest, [entryKey, dashboardKey]);
  const initialJsBytes = javascriptBytesForEntries(manifest, initialEntries);
  const dashboardJsBytes = javascriptBytesForEntries(manifest, dashboardEntries);

  const assetFiles = fs.readdirSync(path.join(DIST_DIR, 'assets'))
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({
      file,
      size: fs.statSync(path.join(DIST_DIR, 'assets', file)).size,
    }));
  const totalJsBytes = assetFiles.reduce((total, asset) => total + asset.size, 0);
  const largestChunk = assetFiles.reduce(
    (largest, asset) => (asset.size > largest.size ? asset : largest),
    { file: '', size: 0 },
  );

  const failures = [];
  const enforce = (label, actual, limit) => {
    if (actual > limit) {
      failures.push(`${label}: ${formatBytes(actual)} > ${formatBytes(limit)}`);
    }
  };

  enforce('Initial JavaScript', initialJsBytes, budgets.initialJsBytes);
  enforce('Dashboard JavaScript', dashboardJsBytes, budgets.dashboardJsBytes);
  enforce('Total JavaScript', totalJsBytes, budgets.totalJsBytes);
  enforce('Largest chunk', largestChunk.size, budgets.maxChunkBytes);

  const deferredSources = [
    'src/shared/modals/AccountsModal.tsx',
    'src/shared/modals/ScrapeModal.tsx',
    'src/shared/modals/CategoryHierarchyModal.tsx',
    'src/features/chatbot/components/FinancialChatbot.tsx',
  ];
  deferredSources.forEach((source) => {
    const key = findManifestKeyBySource(manifest, source);
    if (!key) {
      failures.push(`Deferred module missing from manifest: ${source}`);
    } else if (initialEntries.has(key)) {
      failures.push(`Deferred module leaked into the initial dependency graph: ${source}`);
    }
  });

  const iconBarrelImports = findMaterialIconBarrelImports(
    path.join(ROOT, 'renderer', 'src'),
  );
  if (iconBarrelImports.length > 0) {
    failures.push(
      `Material icon barrel imports found (use direct icon paths): ${iconBarrelImports.join(', ')}`,
    );
  }

  console.log(JSON.stringify({
    initialJsBytes,
    dashboardJsBytes,
    totalJsBytes,
    largestChunk,
    budgets: {
      initialJsBytes: budgets.initialJsBytes,
      dashboardJsBytes: budgets.dashboardJsBytes,
      totalJsBytes: budgets.totalJsBytes,
      maxChunkBytes: budgets.maxChunkBytes,
    },
  }, null, 2));

  if (failures.length > 0) {
    console.error(`Renderer performance budget failed:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
