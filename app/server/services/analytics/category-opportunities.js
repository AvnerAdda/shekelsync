const database = require('../database.js');

function parseIntOrDefault(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseFloatSafe(value) {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getCategoryOpportunities(params = {}) {
  const months = parseIntOrDefault(params.months, 6);
  const minTransactions = parseIntOrDefault(params.minTransactions, 3);

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const startDateStr = startDate.toISOString().split('T')[0];

  const transactionsQuery = `
    SELECT
      cd.id AS category_definition_id,
      COALESCE(cd.name, cd.name_en, 'Unknown') AS category_name,
      COALESCE(parent.id, cd.id) AS parent_id,
      COALESCE(parent.name, parent.name_en, cd.name, cd.name_en) AS parent_name,
      t.date,
      ABS(t.price) AS amount,
      t.vendor AS merchant_name,
      t.name AS description
    FROM transactions t
    INNER JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
    LEFT JOIN account_pairings ap ON (
      t.vendor = ap.bank_vendor
      AND ap.is_active = 1
      AND (ap.bank_account_number IS NULL OR ap.bank_account_number = t.account_number)
      AND ap.match_patterns IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM json_each(ap.match_patterns)
        WHERE LOWER(t.name) LIKE '%' || LOWER(json_each.value) || '%'
      )
    )
    WHERE t.date >= $1
      AND t.price < 0
      AND cd.category_type = 'expense'
      AND cd.is_active = true
      AND ap.id IS NULL
    ORDER BY t.date DESC;
  `;

  const [transactionsResult, actionabilityResult] = await Promise.all([
    database.query(transactionsQuery, [startDateStr]),
    database.query(
      `
        SELECT category_definition_id, actionability_level
        FROM category_actionability_settings
      `,
    ),
  ]);

  const actionabilityMap = new Map(
    actionabilityResult.rows.map((row) => [
      row.category_definition_id,
      row.actionability_level || 'medium',
    ]),
  );

  const categorySummaries = calculateCategorySummaries(
    transactionsResult.rows,
    minTransactions,
    actionabilityMap,
  );

  const opportunities = categorySummaries.map((subcategory) => {
    const subTransactions = subcategory.transactions;
    const outliers = detectOutliers(subTransactions, subcategory.avg_transaction_amount);
    const trend = analyzeSpendingTrend(subTransactions);
    const suggestions = generateReductionSuggestions(
      subcategory,
      outliers,
      trend,
      subTransactions,
    );
    const opportunityScore = calculateOpportunityScore(
      subcategory,
      outliers,
      trend,
      suggestions,
    );

    return {
      category_definition_id: subcategory.category_definition_id,
      category_name: subcategory.category_name,
      parent_id: subcategory.parent_id,
      parent_name: subcategory.parent_name,
      actionability_level: subcategory.actionability_level,
      spending_summary: {
        total_spending: parseFloatSafe(subcategory.total_spending),
        avg_monthly_spending: parseFloatSafe(subcategory.avg_monthly_spending),
        months_active: parseIntOrDefault(subcategory.months_active, 0),
        total_transactions: parseIntOrDefault(subcategory.total_transactions, 0),
        avg_transaction_amount: parseFloatSafe(subcategory.avg_transaction_amount),
        highest_transaction: parseFloatSafe(subcategory.highest_transaction),
        spending_variance: parseFloatSafe(subcategory.spending_variance),
      },
      outliers: outliers.slice(0, 5),
      trend,
      suggestions,
      opportunity_score: opportunityScore,
    };
  });

  const actionableOpportunities = opportunities.filter(
    (opp) =>
      opp.actionability_level !== 'low' &&
      opp.opportunity_score >= 30 &&
      opp.suggestions.length > 0,
  );

  actionableOpportunities.sort((a, b) => b.opportunity_score - a.opportunity_score);

  return {
    period: {
      start_date: startDate,
      end_date: new Date(),
      months,
    },
    opportunities: actionableOpportunities,
    summary: {
      total_opportunities: actionableOpportunities.length,
      total_potential_savings: actionableOpportunities.reduce(
        (sum, opp) =>
          sum +
          opp.suggestions.reduce(
            (innerSum, suggestion) => innerSum + (suggestion.potential_savings || 0),
            0,
          ),
        0,
      ),
      high_priority_count: actionableOpportunities.filter((o) => o.opportunity_score >= 70).length,
      medium_priority_count: actionableOpportunities.filter(
        (o) => o.opportunity_score >= 50 && o.opportunity_score < 70,
      ).length,
    },
  };
}

function calculateCategorySummaries(transactions, minTransactions, actionabilityMap) {
  const categories = new Map();

  transactions.forEach((txn) => {
    const key = `${txn.category_definition_id}`;

    if (!categories.has(key)) {
      categories.set(key, {
        category_definition_id: txn.category_definition_id,
        category_name: txn.category_name,
        parent_id: txn.parent_id,
        parent_name: txn.parent_name,
        total_spending: 0,
        transactions: [],
        months_active: new Set(),
        highest_transaction: 0,
        actionability_level: actionabilityMap.get(txn.category_definition_id) || 'medium',
      });
    }

    const category = categories.get(key);
    category.total_spending += parseFloatSafe(txn.amount);
    category.transactions.push(txn);
    category.months_active.add(new Date(txn.date).getMonth());
    category.highest_transaction = Math.max(category.highest_transaction, parseFloatSafe(txn.amount));
  });

  categories.forEach((category, key) => {
    const totalTransactions = category.transactions.length;

    if (totalTransactions < minTransactions) {
      categories.delete(key);
      return;
    }

    const monthsActive = category.months_active.size || 1;
    const avgMonthlySpending = category.total_spending / monthsActive;
    const avgTransactionAmount = category.total_spending / totalTransactions;

    const variance =
      category.transactions.reduce((sum, txn) => {
        const diff = parseFloatSafe(txn.amount) - avgTransactionAmount;
        return sum + diff * diff;
      }, 0) / totalTransactions;

    categories.set(key, {
      ...category,
      avg_monthly_spending: avgMonthlySpending,
      avg_transaction_amount: avgTransactionAmount,
      total_transactions: totalTransactions,
      months_active: monthsActive,
      spending_variance: variance,
    });
  });

  return Array.from(categories.values());
}

function detectOutliers(transactions, avgAmount) {
  if (!transactions.length) return [];

  const stdDev = Math.sqrt(
    transactions.reduce((sum, txn) => {
      const diff = parseFloatSafe(txn.amount) - avgAmount;
      return sum + diff * diff;
    }, 0) / transactions.length,
  );

  const threshold = avgAmount + stdDev * 2;

  const outliers = transactions
    .filter((txn) => parseFloatSafe(txn.amount) > threshold)
    .map((txn) => ({
      ...txn,
      amount: parseFloatSafe(txn.amount),
      deviation: parseFloatSafe(txn.amount) - threshold,
    }));

  outliers.sort((a, b) => b.deviation - a.deviation);
  return outliers;
}

function analyzeSpendingTrend(transactions) {
  const monthlyTotals = new Map();

  transactions.forEach((txn) => {
    const date = new Date(txn.date);
    const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
    monthlyTotals.set(
      monthKey,
      parseFloatSafe(txn.amount) + (monthlyTotals.get(monthKey) || 0),
    );
  });

  const sortedMonths = Array.from(monthlyTotals.entries()).sort();
  const monthlyValues = sortedMonths.map(([, value]) => value);

  if (monthlyValues.length < 2) {
    return {
      trend: 'stable',
      direction: 'stable',
      description: 'Not enough data to determine a spending trend for this category.',
      change_direction: 'stable',
      percent_change: 0,
      change_percentage: 0,
      monthly_totals: sortedMonths,
    };
  }

  const first = monthlyValues[0];
  const last = monthlyValues[monthlyValues.length - 1];
  const percentChange = ((last - first) / Math.max(first, 1)) * 100;

  let trend = 'stable';
  let direction = 'stable';
  let description = 'Spending has remained relatively stable during this period.';

  if (percentChange > 20) {
    trend = 'increasing';
    direction = 'increasing';
    description = `Spending has increased by ${percentChange.toFixed(1)}% over the selected period.`;
  } else if (percentChange < -20) {
    trend = 'decreasing';
    direction = 'decreasing';
    description = `Spending has decreased by ${Math.abs(percentChange).toFixed(1)}% over the selected period.`;
  } else if (monthlyValues.length >= 2) {
    description = `Spending fluctuated within ±${Math.abs(percentChange).toFixed(1)}% of the starting month.`;
  }

  return {
    trend,
    direction,
    description,
    change_direction: direction,
    percent_change: percentChange,
    change_percentage: percentChange,
    monthly_totals: sortedMonths,
  };
}

function generateReductionSuggestions(category, outliers, trend, transactions) {
  const suggestions = [];
  const topOutliers = outliers.slice(0, 3);
  const avgTransactionAmount = parseFloatSafe(category.avg_transaction_amount);

  topOutliers.forEach((outlier) => {
    suggestions.push({
      type: 'outlier',
      title: `Review ${outlier.merchant_name || 'transaction'} from ${new Date(
        outlier.date,
      ).toLocaleDateString()}`,
      description: `This transaction (₪${parseFloatSafe(
        outlier.amount,
      ).toFixed(2)}) is unusually high compared to your typical spending in this category.`,
      potential_savings: Math.min(parseFloatSafe(outlier.amount) - avgTransactionAmount, outlier.amount * 0.5),
      recommended_action: 'Investigate this charge for potential refunds or negotiate better terms.',
      transaction: outlier,
    });
  });

  if (trend.trend === 'increasing') {
    suggestions.push({
      type: 'trend',
      title: 'Spending trend is increasing',
      description: `Spending in this category has increased by ${trend.percent_change.toFixed(
        1,
      )}% over the selected period.`,
      potential_savings: category.total_spending * 0.1,
      recommended_action:
        'Review recurring services or consider setting a stricter monthly budget for this category.',
      trend,
    });
  }

  const merchants = new Map();
  transactions.forEach((txn) => {
    const key = txn.merchant_name || txn.description;
    if (!merchants.has(key)) {
      merchants.set(key, {
        name: key,
        total: 0,
        count: 0,
      });
    }
    const merchant = merchants.get(key);
    merchant.total += parseFloatSafe(txn.amount);
    merchant.count += 1;
  });

  const topMerchants = Array.from(merchants.values())
    .filter((m) => m.total > avgTransactionAmount)
    .sort((a, b) => b.total - a.total)
    .slice(0, 2);

  topMerchants.forEach((merchant) => {
    suggestions.push({
      type: 'merchant',
      title: `Negotiate or reduce spending with ${merchant.name}`,
      description: `${merchant.name} accounts for ₪${merchant.total.toFixed(2)} in this category.`,
      potential_savings: merchant.total * 0.15,
      recommended_action:
        'Consider switching providers, negotiating rates, or reducing consumption with this merchant.',
      merchant,
    });
  });

  if (suggestions.length === 0) {
    suggestions.push({
      type: 'general',
      title: 'Set a monitoring alert',
      description: 'We did not identify specific opportunities, but monitoring this category can help prevent future overspending.',
      potential_savings: category.total_spending * 0.05,
      recommended_action: 'Set a monthly budget alert and review this category regularly.',
    });
  }

  return suggestions;
}

function calculateOpportunityScore(category, outliers, trend, suggestions) {
  let score = 0;

  const totalSpending = parseFloatSafe(category.total_spending);
  const avgTransaction = parseFloatSafe(category.avg_transaction_amount);
  const variability = parseFloatSafe(category.spending_variance);

  if (variability > avgTransaction * 1.5) {
    score += 20;
  }

  if (outliers.length > 0) {
    score += 20;
  }

  if (trend.trend === 'increasing') {
    score += 15;
  }

  if (totalSpending > 1000) {
    score += 20;
  } else if (totalSpending > 500) {
    score += 10;
  }

  if (suggestions.length > 0) {
    score += 15;
  }

  if (category.actionability_level === 'high') {
    score += 10;
  } else if (category.actionability_level === 'medium') {
    score += 5;
  }

  return Math.min(100, score);
}

module.exports = {
  getCategoryOpportunities,
};

module.exports.default = module.exports;
