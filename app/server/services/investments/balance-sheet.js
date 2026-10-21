const actualDatabase = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const {
  applyBankBalanceOverlapAdjustments,
  fetchActivePikadonOverlapSources,
} = require('./bank-balance-overlap.js');
const {
  CATEGORY_KEYS,
  normalizeInvestmentCategory,
} = require('./categories.js');
const fxService = require('./fx.js');
const { credentialIdMatchSql } = require('./credential-link.js');
const {
  getCreditCardRepaymentCategoryCondition,
} = require('../accounts/repayment-category.js');

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
    missingFxCount: 0,
    newestUpdateDate: null,
  };
}

function getBucketKey(account) {
  if (account.account_type === 'bank_balance') return 'cash';

  return normalizeInvestmentCategory(account.investment_category, account.account_type);
}

async function fetchPendingCreditCardDebt() {
  const hasSqliteBooleans = dialect.useSqlite;
  const activeValue = hasSqliteBooleans ? 1 : true;

  const vendorsResult = await database.query(
    `SELECT DISTINCT credit_card_vendor as vendor,
       credit_card_account_number, bank_vendor, bank_account_number, match_patterns
     FROM account_pairings
     WHERE is_active = $1`,
    [activeValue],
  );

  const pairings = (vendorsResult.rows || [])
    .filter((row) => typeof row.vendor === 'string' && row.vendor.trim().length > 0);
  const creditCardVendors = [...new Set(pairings.map((row) => row.vendor))];

  if (creditCardVendors.length === 0) {
    return {
      pendingDebt: null,
      status: 'no_pairings',
      lastRepaymentDate: null,
      creditCardVendorCount: 0,
    };
  }

  const repaymentCondition = getCreditCardRepaymentCategoryCondition('cd');
  const cards = new Map();
  for (const pairing of pairings) {
    const cardKey = JSON.stringify([pairing.vendor, pairing.credit_card_account_number || null]);
    const card = cards.get(cardKey) || { ...pairing, lastDate: null };
    cards.set(cardKey, card);

    let patterns;
    try {
      patterns = JSON.parse(pairing.match_patterns || '[]');
    } catch {
      patterns = [];
    }
    patterns = Array.isArray(patterns)
      ? patterns.filter((pattern) => typeof pattern === 'string' && pattern.trim())
      : [];
    if (!pairing.bank_vendor || patterns.length === 0) continue;

    const repaymentParams = [pairing.bank_vendor];
    const repaymentFilters = ['t.vendor = $1'];
    if (pairing.bank_account_number) {
      repaymentParams.push(pairing.bank_account_number);
      repaymentFilters.push(`t.account_number = $${repaymentParams.length}`);
    }
    const siblingCards = pairings.filter((other) => (
      other.vendor === pairing.vendor
      && other.bank_vendor === pairing.bank_vendor
      && (!other.bank_account_number || !pairing.bank_account_number
        || other.bank_account_number === pairing.bank_account_number)
      && (other.credit_card_account_number || null) !== (pairing.credit_card_account_number || null)
    ));
    if (siblingCards.length > 0) {
      // Auto-created patterns also contain the provider name. That alone cannot
      // identify which of several cards at the same bank was actually repaid.
      const last4 = String(pairing.credit_card_account_number || '').trim().slice(-4);
      if (!last4 || siblingCards.some((other) => (
        String(other.credit_card_account_number || '').trim().slice(-4) === last4
      ))) continue;
      repaymentParams.push(`%${last4.toLowerCase().replace(/[!%_]/g, '!$&')}%`);
      repaymentFilters.push(`LOWER(t.name) LIKE $${repaymentParams.length} ESCAPE '!'`);
    }
    const patternConditions = patterns.map((pattern) => {
      // Pairing patterns are literal substrings, including any % or _ characters.
      repaymentParams.push(`%${pattern.toLowerCase().replace(/[!%_]/g, '!$&')}%`);
      return `LOWER(t.name) LIKE $${repaymentParams.length} ESCAPE '!'`;
    });
    const lastRepaymentResult = await database.query(
      `SELECT MAX(t.date) as last_date
       FROM transactions t
       JOIN category_definitions cd ON t.category_definition_id = cd.id
       WHERE ${repaymentCondition}
         AND t.status = 'completed'
         AND t.price < 0
         AND ${repaymentFilters.join(' AND ')}
         AND (${patternConditions.join(' OR ')})`,
      repaymentParams,
    );
    card.lastDate = maxDate(card.lastDate, lastRepaymentResult.rows?.[0]?.last_date || null);
  }

  if ([...cards.values()].some((card) => !card.lastDate)) {
    return {
      pendingDebt: null,
      status: 'missing_repayment_baseline',
      lastRepaymentDate: null,
      creditCardVendorCount: creditCardVendors.length,
    };
  }

  const debtParams = [];
  const cardConditions = [...cards.values()].map((card) => {
    debtParams.push(card.vendor);
    const filters = [`vendor = $${debtParams.length}`];
    if (card.credit_card_account_number) {
      debtParams.push(card.credit_card_account_number);
      filters.push(`account_number = $${debtParams.length}`);
    }
    debtParams.push(card.lastDate instanceof Date
      ? card.lastDate.toISOString().slice(0, 10)
      : String(card.lastDate).slice(0, 10));
    filters.push(`substr(CAST(date AS TEXT), 1, 10) > $${debtParams.length}`);
    return `(${filters.join(' AND ')})`;
  });
  const pendingDebtResult = await database.query(
    `SELECT COALESCE(SUM(-price), 0) as pending_debt
     FROM transactions
     WHERE (${cardConditions.join(' OR ')})
       AND COALESCE(status, 'completed') IN ('completed', 'pending')`,
    debtParams,
  );

  const pendingDebt = toNumber(pendingDebtResult.rows?.[0]?.pending_debt) ?? 0;

  return {
    pendingDebt,
    status: 'ok',
    lastRepaymentDate: [...cards.values()].reduce((latest, card) => maxDate(latest, card.lastDate), null),
    creditCardVendorCount: creditCardVendors.length,
  };
}

