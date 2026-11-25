/**
 * Statement import: land rows from a bank / card statement file (parsed and
 * column-mapped in the renderer) in the same ledger as scraped transactions.
 *
 * The importer is the fallback for when a scraper breaks, so it must not
 * double-count the period the scraper already covered. A statement row and a
 * scraped row for the same charge rarely share processed dates or names, so
 * the scraper's own duplicate check would miss them. Instead, preview pairs
 * each file row one-to-one with an existing row on the same account with the
 * same amount within one Israel calendar day, and commit only inserts the rows
 * left over (plus any duplicates the user explicitly ticks, e.g. two identical
 * coffees on the same day).
 *
 * Rows go through the scraper's insertTransaction, categorization rules and
 * card-bill pairing, under the scrape lock.
 */

const crypto = require('crypto');
const baseDatabase = require('./database.js');
const scrapingService = require('./scraping/run.js');
const { clearAllTtlCaches } = require('../../lib/server/ttl-cache.js');
const { ALL_VENDORS } = require('../../utils/constants.js');

const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';
const MAX_ROWS = 5000;
const MAX_TEXT_LENGTH = 300;
const MIN_YEAR = 2000;
const FUTURE_DAYS_ALLOWED = 45;
const AMOUNT_EPSILON = 0.005;
const MATCH_WINDOW_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const INSTALLMENT_PATTERN = /(?:תשלום|payment|installment)\s*(\d{1,2})\s*(?:מתוך|מ-|of|\/)\s*(\d{1,2})/i;

const defaultDeps = {
  database: baseDatabase,
  ledger: scrapingService.ledgerIngestion,
  runExclusive: (work) => scrapingService.runExclusiveWithScrapes(work),
  clearCaches: clearAllTtlCaches,
  now: () => Date.now(),
};

let deps = { ...defaultDeps };

const israelDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const israelPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISRAEL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function importError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, utc };
}

