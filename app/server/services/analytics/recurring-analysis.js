let dateFnsPromise;

function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}
const database = require('../database.js');

const DEFAULT_MIN_CONFIDENCE = 0.5;

function normalizeMerchantName(name) {
  if (!name) return 'unknown';
  let normalized = name.toLowerCase();
  normalized = normalized.replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/\d+/g, '');
  normalized = normalized.replace(/[^a-zא-ת\s]/g, '');
  return normalized || 'unknown';
}

function groupByMerchant(transactions) {
  const groups = {};
  transactions.forEach((txn) => {
    const normalized = normalizeMerchantName(txn.name);
    if (!groups[normalized]) {
      groups[normalized] = [];
    }
    groups[normalized].push(txn);
  });
  return groups;
}

function analyzeRecurringPattern(transactions, merchantPattern, dateFns) {
  const { differenceInDays, addDays } = dateFns;
  if (!transactions || transactions.length < 2) return null;

  const sortedTxns = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const intervals = [];
  for (let i = 1; i < sortedTxns.length; i += 1) {
    const currentDate = new Date(sortedTxns[i].date);
    const prevDate = new Date(sortedTxns[i - 1].date);
    intervals.push(Math.abs(Math.round(differenceInDays(currentDate, prevDate))));
  }

  if (intervals.length === 0) return null;

  const avgInterval = intervals.reduce((sum, val) => sum + val, 0) / intervals.length;

  let frequency = 'monthly';
  if (avgInterval <= 7) {
    frequency = 'weekly';
  } else if (avgInterval <= 15) {
    frequency = 'biweekly';
  } else if (avgInterval <= 45) {
    frequency = 'monthly';
  } else if (avgInterval <= 100) {
    frequency = 'quarterly';
  } else {
    frequency = 'yearly';
  }

  const amounts = sortedTxns.map((txn) => txn.amount);
  const avgAmount = amounts.reduce((sum, val) => sum + val, 0) / amounts.length;
  const variance =
    amounts.reduce((sum, val) => sum + (val - avgAmount) * (val - avgAmount), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);
  const amountConsistency = Math.max(0, Math.min(1, 1 - stdDev / avgAmount));

  const intervalVariance =
    intervals.reduce((sum, val) => sum + (val - avgInterval) * (val - avgInterval), 0) / intervals.length;
  const intervalStdDev = Math.sqrt(intervalVariance);
  const intervalConsistency = Math.max(0, Math.min(1, 1 - intervalStdDev / avgInterval));

  const confidence = Math.round(((amountConsistency + intervalConsistency) / 2) * 100) / 100;

  const nextExpectedDate = addDays(new Date(sortedTxns[sortedTxns.length - 1].date), avgInterval);

  return {
    merchant_pattern: merchantPattern,
    occurrences: sortedTxns.length,
    total_amount: sortedTxns.reduce((sum, txn) => sum + txn.amount, 0),
    avg_amount: avgAmount,
    amount_std_dev: stdDev,
    frequency,
    avg_interval: avgInterval,
    interval_std_dev: intervalStdDev,
    confidence,
    sample_transactions: sortedTxns.slice(-5).map((txn) => ({
      identifier: txn.identifier,
      date: txn.date,
      amount: txn.amount,
      category: txn.category,
      parent_category: txn.parent_category,
      category_definition_id: txn.category_definition_id,
    })),
    monthly_equivalent:
      frequency === 'weekly'
        ? avgAmount * 4
        : frequency === 'biweekly'
          ? avgAmount * 2
          : frequency === 'quarterly'
            ? avgAmount / 3
            : frequency === 'yearly'
              ? avgAmount / 12
              : avgAmount,
    next_expected_date: nextExpectedDate,
    amount_consistency: amountConsistency,
    interval_consistency: intervalConsistency,
  };
}