/**
 * Unified balance sheet snapshot (tracked assets + pending card debt and
 * explicitly entered standalone liabilities). Real-estate simulator valuations
 * are stored as net equity when a mortgage balance is known, so those embedded
 * mortgages must not be entered again as standalone debt.
 */
async function getInvestmentBalanceSheet(query = {}) {
  const includeAccounts = coerceBoolean(query.includeAccounts);
  const includeManualLiabilities = coerceBoolean(query.includeLiabilities);
  const normalizeCurrencies = coerceBoolean(query.normalizeCurrencies);
  const booleanTrue = dialect.useSqlite ? 1 : true;
  // Match the complete numeric credential id; 1 must never match 10. Select one
  // credential so duplicate connections cannot multiply an investment account.
  const credentialMatch = credentialIdMatchSql('ia.notes', 'vc2.id');

  const accountsResult = await database.query(
    `
      WITH pikadon_balances AS (
        SELECT account_id,
          SUM(CASE WHEN COALESCE(status, 'active') = 'active'
            THEN COALESCE(current_value, cost_basis, 0) ELSE 0 END) AS current_value,
          COALESCE(MAX(CASE WHEN COALESCE(status, 'active') = 'active'
            THEN as_of_date END), MAX(as_of_date)) AS as_of_date
        FROM investment_holdings
        WHERE holding_type = 'pikadon'
        GROUP BY account_id
      )
      SELECT
        ia.id,
        ia.account_name,
        ia.account_type,
        ia.investment_category,
        ia.account_number,
        ia.notes,
        ia.institution_id,
        fi.vendor_code AS institution_vendor_code,
        ia.currency,
        CASE
          WHEN ia.account_type = 'bank_balance' AND vc.current_balance IS NOT NULL
          THEN vc.current_balance
          WHEN pb.account_id IS NOT NULL THEN pb.current_value
          ELSE ih.current_value
        END AS current_value,
        CASE
          WHEN ia.account_type = 'bank_balance' AND vc.balance_updated_at IS NOT NULL
          THEN vc.balance_updated_at
          WHEN pb.account_id IS NOT NULL THEN pb.as_of_date
          ELSE ih.as_of_date
        END AS as_of_date
      FROM investment_accounts ia
      LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
      LEFT JOIN vendor_credentials vc
        ON ia.account_type = 'bank_balance'
       AND vc.id = (
         SELECT vc2.id FROM vendor_credentials vc2
         WHERE ${credentialMatch}
           OR (
             COALESCE(ia.notes, '') NOT LIKE '%credential_id:%'
             AND ia.account_number IS NOT NULL
             AND fi.vendor_code = vc2.vendor
             AND ia.account_number = vc2.bank_account_number
           )
         ORDER BY vc2.balance_updated_at DESC, vc2.id DESC
         LIMIT 1
         )
      LEFT JOIN pikadon_balances pb ON pb.account_id = ia.id
      LEFT JOIN investment_holdings ih
        ON ih.id = (
          SELECT ih2.id
          FROM investment_holdings ih2
          WHERE ih2.account_id = ia.id
            AND COALESCE(ih2.holding_type, 'standard') <> 'pikadon'
            AND COALESCE(ih2.status, 'active') <> 'superseded'
          ORDER BY ih2.as_of_date DESC, ih2.id DESC
          LIMIT 1
        )
      WHERE ia.is_active = $1
      ORDER BY ia.investment_category, ia.account_type, ia.account_name
    `,
    [booleanTrue],
  );
  const savingsAccountIds = (accountsResult.rows || [])
    .filter((row) => row.account_type === 'savings')
    .map((row) => row.id);
  const hasBankBalanceAccounts = (accountsResult.rows || []).some(
    (row) => row.account_type === 'bank_balance',
  );
  const overlapSources = hasBankBalanceAccounts && savingsAccountIds.length > 0
    ? await fetchActivePikadonOverlapSources(database, savingsAccountIds)
    : [];
  const adjustedAccounts = applyBankBalanceOverlapAdjustments(
    accountsResult.rows || [],
    overlapSources,
  );

  let manualLiabilities = [];
  if (includeManualLiabilities) {
    const manualLiabilitiesResult = await database.query(
      `SELECT *
         FROM investment_liabilities
        WHERE is_active = $1
        ORDER BY as_of_date DESC, liability_name ASC`,
      [booleanTrue],
    );
    manualLiabilities = (manualLiabilitiesResult.rows || []).map((row) => ({
      ...row,
      id: Number(row.id),
      balance: toNumber(row.balance) ?? 0,
      interest_rate: toNumber(row.interest_rate),
      monthly_payment: toNumber(row.monthly_payment),
      included_in_net_worth: coerceBoolean(row.included_in_net_worth),
      is_active: coerceBoolean(row.is_active),
    }));
  }

  const valuedAccountEntries = adjustedAccounts
    .map((row) => ({
      amount: toNumber(row.current_value),
      currency: row.currency || 'ILS',
      date: row.as_of_date || new Date().toISOString().slice(0, 10),
    }))
    .filter((entry) => entry.amount !== null);
  const assetFxSummary = normalizeCurrencies
    ? await fxService.summarizeAmounts(valuedAccountEntries)
    : null;
  const convertedAccountValues = new Map();
  if (assetFxSummary) {
    let convertedIndex = 0;
    adjustedAccounts.forEach((row) => {
      if (toNumber(row.current_value) === null) return;
      convertedAccountValues.set(Number(row.id), assetFxSummary.conversions[convertedIndex]?.baseAmount ?? null);
      convertedIndex += 1;
    });
  }

  const buckets = CATEGORY_KEYS.reduce((accumulator, key) => {
    accumulator[key] = { ...createBucket(), accounts: includeAccounts ? [] : undefined };
    return accumulator;
  }, {});

  const currencyCounts = new Map();
  let newestAssetsUpdateDate = null;
  let totalAssets = 0;
  let missingValuationsCount = 0;

  adjustedAccounts.forEach((row) => {
    const bucketKey = getBucketKey(row);
    const bucket = buckets[bucketKey] || buckets.other;

    bucket.accountsCount += 1;

    const nativeValue = toNumber(row.current_value);
    const value = normalizeCurrencies
      ? (convertedAccountValues.get(Number(row.id)) ?? null)
      : nativeValue;
    if (nativeValue === null) {
      bucket.missingValueCount += 1;
      missingValuationsCount += 1;
    } else {
      bucket.accountsWithValue += 1;
      if (value !== null) {
        bucket.totalValue += value;
      } else if (normalizeCurrencies) {
        bucket.missingFxCount += 1;
      }
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
        nativeCurrentValue: nativeValue,
        asOfDate: row.as_of_date || null,
      });
    }
  });

  Object.values(buckets).forEach((bucket) => {
    const convertedSubtotal = bucket.totalValue;
    totalAssets += convertedSubtotal;
    if (normalizeCurrencies) {
      bucket.convertedSubtotal = convertedSubtotal;
      bucket.fxComplete = bucket.missingFxCount === 0;
      if (!bucket.fxComplete) bucket.totalValue = null;
    }
  });
  const assetsConvertedSubtotal = totalAssets;
  const assetsTotal = normalizeCurrencies && assetFxSummary?.complete !== true
    ? null
    : assetsConvertedSubtotal;

  const pendingDebtInfo = await fetchPendingCreditCardDebt();
  const pendingCreditCardDebt = pendingDebtInfo.pendingDebt;
  const includedManualLiabilities = manualLiabilities.filter((liability) => liability.included_in_net_worth);
  const liabilityFxSummary = normalizeCurrencies
    ? await fxService.summarizeAmounts(includedManualLiabilities.map((liability) => ({
        amount: liability.balance,
        currency: liability.currency || 'ILS',
        date: liability.as_of_date,
      })))
    : null;
  const manualLiabilityTotal = normalizeCurrencies
    ? liabilityFxSummary.baseTotal
    : includedManualLiabilities.length > 0
      ? includedManualLiabilities.reduce((sum, liability) => sum + liability.balance, 0)
      : 0;
  const manualLiabilityConvertedSubtotal = normalizeCurrencies
    ? liabilityFxSummary.convertedSubtotal
    : manualLiabilityTotal;
  const normalizedPendingDebt = pendingCreditCardDebt === null
    ? null
    : normalizeCurrencies
      ? (await fxService.convertAmount({
          amount: pendingCreditCardDebt,
          currency: 'ILS',
          date: new Date().toISOString().slice(0, 10),
        })).baseAmount
      : pendingCreditCardDebt;
  const totalLiabilities = normalizedPendingDebt === null || manualLiabilityTotal === null
    ? null
    : normalizedPendingDebt + manualLiabilityTotal;
  const liabilitiesConvertedSubtotal = (normalizedPendingDebt ?? 0)
    + manualLiabilityConvertedSubtotal;
  const fxComplete = !normalizeCurrencies
    || (assetFxSummary?.complete === true && liabilityFxSummary?.complete !== false);
  const netWorth = assetsTotal === null
    || totalLiabilities === null
    || !fxComplete
    || missingValuationsCount > 0
    ? null
    : assetsTotal - totalLiabilities;

  return {
    generatedAt: new Date().toISOString(),
    assets: {
      total: assetsTotal,
      convertedSubtotal: normalizeCurrencies ? assetsConvertedSubtotal : undefined,
      newestUpdateDate: newestAssetsUpdateDate,
      buckets: {
        cash: buckets.cash,
        liquid: buckets.liquid,
        illiquid: buckets.illiquid,
        restricted: buckets.restricted,
        stability: buckets.stability,
        other: buckets.other,
      },
      currencies: {
        distinct: Array.from(currencyCounts.keys()).sort(),
        hasMultiple: currencyCounts.size > 1,
      },
      nativeTotals: assetFxSummary?.nativeTotals,
    },
    liabilities: {
      pendingCreditCardDebt,
      pendingCreditCardDebtStatus: pendingDebtInfo.status,
      lastCreditCardRepaymentDate: pendingDebtInfo.lastRepaymentDate,
      creditCardVendorCount: pendingDebtInfo.creditCardVendorCount,
      manual: manualLiabilities,
      manualTotal: manualLiabilityTotal,
      total: totalLiabilities,
      convertedSubtotal: normalizeCurrencies ? liabilitiesConvertedSubtotal : undefined,
      nativeTotals: liabilityFxSummary?.nativeTotals,
    },
    netWorth,
    netWorthStatus: netWorth === null ? 'partial' : 'ok',
    missingValuationsCount,
    baseCurrency: assetFxSummary?.baseCurrency || liabilityFxSummary?.baseCurrency || 'ILS',
    fx: normalizeCurrencies
      ? {
          complete: fxComplete,
          missingCount: (assetFxSummary?.missing.length || 0) + (liabilityFxSummary?.missing.length || 0),
          convertedSubtotal: assetsConvertedSubtotal,
          assets: {
            complete: assetFxSummary?.complete === true,
            missingCount: assetFxSummary?.missing.length || 0,
            convertedSubtotal: assetsConvertedSubtotal,
            nativeTotals: assetFxSummary?.nativeTotals || [],
          },
          liabilities: {
            complete: liabilityFxSummary?.complete !== false,
            missingCount: liabilityFxSummary?.missing.length || 0,
            convertedSubtotal: manualLiabilityConvertedSubtotal,
            nativeTotals: liabilityFxSummary?.nativeTotals || [],
          },
        }
      : undefined,
  };
}

module.exports = {
  getInvestmentBalanceSheet,
  __setDatabase(mock) {
    database = mock || actualDatabase;
    fxService.__setDatabase(database);
  },
  __resetDatabase() {
    database = actualDatabase;
    fxService.__resetDatabase();
  },
};
module.exports.default = module.exports;
