const actualDatabase = require('../database.js');
let database = actualDatabase;
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  getInstitutionByVendorCode,
} = require('../institutions.js');
const { dialect } = require('../../../lib/sql-dialect.js');
const {
  applyContributionRollforward,
  fetchLinkedInvestmentTransactions,
} = require('./linked-transaction-rollforward.js');
const {
  toNumber,
} = require('./account-holdings-rollup.js');
const {
  fetchAccountHoldingSnapshots,
} = require('./account-snapshots.js');
const {
  applyBankBalanceOverlapAdjustments,
  fetchActivePikadonOverlapSources,
} = require('./bank-balance-overlap.js');
const {
  CATEGORY_KEYS,
  normalizeInvestmentCategory,
} = require('./categories.js');
const fxService = require('./fx.js');

let dateFnsPromise = null;

function coerceBoolean(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

async function normalizeAccountCurrencies(accounts, enabled) {
  if (!enabled) return { accounts, fx: null };

  const valuationEntries = [];
  const costEntries = [];
  const valuationIndexes = [];
  const costIndexes = [];
  accounts.forEach((account, index) => {
    const date = account.as_of_date || new Date().toISOString().slice(0, 10);
    const currentValue = toNumber(account.current_value);
    const costBasis = toNumber(account.cost_basis);
    if (currentValue !== null) {
      valuationIndexes.push(index);
      valuationEntries.push({ amount: currentValue, currency: account.currency || 'ILS', date });
    }
    if (costBasis !== null) {
      costIndexes.push(index);
      costEntries.push({ amount: costBasis, currency: account.currency || 'ILS', date });
    }
  });

  const [valuationSummary, costSummary] = await Promise.all([
    fxService.summarizeAmounts(valuationEntries),
    fxService.summarizeAmounts(costEntries),
  ]);
  const valuationByIndex = new Map();
  valuationIndexes.forEach((accountIndex, conversionIndex) => {
    valuationByIndex.set(accountIndex, valuationSummary.conversions[conversionIndex]);
  });
  const costByIndex = new Map();
  costIndexes.forEach((accountIndex, conversionIndex) => {
    costByIndex.set(accountIndex, costSummary.conversions[conversionIndex]);
  });

  return {
    accounts: accounts.map((account, index) => ({
      ...account,
      native_currency: account.currency || 'ILS',
      native_current_value: toNumber(account.current_value),
      native_cost_basis: toNumber(account.cost_basis),
      current_value: valuationByIndex.has(index)
        ? valuationByIndex.get(index).baseAmount
        : null,
      cost_basis: costByIndex.has(index)
        ? costByIndex.get(index).baseAmount
        : null,
      base_currency: valuationSummary.baseCurrency,
      fx_status: valuationByIndex.get(index)?.status || null,
      fx_rate: valuationByIndex.get(index)?.rate || null,
      fx_rate_date: valuationByIndex.get(index)?.rateDate || null,
      cost_basis_fx_status: costByIndex.get(index)?.status || null,
      cost_basis_fx_rate: costByIndex.get(index)?.rate || null,
      cost_basis_fx_rate_date: costByIndex.get(index)?.rateDate || null,
    })),
    fx: {
      baseCurrency: valuationSummary.baseCurrency,
      complete: valuationSummary.complete && costSummary.complete,
      valuationComplete: valuationSummary.complete,
      costBasisComplete: costSummary.complete,
      missingCount: valuationSummary.missing.length + costSummary.missing.length,
      nativeTotals: valuationSummary.nativeTotals,
      convertedSubtotal: valuationSummary.convertedSubtotal,
      costBasisNativeTotals: costSummary.nativeTotals,
      costBasisConvertedSubtotal: costSummary.convertedSubtotal,
      valuation: {
        complete: valuationSummary.complete,
        missingCount: valuationSummary.missing.length,
        nativeTotals: valuationSummary.nativeTotals,
        convertedSubtotal: valuationSummary.convertedSubtotal,
      },
      costBasis: {
        complete: costSummary.complete,
        missingCount: costSummary.missing.length,
        nativeTotals: costSummary.nativeTotals,
        convertedSubtotal: costSummary.convertedSubtotal,
      },
    },
  };
}

const ACCOUNT_TYPE_LABELS = {
  pension: { name: 'Pension Fund', name_he: 'קרן פנסיה', category: 'restricted' },
  provident: { name: 'Provident Fund', name_he: 'קרן השתלמות', category: 'restricted' },
  study_fund: { name: 'Study Fund', name_he: 'קופת גמל לחינוך', category: 'restricted' },
  brokerage: { name: 'Brokerage Account', name_he: 'חשבון ברוקר', category: 'liquid' },
  crypto: { name: 'Cryptocurrency', name_he: 'מטבעות דיגיטליים', category: 'liquid' },
  savings: { name: 'Savings & Term Deposits', name_he: 'חסכונות ופיקדונות', category: 'liquid' },
  bank_balance: { name: 'Available Cash', name_he: 'מזומן זמין', category: 'cash' },
  mutual_fund: { name: 'Mutual Funds', name_he: 'קרנות נאמנות', category: 'liquid' },
  bonds: { name: 'Bonds & Fixed Income', name_he: 'אג"ח והלוואות', category: 'liquid' },
  real_estate: { name: 'Real Estate', name_he: 'נדל"ן', category: 'illiquid' },
  insurance: { name: 'Insurance & Stability', name_he: 'ביטוח ויציבות', category: 'stability' },
  cash: { name: 'Cash Holdings', name_he: 'אחזקות מזומן', category: 'cash' },
  foreign_bank: { name: 'Foreign Cash', name_he: 'מזומן זר', category: 'cash' },
  foreign_investment: { name: 'Foreign Investments', name_he: 'השקעות זרות', category: 'cash' },
  other: { name: 'Other Investments', name_he: 'השקעות אחרות', category: 'other' },
};

async function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

async function fetchAccounts(client) {
  const booleanTrue = dialect.useSqlite ? 1 : 'TRUE';

  return client.query(
    `
      SELECT
        ia.id,
        ia.account_name,
        ia.account_type,
        ia.institution,
        ia.account_number,
        ia.currency,
        ia.notes,
        ia.is_liquid,
        ia.investment_category,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_accounts ia
      LEFT JOIN institution_nodes fi ON ia.institution_id = fi.id AND fi.node_type = 'institution'
      WHERE ia.is_active = ${booleanTrue}
      ORDER BY ia.investment_category, ia.account_type, ia.account_name
    `,
  );
}

// DEPRECATED: Bank accounts are now fetched from investment_accounts with account_type = 'bank_balance'
// This function is kept for backward compatibility but returns empty results
async function fetchBankAccounts(client) {
  return { rows: [] };
}

let fetchBankAccountsImpl = fetchBankAccounts;

function createCategoryTotals() {
  return CATEGORY_KEYS.reduce((accumulator, key) => {
    accumulator[key] = { value: 0, cost: 0, accounts: 0 };
    return accumulator;
  }, {});
}

function createCategoryAccounts() {
  return CATEGORY_KEYS.reduce((accumulator, key) => {
    accumulator[key] = [];
    return accumulator;
  }, {});
}

async function fetchAssets(client) {
  const booleanTrue = dialect.useSqlite ? 1 : 'TRUE';

  return client.query(
    `
      SELECT 
        iasset.*,
        ia.account_name,
        ia.account_type
      FROM investment_assets iasset
      JOIN investment_accounts ia ON iasset.account_id = ia.id
      WHERE iasset.is_active = ${booleanTrue} AND ia.is_active = ${booleanTrue}
      ORDER BY ia.account_name, iasset.asset_name
    `,
  );
}

function buildAccountSummaries(accountsRows, bankAccountsRows) {
  let totalPortfolioValue = 0;
  let totalCostBasis = 0;
  let accountsWithValues = 0;
  let oldestDate = null;
  let newestDate = null;

  const accountsByType = {};
  const accountsByCategory = createCategoryAccounts();
  const totalsByCategory = createCategoryTotals();

  accountsRows.forEach((account) => {
    const value = toNumber(account.current_value);
    const cost = toNumber(account.cost_basis);
    const nativeValue = Object.prototype.hasOwnProperty.call(account, 'native_current_value')
      ? toNumber(account.native_current_value)
      : value;
    const category = normalizeInvestmentCategory(account.investment_category, account.account_type);

    if (value !== null) {
      totalPortfolioValue += value;
      totalsByCategory[category].value += value;
    }
    if (nativeValue !== null) {
      accountsWithValues += 1;
      totalsByCategory[category].accounts += 1;
    }

    if (cost !== null) {
      totalCostBasis += cost;
      totalsByCategory[category].cost += cost;
    }

    if (account.as_of_date) {
      if (!oldestDate || account.as_of_date < oldestDate) {
        oldestDate = account.as_of_date;
      }
      if (!newestDate || account.as_of_date > newestDate) {
        newestDate = account.as_of_date;
      }
    }

    if (!accountsByType[account.account_type]) {
      accountsByType[account.account_type] = {
        type: account.account_type,
        accounts: [],
        totalValue: 0,
        totalCost: 0,
        count: 0,
      };
    }

    const processedAccount = {
      ...account,
      current_value: value,
      cost_basis: cost,
      units: toNumber(account.units),
      investment_category: category,
      institution: account.institution || null,
    };

    accountsByType[account.account_type].accounts.push(processedAccount);
    accountsByType[account.account_type].totalValue += value ?? 0;
    accountsByType[account.account_type].totalCost += cost ?? 0;
    accountsByType[account.account_type].count += 1;
    accountsByCategory[category].push(processedAccount);
  });

  bankAccountsRows.forEach((bankAccount) => {
    const balance = toNumber(bankAccount.current_balance);

    if (balance > 0) {
      totalPortfolioValue += balance;
      totalsByCategory.liquid.value += balance;
      totalsByCategory.liquid.accounts += 1;
      accountsWithValues += 1;

      totalCostBasis += balance;
      totalsByCategory.liquid.cost += balance;

      if (!accountsByType.savings) {
        accountsByType.savings = {
          type: 'savings',
          accounts: [],
          totalValue: 0,
          totalCost: 0,
          count: 0,
        };
      }

      const bankAccountFormatted = {
        id: `bank_${bankAccount.vendor}_${bankAccount.nickname || 'default'}`,
        account_name: bankAccount.nickname || `${bankAccount.vendor} Account`,
        account_type: 'savings',
        institution: bankAccount.institution || null,
        account_number: null,
        currency: 'ILS',
        notes: 'Bank Account Balance',
        is_liquid: true,
        investment_category: 'liquid',
        current_value: balance,
        cost_basis: balance,
        as_of_date: bankAccount.balance_updated_at,
      };

      accountsByType.savings.accounts.push(bankAccountFormatted);
      accountsByType.savings.totalValue += balance;
      accountsByType.savings.totalCost += balance;
      accountsByType.savings.count += 1;

      accountsByCategory.liquid.push(bankAccountFormatted);
    }
  });

  const averageHoldingAgeMonths = computeAverageHoldingAge(
    CATEGORY_KEYS.flatMap((key) => accountsByCategory[key] || []),
  );

  return {
    totals: {
      portfolioValue: totalPortfolioValue,
      costBasis: totalCostBasis,
      accountsWithValues,
      categories: totalsByCategory,
      liquid: totalsByCategory.liquid,
      illiquid: totalsByCategory.illiquid,
      restricted: totalsByCategory.restricted,
      oldestDate,
      newestDate,
      averageHoldingAgeMonths,
    },
    accountsByType,
    accountsByCategory,
  };
}

function computeAverageHoldingAge(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return 0;
  }

  const totalMonths = accounts.reduce((sum, account) => {
    if (!account.as_of_date) {
      return sum;
    }
    const asOfDate = new Date(account.as_of_date);
    const now = new Date();
    const months = ((now.getFullYear() - asOfDate.getFullYear()) * 12) + (now.getMonth() - asOfDate.getMonth());
    return sum + Math.max(months, 0);
  }, 0);

  return totalMonths / accounts.length;
}