function israelOffsetMs(instantMs) {
  const parts = Object.create(null);
  for (const part of israelPartsFormatter.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallClockAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Israel-local midnight of a calendar day as a UTC ISO string, the same shape
 * the scrapers store (20 Mar 2026 -> 2026-03-19T22:00:00.000Z). Israel's DST
 * switches at 02:00, so midnight is never ambiguous.
 */
function israelMidnightIso(ymd) {
  const parsed = parseYmd(ymd);
  if (!parsed) return null;
  let instant = parsed.utc - israelOffsetMs(parsed.utc);
  instant = parsed.utc - israelOffsetMs(instant);
  return new Date(instant).toISOString();
}

function israelDayKey(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return null;
  return israelDayFormatter.format(date);
}

function dayDistance(leftYmd, rightYmd) {
  const left = parseYmd(leftYmd);
  const right = parseYmd(rightYmd);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.abs(left.utc - right.utc) / DAY_MS;
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function normalizeCurrency(value) {
  const text = cleanText(value).toUpperCase();
  if (!text) return null;
  if (['₪', 'ש"ח', 'ש״ח', 'שח', 'NIS', 'ILS'].includes(text)) return 'ILS';
  if (text === '$' || text === 'דולר') return 'USD';
  if (text === '€' || text === 'יורו') return 'EUR';
  if (text === '£') return 'GBP';
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

function roundAgorot(value) {
  return Math.round(value * 100) / 100;
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw importError(400, 'no_rows', 'The file has no transactions to import');
  }
  if (rows.length > MAX_ROWS) {
    throw importError(400, 'too_many_rows', `A statement can have at most ${MAX_ROWS} rows`);
  }

  const latestAllowed = deps.now() + FUTURE_DAYS_ALLOWED * DAY_MS;
  const valid = [];
  const invalid = [];

  rows.forEach((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw : {};
    const date = parseYmd(row.date);
    if (!date) {
      invalid.push({ index, reason: 'invalid_date' });
      return;
    }
    if (date.year < MIN_YEAR || date.utc > latestAllowed) {
      invalid.push({ index, reason: 'date_out_of_range' });
      return;
    }
    const processedDate = row.processedDate ? parseYmd(row.processedDate) : null;
    if (row.processedDate && !processedDate) {
      invalid.push({ index, reason: 'invalid_date' });
      return;
    }
    const description = cleanText(row.description);
    if (!description) {
      invalid.push({ index, reason: 'missing_description' });
      return;
    }
    const amount = typeof row.amount === 'number' ? row.amount : Number.NaN;
    if (!Number.isFinite(amount) || Math.abs(amount) > 1e9) {
      invalid.push({ index, reason: 'invalid_amount' });
      return;
    }
    if (Math.abs(amount) < AMOUNT_EPSILON) {
      invalid.push({ index, reason: 'zero_amount' });
      return;
    }
    const originalAmount = typeof row.originalAmount === 'number' && Number.isFinite(row.originalAmount)
      ? roundAgorot(row.originalAmount)
      : null;

    valid.push({
      index,
      date: row.date,
      processedDate: processedDate ? row.processedDate : null,
      description,
      amount: roundAgorot(amount),
      originalAmount,
      originalCurrency: normalizeCurrency(row.originalCurrency),
      memo: cleanText(row.memo) || null,
    });
  });

  return { valid, invalid };
}

function splitAccountNumbers(value) {
  return String(value || '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function loadTarget(credentialId, requestedAccountNumber) {
  const { database, ledger } = deps;
  const result = await database.query(
    `SELECT id, vendor, nickname, bank_account_number, card6_digits
       FROM vendor_credentials
      WHERE id = $1`,
    [credentialId],
  );
  const credential = result?.rows?.[0];
  if (!credential) {
    throw importError(404, 'credential_not_found', 'Account not found');
  }
  if (!ALL_VENDORS.includes(credential.vendor)) {
    throw importError(400, 'unsupported_account', 'Statements can only be imported into bank and card accounts');
  }

  const isBank = ledger.isBankVendor(credential.vendor);
  const usedNumbers = await database.query(
    `SELECT account_number, COUNT(*) AS row_count
       FROM transactions
      WHERE vendor = $1
        AND vendor_nickname IS $2
        AND account_number IS NOT NULL
        AND account_number <> ''
      GROUP BY account_number
      ORDER BY row_count DESC, account_number`,
    [credential.vendor, credential.nickname ?? null],
  );

  const options = [];
  for (const row of usedNumbers?.rows || []) {
    if (!options.includes(row.account_number)) options.push(row.account_number);
  }
  for (const number of splitAccountNumbers(isBank ? credential.bank_account_number : credential.card6_digits)) {
    if (!options.includes(number)) options.push(number);
  }

  let accountNumber = options[0] ?? null;
  if (requestedAccountNumber !== undefined && requestedAccountNumber !== null && requestedAccountNumber !== '') {
    const requested = String(requestedAccountNumber);
    if (!options.includes(requested)) {
      throw importError(400, 'unknown_account_number', 'Pick one of this account\'s numbers');
    }
    accountNumber = requested;
  }

  return {
    credentialId: credential.id,
    vendor: credential.vendor,
    nickname: credential.nickname ?? null,
    isBank,
    accountNumber,
    accountNumberOptions: options,
  };
}

async function loadExistingRows(target, validRows) {
  const dates = validRows.map((row) => row.date).sort();
  const from = new Date(new Date(israelMidnightIso(dates[0])).getTime() - 2 * DAY_MS).toISOString();
  const to = new Date(new Date(israelMidnightIso(dates[dates.length - 1])).getTime() + 3 * DAY_MS).toISOString();

  const accountFilter = target.accountNumber
    ? { sql: 'account_number = $2', value: target.accountNumber }
    : { sql: 'vendor_nickname IS $2', value: target.nickname };

  const result = await deps.database.query(
    `SELECT identifier, date, name, price, status
       FROM transactions
      WHERE vendor = $1
        AND ${accountFilter.sql}
        AND date >= $3
        AND date < $4`,
    [target.vendor, accountFilter.value, from, to],
  );
  return (result?.rows || []).map((row) => ({
    identifier: row.identifier,
    name: row.name,
    price: Number(row.price),
    status: row.status,
    dayKey: israelDayKey(row.date),
  }));
}

function matchDuplicates(validRows, existingRows) {
  const nameScore = deps.ledger.getNameMatchScore;
  const claimed = new Set();
  const matches = new Map();
  const ordered = [...validRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index));

  for (const row of ordered) {
    let best = null;
    for (let i = 0; i < existingRows.length; i += 1) {
      if (claimed.has(i)) continue;
      const existing = existingRows[i];
      if (!Number.isFinite(existing.price) || Math.abs(existing.price - row.amount) >= AMOUNT_EPSILON) continue;
      const distance = dayDistance(row.date, existing.dayKey);
      if (distance > MATCH_WINDOW_DAYS) continue;
      const score = nameScore(row.description, existing.name);
      if (!best || distance < best.distance || (distance === best.distance && score > best.score)) {
        best = { i, distance, score };
      }
    }
    if (best) {
      claimed.add(best.i);
      const existing = existingRows[best.i];
      matches.set(row.index, {
        identifier: existing.identifier,
        date: existing.dayKey,
        name: existing.name,
        status: existing.status,
      });
    }
  }
  return matches;
}

async function buildPreview({ credentialId, accountNumber, rows }) {
  const target = await loadTarget(credentialId, accountNumber);
  const { valid, invalid } = validateRows(rows);
  const existingRows = valid.length > 0 ? await loadExistingRows(target, valid) : [];
  const matches = matchDuplicates(valid, existingRows);

  const statusByIndex = new Map();
  for (const entry of invalid) {
    statusByIndex.set(entry.index, { index: entry.index, status: 'invalid', reason: entry.reason });
  }
  const matchedIdentifiers = new Set();
  for (const row of valid) {
    const match = matches.get(row.index);
    if (match) {
      matchedIdentifiers.add(match.identifier);
      statusByIndex.set(row.index, {
        index: row.index,
        status: 'duplicate',
        match: { date: match.date, name: match.name, status: match.status },
      });
    } else {
      statusByIndex.set(row.index, { index: row.index, status: 'new' });
    }
  }

  const sortedDates = valid.map((row) => row.date).sort();
  const previewRows = rows.map((_, index) => statusByIndex.get(index));
  return {
    target,
    valid,
    matchedIdentifiers,
    rows: previewRows,
    summary: {
      total: rows.length,
      new: previewRows.filter((row) => row.status === 'new').length,
      duplicates: previewRows.filter((row) => row.status === 'duplicate').length,
      invalid: invalid.length,
      firstDate: sortedDates[0] ?? null,
      lastDate: sortedDates[sortedDates.length - 1] ?? null,
    },
  };
}

function publicTarget(target) {
  return {
    vendor: target.vendor,
    nickname: target.nickname,
    isBank: target.isBank,
    accountNumber: target.accountNumber,
    accountNumberOptions: target.accountNumberOptions,
  };
}

async function previewStatementImport(params) {
  const preview = await buildPreview(params);
  return { target: publicTarget(preview.target), summary: preview.summary, rows: preview.rows };
}

function toScraperTransaction(row, target, occurrence) {
  const installment = INSTALLMENT_PATTERN.exec(`${row.memo || ''} ${row.description}`);
  const fingerprint = [
    target.vendor,
    target.accountNumber ?? target.nickname ?? '',
    row.date,
    row.amount.toFixed(2),
    row.description,
    occurrence,
  ].join('|');

  return {
    // A stable identifier makes re-importing the same file a no-op.
    identifier: `stmt-${crypto.createHash('sha1').update(fingerprint).digest('hex')}`,
    type: installment ? 'installments' : 'normal',
    date: israelMidnightIso(row.date),
    processedDate: israelMidnightIso(row.processedDate || row.date),
    originalAmount: row.originalAmount ?? row.amount,
    originalCurrency: row.originalCurrency || 'ILS',
    chargedAmount: row.amount,
    chargedCurrency: 'ILS',
    description: row.description,
    // Installment plans are read from "תשלום N מתוך M" in the memo.
    memo: installment ? `תשלום ${installment[1]} מתוך ${installment[2]}` : row.memo,
    status: 'completed',
  };
}

async function countTargetRows(client, target) {
  const accountFilter = target.accountNumber
    ? { sql: 'account_number = $2', value: target.accountNumber }
    : { sql: 'vendor_nickname IS $2', value: target.nickname };
  const result = await client.query(
    `SELECT COUNT(*) AS row_count FROM transactions WHERE vendor = $1 AND ${accountFilter.sql}`,
    [target.vendor, accountFilter.value],
  );
  return Number(result?.rows?.[0]?.row_count ?? 0);
}

async function commitStatementImport({ credentialId, accountNumber, rows, includeDuplicateIndexes = [] }) {
  const forced = new Set(
    (Array.isArray(includeDuplicateIndexes) ? includeDuplicateIndexes : [])
      .filter((value) => Number.isInteger(value) && value >= 0),
  );

  return deps.runExclusive(async () => {
    // Re-check against the ledger inside the lock: a sync may have landed
    // rows since the preview, and statuses from the client are not trusted.
    const preview = await buildPreview({ credentialId, accountNumber, rows });
    const { target } = preview;
    const statusByIndex = new Map(preview.rows.map((row) => [row.index, row.status]));
    const toInsert = preview.valid.filter((row) => {
      const status = statusByIndex.get(row.index);
      return status === 'new' || (status === 'duplicate' && forced.has(row.index));
    });

    const result = {
      target: publicTarget(target),
      requested: toInsert.length,
      inserted: 0,
      skippedDuplicates: preview.summary.duplicates - toInsert.filter((row) => statusByIndex.get(row.index) === 'duplicate').length,
      invalid: preview.summary.invalid,
    };
    if (toInsert.length === 0) {
      return result;
    }

    const occurrences = new Map();
    const transactions = toInsert.map((row) => {
      const key = `${row.date}|${row.amount}|${row.description}`;
      const occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      return toScraperTransaction(row, target, occurrence);
    });

    const { ledger } = deps;
    const client = await deps.database.getClient();
    let transactionActive = false;
    try {
      await client.query('BEGIN IMMEDIATE');
      transactionActive = true;
      const before = await countTargetRows(client, target);
      const batchContext = ledger.createScrapeBatchContext(transactions, target.vendor, target.isBank);
      // Every stored row the preview paired with a file row is spoken for: a
      // skipped duplicate owns it, and a ticked duplicate is a separate charge.
      // Without this the scraper's same-day check would fold the second of two
      // identical charges into the first.
      for (const identifier of preview.matchedIdentifiers) {
        batchContext.claimedIdentifiers.add(identifier);
      }
      for (const txn of transactions) {
        await ledger.insertTransaction(
          txn,
          client,
          target.vendor,
          target.isBank,
          target.accountNumber,
          target.nickname,
          batchContext,
        );
      }
      await ledger.applyCategorizationRules(client);
      await ledger.applyAccountPairings(client);
      const after = await countTargetRows(client, target);
      await client.query('COMMIT');
      transactionActive = false;
      result.inserted = Math.max(0, after - before);
    } catch (error) {
      if (transactionActive) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Keep the original error.
        }
      }
      throw error;
    } finally {
      client.release?.();
    }

    deps.clearCaches();
    return result;
  });
}

module.exports = {
  previewStatementImport,
  commitStatementImport,
  israelMidnightIso,
  MAX_ROWS,
  __setDependencies(overrides = {}) {
    deps = { ...deps, ...overrides };
  },
  __resetDependencies() {
    deps = { ...defaultDeps };
  },
};
module.exports.default = module.exports;
