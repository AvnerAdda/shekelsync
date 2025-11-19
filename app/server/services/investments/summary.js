const database = require('../database.js');
const {
  INSTITUTION_SELECT_FIELDS,
  buildInstitutionFromRow,
  getInstitutionByVendorCode,
} = require('../institutions.js');
const { dialect } = require('../../../lib/sql-dialect.js');

let dateFnsPromise = null;

async function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

function toNumber(value) {
  return value !== null && value !== undefined ? Number.parseFloat(value) : null;
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
        ih.current_value,
        ih.cost_basis,
        ih.as_of_date,
        ih.units,
        ih.asset_name,
        ih.asset_type,
        ${INSTITUTION_SELECT_FIELDS}
      FROM investment_accounts ia
      LEFT JOIN investment_holdings ih
        ON ih.id = (
          SELECT ih2.id
          FROM investment_holdings ih2
          WHERE ih2.account_id = ia.id
          ORDER BY ih2.as_of_date DESC
          LIMIT 1
        )
      LEFT JOIN financial_institutions fi ON ia.institution_id = fi.id
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

  const liquidTotal = { value: 0, cost: 0, accounts: 0 };
  const restrictedTotal = { value: 0, cost: 0, accounts: 0 };

  const accountsByType = {};
  const accountsByCategory = { liquid: [], restricted: [] };

  accountsRows.forEach((account) => {
    const value = toNumber(account.current_value) || 0;
    const cost = toNumber(account.cost_basis) || 0;
    const category = account.investment_category;

    if (value > 0) {
      totalPortfolioValue += value;
      accountsWithValues += 1;

      if (category === 'liquid') {
        liquidTotal.value += value;
        liquidTotal.accounts += 1;
      } else if (category === 'restricted') {
        restrictedTotal.value += value;
        restrictedTotal.accounts += 1;
      }
    }

    if (cost > 0) {
      totalCostBasis += cost;

      if (category === 'liquid') {
        liquidTotal.cost += cost;
      } else if (category === 'restricted') {
        restrictedTotal.cost += cost;
      }
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
      institution: account.institution || null,
    };

    accountsByType[account.account_type].accounts.push(processedAccount);
    accountsByType[account.account_type].totalValue += value;
    accountsByType[account.account_type].totalCost += cost;
    accountsByType[account.account_type].count += 1;

    if (category === 'liquid' || category === 'restricted') {
      accountsByCategory[category].push(processedAccount);
    }
  });

  bankAccountsRows.forEach((bankAccount) => {
    const balance = toNumber(bankAccount.current_balance);

    if (balance > 0) {
      totalPortfolioValue += balance;
      liquidTotal.value += balance;
      liquidTotal.accounts += 1;
      accountsWithValues += 1;

      totalCostBasis += balance;
      liquidTotal.cost += balance;

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

  const averageHoldingAgeMonths = computeAverageHoldingAge(accountsByCategory.liquid, accountsByCategory.restricted);

  return {
    totals: {
      portfolioValue: totalPortfolioValue,
      costBasis: totalCostBasis,
      accountsWithValues,
      liquid: liquidTotal,
      restricted: restrictedTotal,
      oldestDate,
      newestDate,
      averageHoldingAgeMonths,
    },
    accountsByType,
    accountsByCategory,
  };
}

function computeAverageHoldingAge(liquidAccounts, restrictedAccounts) {
  const allAccounts = [...liquidAccounts, ...restrictedAccounts];
  if (allAccounts.length === 0) {
    return 0;
  }

  const totalMonths = allAccounts.reduce((sum, account) => {
    if (!account.as_of_date) {
      return sum;
    }
    const asOfDate = new Date(account.as_of_date);
    const now = new Date();
    const months = ((now.getFullYear() - asOfDate.getFullYear()) * 12) + (now.getMonth() - asOfDate.getMonth());
    return sum + Math.max(months, 0);
  }, 0);

  return totalMonths / allAccounts.length;
}

async function fetchInvestmentPerformance(client, months) {
  const { subMonths } = await loadDateFns();
  const startDate = subMonths(new Date(), months);

  const monthExpression = dialect.useSqlite
    ? "strftime('%Y-%m-01T00:00:00.000Z', snapshot_date)"
    : "DATE_TRUNC('month', snapshot_date)";

  const result = await client.query(
    `
      SELECT
        ${monthExpression} AS month,
        SUM(total_value) AS total_value,
        SUM(cost_basis) AS total_cost_basis
      FROM investment_holdings_history
      WHERE snapshot_date >= $1
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
  const client = await database.getClient();

  try {
    const [accountsResult, bankAccountsResult, assetsResult] = await Promise.all([
      fetchAccounts(client),
      fetchBankAccounts(client),
      fetchAssets(client),
    ]);

    const accountsRows = await Promise.all(
      accountsResult.rows.map(async (row) => {
        let institution = buildInstitutionFromRow(row);
        if (!institution && row.account_type) {
          institution = await getInstitutionByVendorCode(database, row.account_type);
        }
        return { ...row, institution: institution || null };
      }),
    );

    const bankAccountsRows = await Promise.all(
      bankAccountsResult.rows.map(async (row) => {
        const institution = await getInstitutionByVendorCode(database, row.vendor);
        return { ...row, institution: institution || null };
      }),
    );

    const summary = buildAccountSummaries(accountsRows, bankAccountsRows);

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

    const totalPortfolioValue = summary.totals.portfolioValue;
    const totalCostBasis = summary.totals.costBasis;
    const unrealizedGainLoss = totalPortfolioValue - totalCostBasis;
    const roi = totalCostBasis > 0 ? (unrealizedGainLoss / totalCostBasis) * 100 : 0;

    const categorySummary = (totals) => ({
      totalValue: totals.value,
      totalCost: totals.cost,
      unrealizedGainLoss: totals.value - totals.cost,
      roi: totals.cost > 0 ? ((totals.value - totals.cost) / totals.cost) * 100 : 0,
      accountsCount: totals.accounts,
    });

    const accountTypeLabels = {
      pension: { name: 'Pension Fund', name_he: 'קרן פנסיה', category: 'restricted' },
      provident: { name: 'Provident Fund', name_he: 'קרן השתלמות', category: 'restricted' },
      study_fund: { name: 'Study Fund', name_he: 'קופת גמל לחינוך', category: 'restricted' },
      brokerage: { name: 'Brokerage Account', name_he: 'חשבון ברוקר', category: 'liquid' },
      crypto: { name: 'Cryptocurrency', name_he: 'מטבעות דיגיטליים', category: 'liquid' },
      savings: { name: 'Bank Savings & Cash', name_he: 'חשבונות בנק ומזומן', category: 'liquid' },
      bank_balance: { name: 'Bank Savings & Cash', name_he: 'חשבונות בנק ומזומן', category: 'liquid' },
      mutual_fund: { name: 'Mutual Funds', name_he: 'קרנות נאמנות', category: 'liquid' },
      bonds: { name: 'Bonds & Fixed Income', name_he: 'אג"ח והלוואות', category: 'liquid' },
      real_estate: { name: 'Real Estate', name_he: 'נדל"ן והשקעות רע"ן', category: 'liquid' },
      other: { name: 'Other Investments', name_he: 'השקעות אחרות', category: 'liquid' },
    };

    const breakdown = Object.values(summary.accountsByType).map((group) => {
      const label = accountTypeLabels[group.type] || {
        name: group.type,
        name_he: group.type,
        category: group.accounts[0]?.investment_category || 'liquid',
      };

      return {
        ...group,
        ...label,
        percentage: totalPortfolioValue > 0 ? (group.totalValue / totalPortfolioValue) * 100 : 0,
      };
    });

    const performanceHistory = await fetchInvestmentPerformance(
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

    const investmentAccounts = accountsRows.map((account) => ({
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
        liquid: categorySummary(summary.totals.liquid),
        restricted: categorySummary(summary.totals.restricted),
      },
      breakdown,
      timeline,
      liquidAccounts: summary.accountsByCategory.liquid,
      restrictedAccounts: summary.accountsByCategory.restricted,
      accounts: investmentAccounts,
      totals: summary.totals,
      accountsByType: summary.accountsByType,
      accountsByCategory: summary.accountsByCategory,
      assets: normalizedAssets,
      performanceHistory,
    };

    return response;
  } finally {
    client.release();
  }
}

module.exports = {
  getInvestmentSummary,
};

module.exports.default = module.exports;
