#!/usr/bin/env node
/**
 * Release migration guardrail.
 *
 * Purpose:
 * - Compare migration files against the latest release tag (or a provided base tag).
 * - Surface what changed so every release explicitly reviews DB migration rollout.
 *
 * Usage:
 *   node scripts/migrations/check_release_migrations.js
 *   node scripts/migrations/check_release_migrations.js --base-tag v0.1.14
 *   node scripts/migrations/check_release_migrations.js --allow-changes
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'scripts', 'migrations');
const APP_PACKAGE_JSON = path.join(PROJECT_ROOT, 'app', 'package.json');
const CHECKLIST_PATH = path.join(MIGRATIONS_DIR, 'NEXT_RELEASE_CHECKLIST.md');
const SUPPORTED_EXTENSIONS = new Set(['.sql', '.js']);

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = String(error.stderr || error.message || '').trim();
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    baseTag: null,
    allowChanges: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--base-tag') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('Missing value after --base-tag');
      }
      options.baseTag = value;
      i += 1;
      continue;
    }

    if (arg === '--allow-changes') {
      options.allowChanges = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/migrations/check_release_migrations.js [options]

Options:
  --base-tag <tag>   Compare migration changes from this tag to HEAD
  --allow-changes    Exit 0 even when migration changes are detected
  -h, --help         Show this help message
`);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getLatestReleaseTag() {
  const output = runGit(['tag', '--list', 'v*', '--sort=-version:refname']);
  const tags = output ? output.split('\n').map((tag) => tag.trim()).filter(Boolean) : [];
  return tags[0] || null;
}

function getAppVersion() {
  try {
    const appPackage = JSON.parse(fs.readFileSync(APP_PACKAGE_JSON, 'utf8'));
    return appPackage.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function isMigrationFile(filePath) {
  const ext = path.extname(filePath);
  return SUPPORTED_EXTENSIONS.has(ext);
}

function listCurrentMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => isMigrationFile(name))
    .sort();
}

function parseNameStatusRows(raw) {
  if (!raw) return [];

  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  for (const row of rows) {
    const parts = row.split('\t');
    if (parts.length < 2) continue;

    const status = parts[0];
    const oldPath = parts.length >= 3 ? parts[1] : null;
    const filePath = parts.length >= 3 ? parts[2] : parts[1];
    if (!filePath) continue;
    if (!filePath.startsWith('scripts/migrations/')) continue;
    if (!isMigrationFile(filePath)) continue;

    entries.push({
      status,
      filePath,
      oldPath,
    });
  }

  return entries;
}

function getCommittedChangesSinceTag(baseTag) {
  if (!baseTag) return [];
  const output = runGit(['diff', '--name-status', `${baseTag}..HEAD`, '--', 'scripts/migrations']);
  return parseNameStatusRows(output);
}

function getWorkingTreeChanges() {
  const output = runGit(['status', '--porcelain', '--', 'scripts/migrations']);
  if (!output) return [];

  const rows = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const entries = [];
  for (const row of rows) {
    const status = row.slice(0, 2).trim() || '??';
    const filePath = row.slice(3).trim();
    if (!filePath.startsWith('scripts/migrations/')) continue;
    if (!isMigrationFile(filePath)) continue;
    entries.push({ status, filePath });
  }
  return entries;
}

function formatRows(title, rows) {
  if (!rows.length) {
    return `${title}: none`;
  }
  const lines = rows.map((row) => `- [${row.status}] ${row.filePath}${row.oldPath ? ` (from ${row.oldPath})` : ''}`);
  return `${title}:\n${lines.join('\n')}`;
}

function ensureChecklistExists() {
  return fs.existsSync(CHECKLIST_PATH);
}

function main() {
  const options = parseArgs();
  const baseTag = options.baseTag || getLatestReleaseTag();
  const appVersion = getAppVersion();
  const committedChanges = getCommittedChangesSinceTag(baseTag);
  const workingTreeChanges = getWorkingTreeChanges();
  const migrationFiles = listCurrentMigrationFiles();
  const hasChecklist = ensureChecklistExists();
  const hasChanges = committedChanges.length > 0 || workingTreeChanges.length > 0;

  console.log('=== Release Migration Review ===');
  console.log(`App version: ${appVersion}`);
  console.log(`Base tag: ${baseTag || 'not found (no release tags yet)'}`);
  console.log(`Migration files tracked: ${migrationFiles.length}`);
  console.log(`Checklist placeholder: ${hasChecklist ? 'present' : 'missing'}`);
  console.log('');
  console.log(formatRows('Committed migration changes since base tag', committedChanges));
  console.log('');
  console.log(formatRows('Uncommitted migration changes in working tree', workingTreeChanges));
  console.log('');
  console.log('Release checklist:');
  console.log('- [ ] Decide if each migration change must run for existing installs.');
  console.log('- [ ] Add/update runnable npm scripts (migrate:*) for required migrations.');
  console.log('- [ ] Document manual vs automatic rollout in release notes.');
  console.log('- [ ] Archive or remove obsolete migration files when safe.');
  console.log('');

  if (migrationFiles.length > 12) {
    console.warn(
      `WARN: scripts/migrations currently has ${migrationFiles.length} files. Consider archiving old ones to keep release reviews focused.`,
    );
  }

  if (!hasChanges) {
    console.log('No migration deltas detected since base tag.');
    process.exit(0);
  }

  if (options.allowChanges) {
    console.log('Migration deltas detected (allowed by --allow-changes).');
    process.exit(0);
  }

  console.error(
    'Migration deltas detected. Review and decide rollout before release. Re-run with --allow-changes if intentionally acknowledged.',
  );
  process.exit(2);
}

try {
  main();
} catch (error) {
  console.error(`Migration check failed: ${error.message || error}`);
  process.exit(1);
}

