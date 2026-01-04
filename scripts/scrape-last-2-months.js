#!/usr/bin/env node
/**
 * Re-scrape saved vendor credentials for a fixed lookback window (default: last 2 months).
 *
 * This is useful to backfill transactions if you suspect some were missed.
 *
 * Usage:
 *   CLARIFY_ENCRYPTION_KEY=... node scripts/scrape-last-2-months.js
 *   node scripts/scrape-last-2-months.js --months 2
 *   node scripts/scrape-last-2-months.js --start-date 2025-11-01
 *   node scripts/scrape-last-2-months.js --vendor max
 *   node scripts/scrape-last-2-months.js --credential-id 12
 *   node scripts/scrape-last-2-months.js --dry-run
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'dist', 'clarify.sqlite');

if (!process.env.SQLITE_DB_PATH && fs.existsSync(DEFAULT_DB_PATH)) {
  process.env.SQLITE_DB_PATH = DEFAULT_DB_PATH;
  process.env.USE_SQLITE = process.env.USE_SQLITE || 'true';
}

const database = require(path.join(PROJECT_ROOT, 'app', 'server', 'services', 'database.js'));
const scrapingService = require(path.join(PROJECT_ROOT, 'app', 'server', 'services', 'scraping', 'run.js'));
const { decrypt } = require(path.join(PROJECT_ROOT, 'app', 'lib', 'server', 'encryption.js'));

function parseArgs(argv) {
  const args = {};

  argv.forEach((arg, idx) => {
    if (!arg.startsWith('--')) return;
    const key = arg.slice(2);
    const value = argv[idx + 1];

    if (value && !value.startsWith('--')) {
      args[key] = value;
    } else {
      args[key] = true;
    }
  });

  return args;
}

function printHelp() {
  console.log(`
Re-scrape saved vendor credentials for the last 2 months (or a custom window).

Examples:
  CLARIFY_ENCRYPTION_KEY=... node scripts/scrape-last-2-months.js
  node scripts/scrape-last-2-months.js --months 2
  node scripts/scrape-last-2-months.js --start-date 2025-11-01
  node scripts/scrape-last-2-months.js --vendor hapoalim,visaCal
  node scripts/scrape-last-2-months.js --credential-id 12
  node scripts/scrape-last-2-months.js --dry-run

Options:
  --months <n>           Lookback months (default: 2)
  --start-date <date>    Override start date (YYYY-MM-DD or ISO string)
  --vendor <codes>       Comma-separated vendor codes to include (e.g., "max,visaCal")
  --credential-id <id>   Only run for a specific vendor_credentials.id
  --limit <n>            Limit number of credentials processed
  --show-browser         Run scraper with a visible browser (default: headless)
  --dry-run              Print what would run without scraping
  --json                 Output results as JSON
  --help                 Show this help

Environment:
  SQLITE_DB_PATH         Path to SQLite DB (defaults to dist/clarify.sqlite if present)
  CLARIFY_ENCRYPTION_KEY Required to decrypt credentials stored in vendor_credentials
`);
}

function parseStartDate(value) {
  if (!value) return null;
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid --start-date: ${value}`);
    }
    return parsed;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --start-date: ${value}`);
  }
  return parsed;
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
    const details = fieldName ? ` (${fieldName})` : '';
    throw new Error(`Failed to decrypt credential field${details}: ${error.message}`);
  }
}

function computeMonthsAgo(months) {
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  return start;
}

async function countTransactions({ vendor, nickname, startDate }) {
  const result = await database.query(
    `
      SELECT COUNT(*) AS count
      FROM transactions t
      WHERE t.vendor = $1
        AND t.vendor_nickname IS $2
        AND date(t.date) >= date($3)
    `,
    [vendor, nickname ?? null, startDate],
  );
  return Number(result.rows?.[0]?.count || 0);
}

function buildRunScrapeCredentials(row) {
  const username = decryptIfEncrypted(row.username, 'username');
  const idNumber = decryptIfEncrypted(row.id_number, 'id_number');

  const credentials = {
    dbId: row.id, // vendor_credentials.id (for scrape_events + status updates)
    vendor: row.vendor,
    nickname: row.nickname || null,
    username,
    password: decryptIfEncrypted(row.password, 'password'),
    id: idNumber,
    bankAccountNumber: decryptIfEncrypted(row.bank_account_number, 'bank_account_number') || null,
    card6Digits: decryptIfEncrypted(row.card6_digits, 'card6_digits') || null,
    identification_code: decryptIfEncrypted(row.identification_code, 'identification_code'),
    institution_id: row.institution_id || null,
  };

  // oneZero expects `email` (we store it in vendor_credentials.username)
  if (row.vendor === 'oneZero' && !credentials.email) {
    credentials.email = username;
  }

  // discount/mercantile expect `num` (we store it in vendor_credentials.identification_code)
  if ((row.vendor === 'discount' || row.vendor === 'mercantile') && !credentials.num) {
    credentials.num = credentials.identification_code;
  }

  return credentials;
}

async function main() {
  const raw = parseArgs(process.argv.slice(2));
  if (raw.help) {
    printHelp();
    return;
  }

  const months = raw.months !== undefined ? Number(raw.months) : 2;
  if (!Number.isFinite(months) || months <= 0) {
    throw new Error(`Invalid --months: ${raw.months}`);
  }

  const startDate =
    parseStartDate(raw['start-date'] || raw.startDate) ||
    computeMonthsAgo(months);

  const vendorFilter = typeof raw.vendor === 'string'
    ? raw.vendor.split(',').map((v) => v.trim()).filter(Boolean)
    : [];

  const credentialIdRaw = raw['credential-id'] || raw.credentialId;
  const credentialId = credentialIdRaw !== undefined ? Number(credentialIdRaw) : null;
  if (credentialIdRaw !== undefined && (!Number.isInteger(credentialId) || credentialId <= 0)) {
    throw new Error(`Invalid --credential-id: ${credentialIdRaw}`);
  }

  const limitRaw = raw.limit;
  const limit = limitRaw !== undefined ? Number(limitRaw) : null;
  if (limitRaw !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`Invalid --limit: ${limitRaw}`);
  }

  const dryRun = Boolean(raw['dry-run'] || raw.dryRun);
  const jsonOutput = Boolean(raw.json);
  const showBrowser = Boolean(raw['show-browser'] || raw.showBrowser);

  const where = [];
  const params = [];

  if (vendorFilter.length > 0) {
    const placeholders = vendorFilter.map((_, idx) => `$${params.length + idx + 1}`).join(', ');
    where.push(`vendor IN (${placeholders})`);
    params.push(...vendorFilter);
  }

  if (credentialId) {
    where.push(`id = $${params.length + 1}`);
    params.push(credentialId);
  }

  let sql = `
    SELECT
      id,
      vendor,
      nickname,
      username,
      password,
      id_number,
      card6_digits,
      bank_account_number,
      identification_code,
      institution_id
    FROM vendor_credentials
  `;

  if (where.length > 0) {
    sql += ` WHERE ${where.join(' AND ')}\n`;
  }

  sql += ' ORDER BY vendor, id\n';

  if (limit) {
    sql += ` LIMIT ${limit}\n`;
  }

  const credentialsResult = await database.query(sql, params);
  const credentialRows = credentialsResult.rows || [];

  if (credentialRows.length === 0) {
    console.log('No vendor_credentials matched the provided filters.');
    return;
  }

  const endDate = new Date();

  console.log(`Found ${credentialRows.length} credential(s) to process.`);
  console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  if (dryRun) {
    console.log('(dry-run) No scraping will be executed.');
  }
  console.log('');

  const results = [];
  let failureCount = 0;

  for (let index = 0; index < credentialRows.length; index++) {
    const row = credentialRows[index];
    const label = `${row.vendor}#${row.id}${row.nickname ? ` (${row.nickname})` : ''}`;

    console.log(`[${index + 1}/${credentialRows.length}] ${label}`);

    let beforeCount = null;
    let afterCount = null;

    try {
      beforeCount = await countTransactions({
        vendor: row.vendor,
        nickname: row.nickname || null,
        startDate,
      });

      if (dryRun) {
        const summary = {
          vendor: row.vendor,
          credentialId: row.id,
          nickname: row.nickname || null,
          startDate: startDate.toISOString(),
          dryRun: true,
          ok: true,
          insertedInRange: 0,
        };
        results.push(summary);
        console.log(`  Would scrape (transactions in range currently: ${beforeCount})`);
        continue;
      }

      const credentials = buildRunScrapeCredentials(row);

      const scrapeOptions = {
        companyId: row.vendor,
        startDate: startDate.toISOString(),
        combineInstallments: false,
        showBrowser,
        additionalTransactionInformation: true,
      };

      const scrapeResult = await scrapingService.runScrape({
        options: scrapeOptions,
        credentials,
        logger: console,
      });

      afterCount = await countTransactions({
        vendor: row.vendor,
        nickname: row.nickname || null,
        startDate,
      });

      const insertedInRange = Math.max(0, afterCount - beforeCount);

      const summary = {
        vendor: row.vendor,
        credentialId: row.id,
        nickname: row.nickname || null,
        ok: Boolean(scrapeResult?.success),
        message: scrapeResult?.message || null,
        insertedInRange,
        beforeCount,
        afterCount,
      };

      results.push(summary);

      console.log(`  Transactions in range: ${beforeCount} -> ${afterCount} (inserted: ${insertedInRange})`);
      if (!scrapeResult?.success) {
        failureCount += 1;
      }
    } catch (error) {
      failureCount += 1;
      const summary = {
        vendor: row.vendor,
        credentialId: row.id,
        nickname: row.nickname || null,
        ok: false,
        message: error?.message || 'Unknown error',
        insertedInRange: 0,
        beforeCount,
        afterCount,
      };
      results.push(summary);
      console.error(`  Failed: ${summary.message}`);
    }

    console.log('');
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ startDate: startDate.toISOString(), results }, null, 2));
  } else {
    const okCount = results.filter((r) => r.ok).length;
    const insertedTotal = results.reduce((sum, r) => sum + (r.insertedInRange || 0), 0);
    console.log(`Done. ok=${okCount}/${results.length}, failed=${failureCount}, insertedInRange=${insertedTotal}`);
  }

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await database.close();
    } catch (closeError) {
      // no-op
    }
  });
