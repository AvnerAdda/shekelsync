#!/usr/bin/env node
/**
 * Inspect saved Discount credentials and show the exact values the scraper will use.
 *
 * Read-only utility: no scrape is executed and no DB updates are performed.
 *
 * Examples:
 *   SHEKELSYNC_ENCRYPTION_KEY=... node scripts/check-discount-credentials.js
 *   node scripts/check-discount-credentials.js --credential-id 1
 *   node scripts/check-discount-credentials.js --credential-id 1 --show-secrets
 *   node scripts/check-discount-credentials.js --vendor mercantile --json
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATHS = [
  path.join(PROJECT_ROOT, 'dist', 'shekelsync.sqlite'),
  path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite'),
];

const detectedDbPath = DEFAULT_DB_PATHS.find((candidate) => fs.existsSync(candidate));
if (!process.env.SQLITE_DB_PATH && detectedDbPath) {
  process.env.SQLITE_DB_PATH = detectedDbPath;
  process.env.USE_SQLITE = process.env.USE_SQLITE || 'true';
}

const database = require(path.join(PROJECT_ROOT, 'app', 'server', 'services', 'database.js'));
const { decrypt } = require(path.join(PROJECT_ROOT, 'app', 'lib', 'server', 'encryption.js'));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Inspect saved Discount credentials and show what the scraper receives.

Options:
  --vendor <code>         Vendor code (default: discount)
  --credential-id <id>    Filter by vendor_credentials.id
  --nickname <name>       Filter by nickname (exact match)
  --limit <n>             Max rows to print (default: 10)
  --show-secrets          Print full decrypted values (default: masked)
  --json                  Output JSON
  --help                  Show help

Environment:
  SQLITE_DB_PATH              Path to SQLite DB (auto-detected from dist/ by default)
  SHEKELSYNC_ENCRYPTION_KEY   Required to decrypt encrypted credential fields
`);
}

function looksEncrypted(payload) {
  if (typeof payload !== 'string') return false;
  const parts = payload.split(':');
  if (parts.length !== 3) return false;
  return parts.every((part) => /^[0-9a-f]+$/i.test(part));
}

function decryptIfEncrypted(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  if (!looksEncrypted(value)) return value;
  try {
    return decrypt(value);
  } catch (error) {
    throw new Error(`Failed to decrypt ${fieldName}: ${error.message}`);
  }
}

function maskValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (text.length === 0) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}***${text.slice(-2)} (len=${text.length})`;
}

function parsePositiveInt(raw, flagName) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName}: ${raw}`);
  }
  return parsed;
}

function projectRow(row, showSecrets) {
  const idValue = decryptIfEncrypted(row.id_number, 'id_number');
  const passwordValue = decryptIfEncrypted(row.password, 'password');
  const identificationValue = decryptIfEncrypted(row.identification_code, 'identification_code');

  const display = (value) => (showSecrets ? value : maskValue(value));

  return {
    credentialId: row.id,
    vendor: row.vendor,
    nickname: row.nickname || null,
    scrapeStatus: {
      lastStatus: row.last_scrape_status || null,
      lastAttempt: row.last_scrape_attempt || null,
      lastSuccess: row.last_scrape_success || null,
      updatedAt: row.updated_at || null,
    },
    dbStorage: {
      encrypted: {
        id_number: looksEncrypted(row.id_number),
        password: looksEncrypted(row.password),
        identification_code: looksEncrypted(row.identification_code),
      },
      username: display(decryptIfEncrypted(row.username, 'username')),
      id_number: display(idValue),
      password: display(passwordValue),
      identification_code: display(identificationValue),
    },
    scraperInput: {
      id: display(idValue),
      password: display(passwordValue),
      num: display(identificationValue),
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const vendor = typeof args.vendor === 'string' ? args.vendor.trim() : 'discount';
  const showSecrets = Boolean(args['show-secrets'] || args.showSecrets);
  const jsonOutput = Boolean(args.json);

  const credentialIdRaw = args['credential-id'] ?? args.credentialId;
  const credentialId = credentialIdRaw !== undefined
    ? parsePositiveInt(credentialIdRaw, '--credential-id')
    : null;

  const limitRaw = args.limit;
  const limit = limitRaw !== undefined ? parsePositiveInt(limitRaw, '--limit') : 10;

  const where = ['vendor = $1'];
  const params = [vendor];

  if (credentialId !== null) {
    where.push(`id = $${params.length + 1}`);
    params.push(credentialId);
  }

  if (typeof args.nickname === 'string' && args.nickname.trim().length > 0) {
    where.push(`nickname = $${params.length + 1}`);
    params.push(args.nickname.trim());
  }

  const limitPlaceholder = `$${params.length + 1}`;
  params.push(limit);

  const sql = `
    SELECT
      id,
      vendor,
      nickname,
      username,
      password,
      id_number,
      identification_code,
      last_scrape_status,
      last_scrape_attempt,
      last_scrape_success,
      updated_at
    FROM vendor_credentials
    WHERE ${where.join(' AND ')}
    ORDER BY id ASC
    LIMIT ${limitPlaceholder}
  `;

  const result = await database.query(sql, params);
  const rows = result.rows || [];
  const outputRows = rows.map((row) => projectRow(row, showSecrets));

  if (jsonOutput) {
    console.log(JSON.stringify({
      vendor,
      count: outputRows.length,
      showSecrets,
      sqliteDbPath: process.env.SQLITE_DB_PATH || null,
      rows: outputRows,
    }, null, 2));
    return;
  }

  console.log(`Vendor: ${vendor}`);
  console.log(`Credential rows: ${outputRows.length}`);
  console.log(`DB path: ${process.env.SQLITE_DB_PATH || '(default pool config)'}`);
  console.log(`Show secrets: ${showSecrets ? 'yes' : 'no (masked)'}`);
  console.log('');

  if (outputRows.length === 0) {
    console.log('No matching credentials found.');
    return;
  }

  for (const row of outputRows) {
    console.log(`# credentialId=${row.credentialId} nickname=${row.nickname || '(none)'}`);
    console.log(`  scraper.id: ${row.scraperInput.id ?? '(null)'}`);
    console.log(`  scraper.password: ${row.scraperInput.password ?? '(null)'}`);
    console.log(`  scraper.num: ${row.scraperInput.num ?? '(null)'}`);
    console.log(`  encrypted_in_db: id_number=${row.dbStorage.encrypted.id_number}, password=${row.dbStorage.encrypted.password}, identification_code=${row.dbStorage.encrypted.identification_code}`);
    console.log(`  status: ${row.scrapeStatus.lastStatus || '(none)'} | attempt=${row.scrapeStatus.lastAttempt || '(none)'} | success=${row.scrapeStatus.lastSuccess || '(none)'}`);
    console.log('');
  }
}

main()
  .catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await database.close();
    } catch (_) {
      // ignore close failures in a diagnostic script
    }
  });
