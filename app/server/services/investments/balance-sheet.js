const actualDatabase = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');

let database = actualDatabase;

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return false;
}

function compareDates(dateA, dateB) {
  if (!dateA && !dateB) return 0;
  if (!dateA) return -1;
  if (!dateB) return 1;

  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
  if (!Number.isFinite(a)) return -1;
  if (!Number.isFinite(b)) return 1;
  return a - b;
}

function maxDate(dateA, dateB) {
  return compareDates(dateA, dateB) >= 0 ? dateA : dateB;
}

function createBucket() {
  return {
    totalValue: 0,
    accountsCount: 0,
    accountsWithValue: 0,
    missingValueCount: 0,
    newestUpdateDate: null,
  };
}

function getBucketKey(account) {
  if (account.account_type === 'bank_balance') return 'cash';

  const category = typeof account.investment_category === 'string' ? account.investment_category : null;
  if (category === 'cash') return 'cash';
  if (category === 'liquid') return 'liquid';
  if (category === 'restricted') return 'restricted';
  if (category === 'stability') return 'stability';

  return 'other';
}

async function fetchPendingCreditCardDebt() {
  const hasSqliteBooleans = dialect.useSqlite;
  const activeValue = hasSqliteBooleans ? 1 : true;

  const vendorsResult = await database.query(
    `SELECT DISTINCT credit_card_vendor as vendor
     FROM account_pairings
     WHERE is_active = $1`,
    [activeValue],
  );

  const creditCardVendors = (vendorsResult.rows || [])
    .map((row) => row.vendor)
    .filter((vendor) => typeof vendor === 'string' && vendor.trim().length > 0);

  if (creditCardVendors.length === 0) {
    return {
      pendingDebt: null,
      status: 'no_pairings',
      lastRepaymentDate: null,
      creditCardVendorCount: 0,
    };
  }

  const lastRepaymentResult = await database.query(
    `SELECT MAX(t.date) as last_date
     FROM transactions t
     JOIN category_definitions cd ON t.category_definition_id = cd.id
     WHERE cd.name = 'פרעון כרטיס אשראי'
       AND t.status = 'completed'`,
    [],
  );

  const lastRepaymentDate = lastRepaymentResult.rows?.[0]?.last_date || null;
  if (!lastRepaymentDate) {
    return {
      pendingDebt: null,
      status: 'missing_repayment_baseline',
      lastRepaymentDate: null,
      creditCardVendorCount: creditCardVendors.length,
    };
  }

  const placeholders = creditCardVendors.map((_, idx) => `$${idx + 1}`).join(', ');
  const lastDatePlaceholder = `$${creditCardVendors.length + 1}`;
  const pendingDebtResult = await database.query(
    `SELECT COALESCE(SUM(ABS(price)), 0) as pending_debt
     FROM transactions
     WHERE vendor IN (${placeholders})
       AND price < 0
       AND date > ${lastDatePlaceholder}`,
    [...creditCardVendors, lastRepaymentDate],
  );

  const pendingDebt = toNumber(pendingDebtResult.rows?.[0]?.pending_debt) ?? 0;

  return {
    pendingDebt,
    status: 'ok',
    lastRepaymentDate,
    creditCardVendorCount: creditCardVendors.length,
  };
}

/**
 * Unified balance sheet snapshot (tracked assets + limited liabilities).
 * Note: loan/mortgage liabilities are not modeled yet; this only includes pending CC debt (when available).
 */
async function getInvestmentBalanceSheet(query = {}) {
  const includeAccounts = coerceBoolean(query.includeAccounts);
  const booleanTrue = dialect.useSqlite ? 1 : true;

  const accountsResult = await database.query(
    `
      SELECT
        ia.id,
        ia.account_name,
        ia.account_type,
        ia.investment_category,
        ia.currency,
        ih.current_value,
        ih.as_of_date
      FROM investment_accounts ia
      LEFT JOIN investment_holdings ih
        ON ih.id = (
          SELECT ih2.id
          FROM investment_holdings ih2
          WHERE ih2.account_id = ia.id
          ORDER BY ih2.as_of_date DESC
          LIMIT 1
        )
      WHERE ia.is_active = $1
      ORDER BY ia.investment_category, ia.account_type, ia.account_name
    `,
    [booleanTrue],
  );

  const buckets = {
    cash: { ...createBucket(), accounts: includeAccounts ? [] : undefined },
    liquid: { ...createBucket(), accounts: includeAccounts ? [] : undefined },
    restricted: { ...createBucket(), accounts: includeAccounts ? [] : undefined },
    stability: { ...createBucket(), accounts: includeAccounts ? [] : undefined },
    other: { ...createBucket(), accounts: includeAccounts ? [] : undefined },
  };

  const currencyCounts = new Map();
  let newestAssetsUpdateDate = null;
  let totalAssets = 0;
  let missingValuationsCount = 0;

  (accountsResult.rows || []).forEach((row) => {
    const bucketKey = getBucketKey(row);
    const bucket = buckets[bucketKey] || buckets.other;

    bucket.accountsCount += 1;

    const value = toNumber(row.current_value);
    if (value === null) {
      bucket.missingValueCount += 1;
      missingValuationsCount += 1;
    } else {
      bucket.totalValue += value;
      bucket.accountsWithValue += 1;
    }

    if (row.as_of_date) {
      bucket.newestUpdateDate = maxDate(bucket.newestUpdateDate, row.as_of_date);
      newestAssetsUpdateDate = maxDate(newestAssetsUpdateDate, row.as_of_date);
    }

    const currency = typeof row.currency === 'string' ? row.currency : null;
    if (currency) {
      currencyCounts.set(currency, (currencyCounts.get(currency) || 0) + 1);
    }

    if (includeAccounts) {
      bucket.accounts.push({
        id: row.id,
        accountName: row.account_name,
        accountType: row.account_type,
        investmentCategory: row.investment_category,
        currency,
        currentValue: value,
        asOfDate: row.as_of_date || null,
      });
    }
  });

  Object.values(buckets).forEach((bucket) => {
    totalAssets += bucket.totalValue || 0;
  });

  const pendingDebtInfo = await fetchPendingCreditCardDebt();
  const pendingCreditCardDebt = pendingDebtInfo.pendingDebt;

  const netWorth = pendingCreditCardDebt === null ? null : totalAssets - pendingCreditCardDebt;

  return {
    generatedAt: new Date().toISOString(),
    assets: {
      total: totalAssets,
      newestUpdateDate: newestAssetsUpdateDate,
      buckets: {
        cash: buckets.cash,
        liquid: buckets.liquid,
        restricted: buckets.restricted,
        stability: buckets.stability,
        other: buckets.other,
      },
      currencies: {
        distinct: Array.from(currencyCounts.keys()).sort(),
        hasMultiple: currencyCounts.size > 1,
      },
    },
    liabilities: {
      pendingCreditCardDebt,
      pendingCreditCardDebtStatus: pendingDebtInfo.status,
      lastCreditCardRepaymentDate: pendingDebtInfo.lastRepaymentDate,
      creditCardVendorCount: pendingDebtInfo.creditCardVendorCount,
    },
    netWorth,
    netWorthStatus: netWorth === null ? 'partial' : 'ok',
    missingValuationsCount,
  };
}

module.exports = {
  getInvestmentBalanceSheet,
  __setDatabase(mock) {
    database = mock || actualDatabase;
  },
  __resetDatabase() {
    database = actualDatabase;
  },
};
module.exports.default = module.exports;