async function fetchInvestmentPerformance(client, months) {
  const { subMonths } = await loadDateFns();
  const startDate = subMonths(new Date(), months);

  const monthExpression = dialect.useSqlite
    ? "strftime('%Y-%m-01T00:00:00.000Z', as_of_date)"
    : "DATE_TRUNC('month', as_of_date)";

  const result = await client.query(
    `
      SELECT
        ${monthExpression} AS month,
        SUM(current_value) AS total_value,
        SUM(cost_basis) AS total_cost_basis
      FROM investment_holdings
      WHERE as_of_date >= $1
      GROUP BY ${monthExpression}
      ORDER BY month ASC
    `,
    [startDate],
  );

  return result.rows.map((row) => ({
    month: row.month instanceof Date ? row.month : new Date(row.month),
    total_value: toNumber(row.total_value),
    total_cost_basis: toNumber(row.total_cost_basis),
  }));
}

async function getInvestmentSummary(params = {}) {
  const { historyMonths = 6 } = params;
  const normalizeCurrencies = coerceBoolean(params.normalizeCurrencies);
  const client = await database.getClient();

  try {
    const [accountsResult, bankAccountsResult, assetsResult] = await Promise.all([
      fetchAccounts(client),
      fetchBankAccountsImpl(client),
      fetchAssets(client),
    ]);

    const snapshotByAccount = await fetchAccountHoldingSnapshots(
      client,
      accountsResult.rows.map((row) => row.id),
    );
    const accountsRows = await Promise.all(
      accountsResult.rows.map(async (row) => {
        let institution = buildInstitutionFromRow(row);
        if (!institution && row.account_type) {
          institution = await getInstitutionByVendorCode(database, row.account_type);
        }
        const snapshot = snapshotByAccount.get(Number(row.id)) || {
          current_value: null,
          cost_basis: null,
          as_of_date: null,
          uses_pikadon_rollup: false,
        };
        return {
          ...row,
          current_value: snapshot.current_value,
          cost_basis: snapshot.cost_basis,
          as_of_date: snapshot.as_of_date,
          units: null,
          asset_name: null,
          asset_type: null,
          uses_pikadon_rollup: snapshot.uses_pikadon_rollup,
          institution: institution || null,
        };
      }),
    );

    const bankAccountsRows = await Promise.all(
      bankAccountsResult.rows.map(async (row) => {
        const institution = await getInstitutionByVendorCode(database, row.vendor);
        return { ...row, institution: institution || null };
      }),
    );

    const linkedTransactions = accountsRows.length > 0 && !normalizeCurrencies
      ? await fetchLinkedInvestmentTransactions(
        client,
        accountsRows.map((row) => row.id),
      )
      : [];
    // Linked bank transactions can be denominated differently from their
    // investment account. Do not add those amounts to a native snapshot before
    // FX conversion; the performance service converts each flow separately on
    // its own date. The normalized summary remains based on recorded account
    // valuations instead of inventing a cross-currency balance adjustment.
    const rolledForwardAccounts = normalizeCurrencies
      ? accountsRows
      : applyContributionRollforward(accountsRows, linkedTransactions, {
        excludePikadonTransactions: true,
      });
    const pikadonRollupAccountIds = rolledForwardAccounts
      .filter((account) => account.account_type === 'savings' && account.uses_pikadon_rollup)
      .map((account) => account.id);
    const hasBankBalanceAccounts = rolledForwardAccounts.some(
      (account) => account.account_type === 'bank_balance',
    );
    const overlapSources = hasBankBalanceAccounts && pikadonRollupAccountIds.length > 0
      ? await fetchActivePikadonOverlapSources(client, pikadonRollupAccountIds)
      : [];
    const adjustedAccountsNative = applyBankBalanceOverlapAdjustments(
      rolledForwardAccounts,
      overlapSources,
    );

    const normalizedAccountResult = await normalizeAccountCurrencies(
      adjustedAccountsNative,
      normalizeCurrencies,
    );
    const adjustedAccounts = normalizedAccountResult.accounts;

    const summary = buildAccountSummaries(adjustedAccounts, bankAccountsRows);

    const assetsByAccount = {};
    const normalizedAssets = assetsResult.rows.map((row) => {
      const normalized = {
        ...row,
        units: toNumber(row.units),
        average_cost: toNumber(row.average_cost),
        current_value: toNumber(row.current_value),
        cost_basis: toNumber(row.cost_basis),
      };
      if (row.account_id) {
        if (!assetsByAccount[row.account_id]) {
          assetsByAccount[row.account_id] = [];
        }
        assetsByAccount[row.account_id].push(normalized);
      }
      return normalized;
    });

    // Attach assets to the processed accounts
    Object.values(summary.accountsByType).forEach((group) => {
      group.accounts.forEach((account) => {
        account.assets = assetsByAccount[account.id] || [];
      });
    });

    const valuationComplete = !normalizeCurrencies
      || normalizedAccountResult.fx?.valuationComplete === true;
    const costBasisComplete = !normalizeCurrencies
      || normalizedAccountResult.fx?.costBasisComplete === true;
    const pnlComplete = valuationComplete && costBasisComplete;
    const totalPortfolioValue = valuationComplete ? summary.totals.portfolioValue : null;
    const totalCostBasis = costBasisComplete ? summary.totals.costBasis : null;
    const unrealizedGainLoss = pnlComplete
      ? summary.totals.portfolioValue - summary.totals.costBasis
      : null;
    const roi = pnlComplete
      ? (summary.totals.costBasis > 0
        ? (unrealizedGainLoss / summary.totals.costBasis) * 100
        : 0)
      : null;

    const metricAvailabilityForAccounts = (accounts) => {
      if (!normalizeCurrencies) {
        return { valuationComplete: true, costBasisComplete: true };
      }
      return {
        valuationComplete: accounts.every((account) => (
          toNumber(account.native_current_value) === null
          || toNumber(account.current_value) !== null
        )),
        costBasisComplete: accounts.every((account) => (
          toNumber(account.native_cost_basis) === null
          || toNumber(account.cost_basis) !== null
        )),
      };
    };

    const categorySummary = (totals, accounts = []) => {
      const availability = metricAvailabilityForAccounts(accounts);
      const categoryPnlComplete = availability.valuationComplete && availability.costBasisComplete;
      const categoryGainLoss = categoryPnlComplete ? totals.value - totals.cost : null;
      return {
        totalValue: availability.valuationComplete ? totals.value : null,
        totalCost: availability.costBasisComplete ? totals.cost : null,
        unrealizedGainLoss: categoryGainLoss,
        roi: categoryPnlComplete
          ? (totals.cost > 0 ? (categoryGainLoss / totals.cost) * 100 : 0)
          : null,
        accountsCount: totals.accounts,
        valuationComplete: availability.valuationComplete,
        costBasisComplete: availability.costBasisComplete,
      };
    };

    const normalizedGroupsByType = Object.values(summary.accountsByType)
      .map((group) => {
        const availability = metricAvailabilityForAccounts(group.accounts);
        return {
          ...group,
          totalValue: availability.valuationComplete ? group.totalValue : null,
          totalCost: availability.costBasisComplete ? group.totalCost : null,
          valuationComplete: availability.valuationComplete,
          costBasisComplete: availability.costBasisComplete,
        };
      });
    const accountsByType = normalizedGroupsByType.reduce((accumulator, group) => {
      accumulator[group.type] = group;
      return accumulator;
    }, {});
    const breakdown = normalizedGroupsByType
      .map((group) => {
        const label = ACCOUNT_TYPE_LABELS[group.type] || {
          name: group.type,
          name_he: group.type,
          category: normalizeInvestmentCategory(group.accounts[0]?.investment_category, group.type),
        };

        return {
          ...group,
          ...label,
          category: normalizeInvestmentCategory(label.category, group.type),
          percentage: totalPortfolioValue === null || group.totalValue === null
            ? null
            : totalPortfolioValue > 0
              ? (group.totalValue / totalPortfolioValue) * 100
              : 0,
        };
      });

    const categoryBuckets = CATEGORY_KEYS.reduce((accumulator, key) => {
      accumulator[key] = {
        ...categorySummary(summary.totals.categories[key], summary.accountsByCategory[key]),
        accounts: summary.accountsByCategory[key] || [],
      };
      return accumulator;
    }, {});

    const publicCategoryTotals = CATEGORY_KEYS.reduce((accumulator, key) => {
      const category = categoryBuckets[key];
      accumulator[key] = {
        value: category.totalValue,
        cost: category.totalCost,
        accounts: category.accountsCount,
        valuationComplete: category.valuationComplete,
        costBasisComplete: category.costBasisComplete,
      };
      return accumulator;
    }, {});
    const publicTotals = {
      ...summary.totals,
      portfolioValue: totalPortfolioValue,
      costBasis: totalCostBasis,
      categories: publicCategoryTotals,
      liquid: publicCategoryTotals.liquid,
      illiquid: publicCategoryTotals.illiquid,
      restricted: publicCategoryTotals.restricted,
    };

    const performanceHistory = normalizeCurrencies
      ? []
      : await fetchInvestmentPerformance(
        client,
        Number.parseInt(historyMonths, 10) || 6,
      );

    const timeline = performanceHistory.map((item) => {
      const monthDate = item.month instanceof Date ? item.month : new Date(item.month);
      const totalValue = toNumber(item.total_value) || 0;
      const totalCost = toNumber(item.total_cost_basis) || 0;

      return {
        date: monthDate.toISOString().split('T')[0],
        totalValue,
        totalCost,
        gainLoss: totalValue - totalCost,
      };
    });

    const investmentAccounts = adjustedAccounts.map((account) => ({
      ...account,
      current_value: toNumber(account.current_value),
      cost_basis: toNumber(account.cost_basis),
      units: toNumber(account.units),
      assets: assetsByAccount[account.id] || [],
    }));

    const response = {
      summary: {
        totalPortfolioValue,
        totalCostBasis,
        unrealizedGainLoss,
        roi,
        totalAccounts: accountsRows.length,
        accountsWithValues: summary.totals.accountsWithValues,
        oldestUpdateDate: summary.totals.oldestDate,
        newestUpdateDate: summary.totals.newestDate,
        liquid: categorySummary(summary.totals.liquid, summary.accountsByCategory.liquid),
        illiquid: categorySummary(summary.totals.illiquid, summary.accountsByCategory.illiquid),
        restricted: categorySummary(summary.totals.restricted, summary.accountsByCategory.restricted),
      },
      breakdown,
      categoryBuckets,
      timeline,
      liquidAccounts: summary.accountsByCategory.liquid,
      illiquidAccounts: summary.accountsByCategory.illiquid,
      restrictedAccounts: summary.accountsByCategory.restricted,
      accounts: investmentAccounts,
      totals: publicTotals,
      accountsByType,
      accountsByCategory: summary.accountsByCategory,
      assets: normalizedAssets,
      performanceHistory,
      fx: normalizedAccountResult.fx,
    };

    return response;
  } finally {
    client.release();
  }
}

module.exports = {
  getInvestmentSummary,
  __setDatabase(mockDatabase) {
    database = mockDatabase || actualDatabase;
    fxService.__setDatabase(database);
  },
  __setFetchBankAccountsForTests(fetcher) {
    fetchBankAccountsImpl = typeof fetcher === 'function' ? fetcher : fetchBankAccounts;
  },
  __resetDatabase() {
    database = actualDatabase;
    fxService.__resetDatabase();
    fetchBankAccountsImpl = fetchBankAccounts;
  },
};

module.exports.default = module.exports;