function generateOptimizationSuggestions(pattern) {
  const suggestions = [];

  if (pattern.amount_consistency > 0.9 && pattern.avg_amount > 200) {
    suggestions.push({
      title: 'Consider Negotiating or Downgrading Plan',
      action:
        'Reach out to the provider to negotiate a better rate or downgrade to a lower tier plan.',
      potential_savings: pattern.avg_amount * 0.2,
    });
  }

  if (pattern.frequency === 'weekly') {
    suggestions.push({
      title: 'Weekly Charge Detected',
      action: 'Review this weekly subscription and confirm it is still necessary.',
      potential_savings: pattern.avg_amount,
    });
  }

  if (pattern.confidence > 0.8 && pattern.avg_amount > 300) {
    suggestions.push({
      title: 'High Impact Subscription',
      action: 'This subscription has a significant impact. Consider moving to annual billing for savings.',
      potential_savings: pattern.avg_amount * 0.15,
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      title: 'Monitor This Subscription',
      action: 'Monitor the usage of this recurring charge and consider alternatives if usage decreases.',
      potential_savings: pattern.avg_amount * 0.1,
    });
  }

  return suggestions;
}

async function getRecurringAnalysis(params = {}) {
  const { subMonths, differenceInDays, addDays } = await loadDateFns();
  const months = Math.max(parseInt(params.months, 10) || 6, 1);
  const minOccurrences = Math.max(parseInt(params.minOccurrences, 10) || 3, 2);
  const minConfidence = parseFloat(params.minConfidence) || DEFAULT_MIN_CONFIDENCE;

  const startDate = subMonths(new Date(), months);
  const endDate = new Date();

  const client = await database.getClient();

  try {
    const transactionsResult = await client.query(
      `
        SELECT
          t.identifier,
          t.vendor,
          t.date,
          t.name,
          ABS(t.price) AS amount,
          cd.name AS category,
          parent.name AS parent_category,
          cd.id AS category_definition_id
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
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
        WHERE t.date >= $1 AND t.date <= $2
          AND t.price < 0
          AND cd.category_type = 'expense'
          AND ap.id IS NULL
        ORDER BY t.name, t.date ASC
      `,
      [startDate, endDate],
    );

    const transactions = transactionsResult.rows.map((row) => ({
      ...row,
      amount: parseFloat(row.amount),
    }));

    const merchantGroups = groupByMerchant(transactions);
    const recurringPatterns = [];

    for (const [merchantPattern, txns] of Object.entries(merchantGroups)) {
      if (txns.length < minOccurrences) continue;

      const pattern = analyzeRecurringPattern(txns, merchantPattern, {
        differenceInDays,
        addDays,
      });
      if (pattern && pattern.confidence >= minConfidence) {
        const existingResult = await client.query(
          `
            SELECT user_status, optimization_note
            FROM recurring_transaction_analysis
            WHERE merchant_pattern = $1 AND frequency = $2
          `,
          [merchantPattern, pattern.frequency],
        );

        const existing = existingResult.rows[0];
        pattern.user_status = existing?.user_status || 'active';
        pattern.user_optimization_note = existing?.optimization_note || null;
        pattern.optimization_suggestions = generateOptimizationSuggestions(pattern);

        recurringPatterns.push(pattern);
      }
    }

    recurringPatterns.sort((a, b) => b.monthly_equivalent - a.monthly_equivalent);

    const summary = {
      total_recurring: recurringPatterns.length,
      total_monthly_cost: recurringPatterns.reduce((sum, p) => sum + p.monthly_equivalent, 0),
      by_frequency: {
        weekly: recurringPatterns.filter((p) => p.frequency === 'weekly').length,
        monthly: recurringPatterns.filter((p) => p.frequency === 'monthly').length,
        quarterly: recurringPatterns.filter((p) => p.frequency === 'quarterly').length,
        yearly: recurringPatterns.filter((p) => p.frequency === 'yearly').length,
      },
      by_status: {
        active: recurringPatterns.filter((p) => p.user_status === 'active').length,
        marked_cancel: recurringPatterns.filter((p) => p.user_status === 'marked_cancel').length,
        essential: recurringPatterns.filter((p) => p.user_status === 'essential').length,
        reviewed: recurringPatterns.filter((p) => p.user_status === 'reviewed').length,
      },
      potential_savings: recurringPatterns
        .filter((p) => p.optimization_suggestions.length > 0)
        .reduce((sum, p) => {
          const maxSaving = Math.max(...p.optimization_suggestions.map((s) => s.potential_savings || 0));
          return sum + maxSaving;
        }, 0),
    };

    return {
      period: { startDate, endDate, months },
      recurring_patterns: recurringPatterns,
      summary,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  getRecurringAnalysis,
};

module.exports.default = module.exports;
