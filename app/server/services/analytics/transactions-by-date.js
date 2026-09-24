const database = require('../database.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

const transactionsByDateCache = createTtlCache({ maxEntries: 60, defaultTtlMs: 30 * 1000 });

const PAIRING_EXCLUSION = `
  LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
    ON t.identifier = tpe.transaction_identifier
    AND t.vendor = tpe.transaction_vendor
`;

function invalidRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(value)) {
    throw invalidRequest(`${field} must be a valid date`);
  }
  const date = value.split('T')[0];
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    || (value.includes('T') && !Number.isFinite(Date.parse(value)))) {
    throw invalidRequest(`${field} must be a valid date`);
  }
  return date;
}

async function listTransactionsByDate(params = {}) {
  const hasRange = params.startDate != null || params.endDate != null;
  if (hasRange && (params.startDate == null || params.endDate == null)) {
    throw invalidRequest('Both startDate and endDate are required');
  }
  if (!hasRange && !params.date) {
    throw invalidRequest('Date parameter or startDate and endDate are required');
  }
  const startDate = normalizeDate(hasRange ? params.startDate : params.date, hasRange ? 'startDate' : 'date');
  const endDate = normalizeDate(hasRange ? params.endDate : params.date, hasRange ? 'endDate' : 'date');
  if (startDate > endDate) throw invalidRequest('startDate must not be after endDate');
  const nextDay = new Date(`${endDate}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const exclusiveEndDate = nextDay.toISOString().slice(0, 10);
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    params.noCache === true ||
    params.noCache === 'true' ||
    params.noCache === '1';
  const cacheKey = `range:${startDate}:${endDate}`;
  if (!skipCache) {
    const cached = transactionsByDateCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const result = await database.query(
    `
      SELECT
        t.identifier,
        t.vendor,
        t.price,
        t.name AS description,
        t.date,
        t.memo,
        t.tags,
        cd_child.name AS category_name,
        cd_child.icon AS category_icon,
        cd_child.color AS category_color,
        cd_parent.name AS parent_name,
        cd_parent.category_type
      FROM transactions t
      LEFT JOIN category_definitions cd_child ON t.category_definition_id = cd_child.id
      LEFT JOIN category_definitions cd_parent ON cd_child.parent_id = cd_parent.id
      ${PAIRING_EXCLUSION}
      WHERE t.date >= $1
        AND t.date < $2
        AND tpe.transaction_identifier IS NULL
      ORDER BY t.price DESC
    `,
    [startDate, exclusiveEndDate],
  );

  const transactions = result.rows.map((row) => {
    let parsedTags = [];
    if (row.tags) {
      try {
        const maybeTags = JSON.parse(row.tags);
        if (Array.isArray(maybeTags)) {
          parsedTags = maybeTags;
        }
      } catch {
        parsedTags = [];
      }
    }

    return {
      identifier: row.identifier,
      vendor: row.vendor,
      price: Number.parseFloat(row.price),
      description: row.description,
      date: row.date,
      memo: row.memo || null,
      tags: parsedTags,
      categoryType: row.category_type,
      category_name: row.category_name,
      category_icon: row.category_icon || null,
      category_color: row.category_color || null,
      parent_name: row.parent_name,
    };
  });

  const response = { transactions };
  if (!skipCache) {
    transactionsByDateCache.set(cacheKey, response);
  }
  return response;
}

module.exports = {
  listTransactionsByDate,
};

module.exports.default = module.exports;
