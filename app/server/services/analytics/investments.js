let database = require('../database.js');
const { dialect } = require('../../../lib/sql-dialect.js');

function parseDateParam(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().split('T')[0];
}

function buildDateFilter(startDate, endDate) {
  const start = parseDateParam(startDate);
  const end = parseDateParam(endDate);

  if (start && end) {
    return {
      clause: 'AND t.date >= $1 AND t.date <= $2',
      params: [start, end],
    };
  }

  return { clause: '', params: [] };
}

function buildSummary(transactions, pikadonReturns = new Map()) {
  const summary = {
    totalMovement: 0,
    investmentOutflow: 0,
    investmentInflow: 0,
    netInvestments: 0,
    totalCount: transactions.length,
    // New: pikadon-specific metrics
    pikadonPrincipalReturned: 0,
    pikadonInterestEarned: 0,
    adjustedInflow: 0, // Inflow minus principal returns
  };

  const byCategory = new Map();

  transactions.forEach((txn) => {
    const amount = Number.parseFloat(txn.price) || 0;
    let absAmount = Math.abs(amount);
    let effectiveInflow = amount > 0 ? amount : 0;
    const categoryName = txn.category_name || 'Unknown';
    const categoryNameEn = txn.category_name_en || 'Unknown';

    // Check if this is a pikadon return transaction
    const txnKey = `${txn.identifier}|${txn.vendor}`;
    if (amount > 0 && pikadonReturns.has(txnKey)) {
      const pikadonInfo = pikadonReturns.get(txnKey);
      // Only count interest as actual income, not the principal
      summary.pikadonPrincipalReturned += pikadonInfo.principal;
      summary.pikadonInterestEarned += pikadonInfo.interest;
      effectiveInflow = pikadonInfo.interest; // Only interest is real income
    }

    summary.totalMovement += absAmount;
    if (amount < 0) {
      summary.investmentOutflow += absAmount;
    } else {
      summary.investmentInflow += absAmount;
      summary.adjustedInflow += effectiveInflow;
    }

    if (!byCategory.has(categoryName)) {
      byCategory.set(categoryName, {
        name: categoryName,
        name_en: categoryNameEn,
        total: 0,
        count: 0,
        outflow: 0,
        inflow: 0,
      });
    }

    const bucket = byCategory.get(categoryName);
    bucket.total += absAmount;
    bucket.count += 1;
    if (amount < 0) {
      bucket.outflow += absAmount;
    } else {
      bucket.inflow += absAmount;
    }
  });

  summary.netInvestments = summary.investmentOutflow - summary.investmentInflow;

  const categories = Array.from(byCategory.values()).sort((a, b) => b.total - a.total);

  return { summary, categories };
}

async function getInvestmentsAnalytics(query = {}) {
  const { startDate, endDate } = query;

  const { clause: dateFilter, params } = buildDateFilter(startDate, endDate);

  const transactionsQuery = `
    SELECT
      t.identifier,
      t.vendor,
      t.date,
      t.name,
      t.price,
      t.account_number,
      cd.id as category_definition_id,
      cd.name as category_name,
      cd.name_en as category_name_en,
      cd.parent_id,
      parent.name as parent_name,
      parent.name_en as parent_name_en
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    WHERE cd.category_type = 'investment'
    ${dateFilter}
    ORDER BY t.date DESC
  `;

  const transactionsResult = await database.query(transactionsQuery, params);
  const transactions = transactionsResult.rows.map((txn) => ({
    ...txn,
    price: Number.parseFloat(txn.price),
  }));

  // Fetch pikadon return transactions to separate principal from interest
  // Include both matured and rolled_over status
  const pikadonReturnsQuery = `
    SELECT
      ih.id,
      ih.return_transaction_id,
      ih.return_transaction_vendor,
      ih.cost_basis as principal,
      (ih.current_value - ih.cost_basis) as interest,
      ih.status,
      ih.maturity_date,
      child.id as child_pikadon_id,
      child.cost_basis as child_principal
    FROM investment_holdings ih
    LEFT JOIN investment_holdings child ON child.parent_pikadon_id = ih.id AND child.holding_type = 'pikadon'
    WHERE ih.holding_type = 'pikadon'
      AND ih.return_transaction_id IS NOT NULL
      AND ih.status IN ('matured', 'rolled_over')
  `;

  const pikadonReturnsResult = await database.query(pikadonReturnsQuery);
  const pikadonReturns = new Map();
  pikadonReturnsResult.rows.forEach((row) => {
    const key = `${row.return_transaction_id}|${row.return_transaction_vendor}`;
    const principal = Number.parseFloat(row.principal) || 0;
    const interest = Number.parseFloat(row.interest) || 0;
    const childPrincipal = row.child_principal ? Number.parseFloat(row.child_principal) : null;

    pikadonReturns.set(key, {
      principal,
      interest,
      status: row.status,
      is_rolled_over: row.status === 'rolled_over',
      child_principal: childPrincipal,
      interest_reinvested: childPrincipal ? childPrincipal - principal : null,
      interest_withdrawn: childPrincipal ? interest - (childPrincipal - principal) : interest,
    });
  });

  const { summary, categories } = buildSummary(transactions, pikadonReturns);

  const monthExpr = dialect.dateTrunc('month', 't.date');
  const timelineQuery = `
    SELECT
      ${monthExpr} as month,
      SUM(CASE WHEN t.price < 0 THEN ABS(t.price) ELSE 0 END) as outflow,
      SUM(CASE WHEN t.price > 0 THEN t.price ELSE 0 END) as inflow,
      COUNT(*) as count
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    WHERE cd.category_type = 'investment'
    ${dateFilter}
    GROUP BY ${monthExpr}
    ORDER BY month DESC
  `;

  const timelineResult = await database.query(timelineQuery, [...params]);
  const timeline = timelineResult.rows.map((row) => {
    const outflow = Number.parseFloat(row.outflow || 0);
    const inflow = Number.parseFloat(row.inflow || 0);
    return {
      month: row.month,
      outflow,
      inflow,
      net: outflow - inflow,
      count: Number.parseInt(row.count, 10),
    };
  });

  return {
    summary,
    byCategory: categories,
    timeline,
    transactions,
  };
}

module.exports = {
  getInvestmentsAnalytics,
  // Test hooks
  __setDatabase(mock) {
    database = mock || require('../database.js');
  },
  __resetDatabase() {
    database = require('../database.js');
  },
};
module.exports.default = module.exports;
