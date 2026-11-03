/**
 * Coarse, non-identifying facts for the opt-in daily usage snapshot.
 *
 * Returns only counts and the earliest activity timestamp; the Electron shell
 * turns these into buckets ("2to3", "30to90d") before anything is sent.
 * No amounts, names, vendors or account data are read into the result.
 */
const actualDatabase = require('./database.js');

let database = actualDatabase;

async function countRows(sql) {
  try {
    const result = await database.query(sql);
    return Number(result?.rows?.[0]?.count) || 0;
  } catch {
    // Table may not exist on older schemas.
    return 0;
  }
}

function toEpochMs(value) {
  if (!value) return null;
  const normalized = /\dT\d|Z$/.test(String(value)) ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

async function earliestTimestamp(sql) {
  try {
    const result = await database.query(sql);
    return toEpochMs(result?.rows?.[0]?.earliest);
  } catch {
    return null;
  }
}

async function collectUsageSnapshotFacts() {
  const [institutions, properties, budgets, goals, firstCredentialAt, firstScrapeAt] = await Promise.all([
    countRows('SELECT COUNT(*) AS count FROM vendor_credentials'),
    countRows('SELECT COUNT(*) AS count FROM real_estate_properties'),
    countRows('SELECT COUNT(*) AS count FROM category_budgets WHERE is_active = 1'),
    countRows('SELECT COUNT(*) AS count FROM savings_goals'),
    earliestTimestamp('SELECT MIN(created_at) AS earliest FROM vendor_credentials'),
    earliestTimestamp('SELECT MIN(created_at) AS earliest FROM scrape_events'),
  ]);

  const candidates = [firstCredentialAt, firstScrapeAt].filter((value) => value !== null);
  return {
    institutionCount: institutions,
    hasProperty: properties > 0,
    hasBudgets: budgets > 0,
    hasGoals: goals > 0,
    firstActivityAt: candidates.length > 0 ? Math.min(...candidates) : null,
  };
}

module.exports = {
  collectUsageSnapshotFacts,
  __setDatabaseForTests(dbOverride = null) {
    database = dbOverride || actualDatabase;
  },
};
