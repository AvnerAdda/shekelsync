const database = require('../database.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { validateDataQuality } = require('./data-quality-validation.js');
const { computeEnhancedHealthScore } = require('./health-score-enhanced.js');
const { analyzeRecurringPatterns } = require('./recurring-analyzer.js');
const { createTtlCache } = require('../../../lib/server/ttl-cache.js');

let dateFnsPromise = null;
const personalIntelligenceCache = createTtlCache({ maxEntries: 10, defaultTtlMs: 60 * 1000 });

async function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

function safeDiv(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

async function getPersonalIntelligence(params = {}) {
  const { subDays, subMonths, differenceInDays } = await loadDateFns();

  const daysInt = Math.max(parseInt(params.days, 10) || 0, 0);
  const monthsInt = Math.max(parseInt(params.months, 10) || 1, 1);
  const endDate = new Date();
  const startDate = daysInt > 0 ? subDays(endDate, daysInt) : subMonths(endDate, monthsInt);
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  const skipCache =
    process.env.NODE_ENV === 'test' ||
    params.noCache === true ||
    params.noCache === 'true' ||
    params.noCache === '1';
  const cacheKey = JSON.stringify({
    start: startStr,
    end: endStr,
    days: daysInt,
    months: monthsInt,
  });

  if (!skipCache) {
    const cached = personalIntelligenceCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const client = await database.getClient();

  try {
    const profileResult = await client.query('SELECT * FROM user_profile LIMIT 1');
    const userProfile = profileResult.rows[0] || null;

    const transactionsResult = await client.query(
      `
      SELECT
        t.date,
        t.price,
        t.name,
        cd.name AS category_name,
        parent.name AS parent_category,
        CASE WHEN cd.parent_id IS NOT NULL THEN cd.name ELSE NULL END AS subcategory
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
        AND COALESCE(cd.name, '') != $3
        AND COALESCE(parent.name, '') != $3
        AND tpe.transaction_identifier IS NULL
      `,
      [startStr, endStr, BANK_CATEGORY_NAME],
    );

    const transactions = Array.isArray(transactionsResult.rows) ? transactionsResult.rows : [];
    const endMonthStr = String(endDate.getMonth() + 1).padStart(2, '0');

    const metricsResult = await client.query(
      `
      WITH filtered AS (
        SELECT
          t.date,
          t.price,
          t.name,
          parent.name AS parent_category,
          CASE WHEN cd.parent_id IS NOT NULL THEN cd.name ELSE NULL END AS subcategory,
          CAST(strftime('%w', datetime(t.date, 'localtime')) AS INTEGER) AS day_of_week,
          CAST(strftime('%d', datetime(t.date, 'localtime')) AS INTEGER) AS day_of_month,
          CAST(strftime('%H', datetime(t.date, 'localtime')) AS INTEGER) AS hour,
          strftime('%H%M%S', datetime(t.date, 'localtime')) AS time_key,
          strftime('%m', datetime(t.date, 'localtime')) AS month,
          LOWER(COALESCE(t.name, '')) AS name_lower
        FROM transactions t
        LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
        LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
        LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
          ON t.identifier = tpe.transaction_identifier
          AND t.vendor = tpe.transaction_vendor
        WHERE t.date >= $1 AND t.date <= $2
          AND t.price < 0
          AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
          AND COALESCE(cd.name, '') != $3
          AND COALESCE(parent.name, '') != $3
          AND tpe.transaction_identifier IS NULL
      )
      SELECT
        COUNT(*) as total_transactions,
        SUM(CASE WHEN day_of_month <= 7 THEN ABS(price) ELSE 0 END) AS early_month_spend,
        SUM(CASE WHEN day_of_month >= 23 THEN ABS(price) ELSE 0 END) AS late_month_spend,
        SUM(CASE WHEN day_of_week IN (0, 6) THEN ABS(price) ELSE 0 END) AS weekend_spend,
        SUM(
          CASE
            WHEN day_of_week IN (0, 6)
              AND (parent_category IN ('אוכל', 'פנאי') OR subcategory = 'בילויים')
            THEN ABS(price)
            ELSE 0
          END
        ) AS weekend_entertainment,
        SUM(CASE WHEN parent_category = 'אוכל' THEN ABS(price) ELSE 0 END) AS food_spend,
        SUM(CASE WHEN parent_category = 'פנאי' THEN ABS(price) ELSE 0 END) AS leisure_spend,
        SUM(CASE WHEN ABS(price) < 50 THEN 1 ELSE 0 END) AS small_transactions_count,
        SUM(
          CASE
            WHEN (CAST(ROUND(ABS(price) * 100) AS INTEGER) % 1000 = 0) THEN 1
            ELSE 0
          END
        ) AS round_numbers_count,
        SUM(CASE WHEN month = $4 THEN ABS(price) ELSE 0 END) AS current_month_spend,
        MAX(ABS(price)) AS max_abs_price,
        SUM(
          CASE
            WHEN (
              name_lower LIKE '%קפה%'
              OR name_lower LIKE '%coffee%'
              OR name_lower LIKE '%aroma%'
              OR name_lower LIKE '%cofix%'
            ) THEN ABS(price)
            ELSE 0
          END
        ) AS coffee_spend,
        SUM(
          CASE
            WHEN (
              name_lower LIKE '%קפה%'
              OR name_lower LIKE '%coffee%'
              OR name_lower LIKE '%aroma%'
              OR name_lower LIKE '%cofix%'
            ) THEN 1
            ELSE 0
          END
        ) AS coffee_count,
        SUM(CASE WHEN time_key != '000000' THEN 1 ELSE 0 END) AS precise_transactions_count,
        SUM(
          CASE
            WHEN time_key != '000000' AND hour BETWEEN 6 AND 12 THEN ABS(price)
            ELSE 0
          END
        ) AS morning_sum,
        SUM(
          CASE
            WHEN time_key != '000000' AND hour BETWEEN 6 AND 12 THEN 1
            ELSE 0
          END
        ) AS morning_count,
        SUM(
          CASE
            WHEN time_key != '000000' AND hour BETWEEN 18 AND 23 THEN ABS(price)
            ELSE 0
          END
        ) AS evening_sum,
        SUM(
          CASE
            WHEN time_key != '000000' AND hour BETWEEN 18 AND 23 THEN 1
            ELSE 0
          END
        ) AS evening_count
      FROM filtered
      `,
      [startStr, endStr, BANK_CATEGORY_NAME, endMonthStr],
    );

    const hourlyResult = await client.query(
      `
      SELECT
        CAST(strftime('%H', datetime(t.date, 'localtime')) AS INTEGER) AS hour,
        SUM(ABS(t.price)) AS amount
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
        AND t.price < 0
        AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
        AND COALESCE(cd.name, '') != $3
        AND COALESCE(parent.name, '') != $3
        AND tpe.transaction_identifier IS NULL
        AND strftime('%H%M%S', datetime(t.date, 'localtime')) != '000000'
      GROUP BY hour
      ORDER BY hour
      `,
      [startStr, endStr, BANK_CATEGORY_NAME],
    );

    const metrics = metricsResult.rows[0] || {};
    const hourlySpending = Array(24).fill(0);
    for (const row of hourlyResult.rows || []) {
      const hour = Number(row.hour);
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
        hourlySpending[hour] = parseFloat(row.amount || 0);
      }
    }

    const totalTransactions = Number(metrics.total_transactions || transactions.length || 0);
    const preciseTransactionsCount = Number(metrics.precise_transactions_count || 0);
    const earlyMonthSpend = parseFloat(metrics.early_month_spend || 0);
    const lateMonthSpend = parseFloat(metrics.late_month_spend || 0);
    const weekendSpend = parseFloat(metrics.weekend_spend || 0);
    const weekendEntertainment = parseFloat(metrics.weekend_entertainment || 0);
    const smallTransactionsCount = Number(metrics.small_transactions_count || 0);
    const morningSum = parseFloat(metrics.morning_sum || 0);
    const morningCount = Number(metrics.morning_count || 0);
    const eveningSum = parseFloat(metrics.evening_sum || 0);
    const eveningCount = Number(metrics.evening_count || 0);
    const coffeeSpend = parseFloat(metrics.coffee_spend || 0);
    const coffeeCount = Number(metrics.coffee_count || 0);
    const roundNumbersCount = Number(metrics.round_numbers_count || 0);
    const currentMonthSpend = parseFloat(metrics.current_month_spend || 0);
    const maxAbsPrice = parseFloat(metrics.max_abs_price || 0);
    const foodSpend = parseFloat(metrics.food_spend || 0);
    const leisureSpend = parseFloat(metrics.leisure_spend || 0);

    const balanceResult = await client.query(
      `
      SELECT
        SUM(CASE WHEN (cd.category_type = 'income' OR (cd.category_type IS NULL AND t.price > 0)) AND t.price > 0 AND t.date >= $1 AND t.date <= $2 THEN t.price ELSE 0 END) AS period_income,
        SUM(CASE WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0)) AND t.price < 0 AND t.date >= $1 AND t.date <= $2 AND COALESCE(cd.name, '') != $3 AND COALESCE(parent.name, '') != $3 THEN ABS(t.price) ELSE 0 END) AS period_expenses,
        SUM(CASE WHEN (cd.category_type = 'income' OR (cd.category_type IS NULL AND t.price > 0)) AND t.price > 0 THEN t.price ELSE 0 END) AS total_income,
        SUM(CASE WHEN (cd.category_type = 'expense' OR (cd.category_type IS NULL AND t.price < 0)) AND t.price < 0 AND COALESCE(cd.name, '') != $3 AND COALESCE(parent.name, '') != $3 THEN ABS(t.price) ELSE 0 END) AS total_expenses
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      `,
      [startStr, endStr, BANK_CATEGORY_NAME],
    );

    const { period_income, period_expenses, total_income, total_expenses } = balanceResult.rows[0];
    const totalExpenses = parseFloat(period_expenses || 0);
    const currentBalance = parseFloat(total_income || 0) - parseFloat(total_expenses || 0);

    const dayCount = differenceInDays(endDate, startDate) || 1;
    const dailyBurnRate = parseFloat(period_expenses || 0) / dayCount;
    const financialRunwayDays = Math.floor(currentBalance / (dailyBurnRate || 1));

    const peakHour = hourlySpending.indexOf(Math.max(...hourlySpending));
    const preciseTimePercentage =
      totalTransactions > 0 ? Math.round((preciseTransactionsCount / totalTransactions) * 100) : 0;
    const paydayEffect = earlyMonthSpend > 0 ? (earlyMonthSpend / (earlyMonthSpend + lateMonthSpend || 1)) * 100 : 50;
    const weekdaySpend = totalExpenses - weekendSpend;

    const temporalIntelligence = {
      dailyBurnRate: Math.round(dailyBurnRate),
      financialRunwayDays: financialRunwayDays > 0 ? financialRunwayDays : 0,
      currentBalance: Math.round(currentBalance),
      peakSpendingHour: peakHour,
      hourlyHeatmap: hourlySpending.map((v) => Math.round(v)),
      preciseTimePercentage,
      transactionsWithPreciseTime: preciseTransactionsCount,
      totalTransactions,
      paydayEffect: Math.round(paydayEffect),
      earlyMonthSpend: Math.round(earlyMonthSpend),
      lateMonthSpend: Math.round(lateMonthSpend),
      weekendVsWeekday: {
        weekendSpend: Math.round(weekendSpend),
        weekdaySpend: Math.round(weekdaySpend),
        weekendPercentage: totalExpenses > 0 ? Math.round((weekendSpend / totalExpenses) * 100) : 0,
      },
    };

    const impulseScore = Math.min(100, (smallTransactionsCount / (totalTransactions || 1)) * 150);
    const morningAvg = morningSum / (morningCount || 1);
    const eveningAvg = eveningSum / (eveningCount || 1);
    const decisionFatigueIndex = eveningAvg > morningAvg ? (eveningAvg / (morningAvg || 1) - 1) * 100 : 0;

    const fomoScore = totalExpenses > 0 ? Math.round((weekendEntertainment / totalExpenses) * 200) : 0;

    const behavioralIntelligence = {
      impulseSpendingScore: Math.round(impulseScore),
      decisionFatigueIndex: Math.round(decisionFatigueIndex),
      fomoScore: Math.min(100, Math.max(0, fomoScore)),
      smallTransactionCount: smallTransactionsCount,
      averageTransactionSize: Math.round(totalExpenses / (totalTransactions || 1)),
    };

    const age = userProfile?.age || 28;
    const income = userProfile?.monthly_income || 15000;
    const location = userProfile?.location || 'Tel Aviv';

    const periodIncome = parseFloat(period_income || 0);
    const periodExpenses = parseFloat(period_expenses || 0);
    const windowMonths = Math.max(1, (dayCount || 1) / 30);
    const monthlyIncome = periodIncome / windowMonths;
    const monthlyExpenses = periodExpenses / windowMonths;
    const monthlySavings = monthlyIncome - monthlyExpenses;

    const comparativeIntelligence = {
      ageGroup: {
        bracket: `${Math.floor(age / 5) * 5}-${Math.floor(age / 5) * 5 + 5}`,
        avgMonthlyExpense: age < 30 ? 12000 : 15000,
        yourExpense: Math.round(monthlyExpenses),
        difference: Math.round(monthlyExpenses - (age < 30 ? 12000 : 15000)),
      },
      incomeGroup: {
        bracket: `₪${Math.floor(income / 5000) * 5000}-${Math.floor(income / 5000) * 5000 + 5000}`,
        avgSavingsRate: income > 18000 ? 22 : 15,
        yourSavingsRate: periodIncome > 0 ? Math.round((monthlySavings / (monthlyIncome || 1)) * 100) : 0,
      },
      location: {
        city: location,
        avgExpense: location === 'Tel Aviv' ? 16000 : 12000,
        costOfLivingIndex: location === 'Tel Aviv' ? 130 : 100,
      },
      occupation: {
        field: userProfile?.occupation || 'Tech',
        avgFoodSpending: 3500,
        avgTransportSpending: 1200,
      },
    };

    const coffeeYearly = Math.round((coffeeSpend / dayCount) * 365);

    const { patterns: recurringPatternRows } = await analyzeRecurringPatterns({
      minOccurrences: 2,
      minConsistency: 0.3,
      minVariableAmount: 50,
      aggregateBy: 'day',
      excludeCreditCardRepayments: true,
      excludePairingExclusions: true,
      transactions,
    });

    const recurringSubscriptions = recurringPatternRows
      .filter((pattern) => (pattern.amount_stddev || 0) < 10)
      .slice(0, 10)
      .map((pattern) => ({
        name: pattern.display_name,
        occurrences: pattern.occurrence_count,
        avg_amount: pattern.detected_amount,
        total_spent: pattern.total_spent,
      }));
    const roundNumberPercentage =
      totalTransactions > 0 ? Math.round((roundNumbersCount / totalTransactions) * 100) : 0;

    const microInsights = {
      coffeeIndex: {
        monthlySpend: Math.round(coffeeSpend),
        yearlyProjection: coffeeYearly,
        transactionCount: coffeeCount,
      },
      subscriptions: recurringSubscriptions.map((s) => ({
        name: s.name,
        monthlyAmount: Math.round(s.avg_amount),
        occurrences: s.occurrences,
        totalSpent: Math.round(s.total_spent),
      })),
      roundNumberBias: roundNumberPercentage,
    };

    const categoryBreakdown = await client.query(
      `
      SELECT
        parent.name AS parent_category,
        SUM(ABS(t.price)) AS amount
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND cd.category_type = 'expense'
      AND parent.name IS NOT NULL
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
        AND tpe.transaction_identifier IS NULL
      GROUP BY parent.name
    `,
      [startStr, endStr, BANK_CATEGORY_NAME],
    );

    const categoryCount = categoryBreakdown.rows.length;
    const categoryTotals = categoryBreakdown.rows.map((c) => parseFloat(c.amount));
    const maxCategorySpend = categoryTotals.length > 0 ? Math.max(...categoryTotals) : 0;
    const financialDiversityScore = totalExpenses > 0 ? Math.round((1 - maxCategorySpend / totalExpenses) * 100) : 0;

    const recurringTotal = recurringSubscriptions.reduce((sum, r) => sum + r.total_spent, 0);
    const automationPercentage = totalExpenses > 0 ? Math.round((recurringTotal / totalExpenses) * 100) : 0;

    const efficiencyMetrics = {
      avgTransactionSize: Math.round(safeDiv(totalExpenses, totalTransactions)),
      financialDiversityScore,
      categoryCount,
      automationPercentage,
      costPerTransaction: Math.round(safeDiv(totalExpenses, totalTransactions)),
    };

    const savingsRate = monthlyIncome > 0 ? monthlySavings / monthlyIncome : 0;

    const currentDayOfMonth = new Date().getDate();
    const daysInMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate();
    const spendingVelocity = currentMonthSpend / (currentDayOfMonth || 1);
    const forecastEndMonth = Math.round(spendingVelocity * daysInMonth);

    const savingsTrajectory6m = Math.round(monthlySavings * 6);

    const predictiveAnalytics = {
      forecastEndMonth,
      currentMonthSpend: Math.round(currentMonthSpend),
      spendingVelocity: Math.round(spendingVelocity),
      savingsTrajectory6m,
      monthlySavings: Math.round(monthlySavings),
      monthlyIncome: Math.round(monthlyIncome),
      monthlyExpenses: Math.round(monthlyExpenses),
    };

    const hourlyWage = userProfile?.monthly_income ? userProfile.monthly_income / 160 : 100;
    const avgTransactionHours = (totalExpenses / (totalTransactions || 1)) / (hourlyWage || 1);

    const psychologicalInsights = {
      hourlyWage: Math.round(hourlyWage),
      avgTransactionInHours: Math.round(avgTransactionHours * 10) / 10,
      biggestPurchaseHours:
        totalTransactions > 0
          ? Math.round((maxAbsPrice / (hourlyWage || 1)) * 10) / 10
          : 0,
      opportunityCosts: [
        {
          category: 'אוכל',
          monthlySpend: Math.round(foodSpend),
          equivalentTo: 'טיסה לאירופה',
        },
        {
          category: 'פנאי',
          monthlySpend: Math.round(leisureSpend),
          equivalentTo: '2 חודשי Netflix + Spotify',
        },
      ],
    };

    const recommendations = [];

    if (recurringSubscriptions.length > 5) {
      const totalRecurring = recurringSubscriptions.reduce((s, r) => s + r.total_spent, 0);
      recommendations.push({
        type: 'subscription_audit',
        priority: 'high',
        title: 'Subscription Audit Recommended',
        message: `Found ${recurringSubscriptions.length} recurring charges totaling ₪${Math.round(
          totalRecurring,
        )}/month`,
        potentialSavings: Math.round(totalRecurring * 0.3),
        action: 'Review and cancel unused subscriptions',
      });
    }

    if (forecastEndMonth > (userProfile?.monthly_income || 20000) * 0.8) {
      recommendations.push({
        type: 'budget_warning',
        priority: 'critical',
        title: 'Budget Overrun Alert',
        message: `Projected to spend ₪${forecastEndMonth} this month`,
        action: 'Reduce spending velocity by 20%',
      });
    }

    const targetSavings = (userProfile?.monthly_income || monthlyIncome) * 0.15;
    if (monthlySavings < targetSavings) {
      recommendations.push({
        type: 'savings_goal',
        priority: monthlySavings < 0 ? 'critical' : 'medium',
        title: monthlySavings < 0 ? 'Spending More Than Earning' : 'Increase Savings Rate',
        message:
          monthlySavings < 0
            ? `Currently spending ₪${Math.abs(Math.round(monthlySavings))} more than earning per month`
            : `Currently saving ${Math.round(savingsRate * 100)}% of income`,
        action:
          monthlySavings < 0 ? 'Reduce expenses to match income' : 'Target 15-20% savings rate for financial health',
      });
    }

    if (coffeeYearly > 3000) {
      recommendations.push({
        type: 'cost_optimization',
        priority: 'low',
        title: 'Coffee Spending Optimization',
        message: `Spending ₪${coffeeYearly}/year on coffee`,
        potentialSavings: Math.round(coffeeYearly * 0.5),
        action: 'Consider home brewing or reducing frequency',
      });
    }

    const enhancedScore = await computeEnhancedHealthScore({
      months: monthsInt,
      startDate,
      endDate,
      currentBalance,
      client,
    });

    // Validate data quality and generate warnings
    const dataQuality = await validateDataQuality();

    const response = {
      generatedAt: new Date().toISOString(),
      period: { startDate, endDate, months: monthsInt, ...(daysInt > 0 ? { days: daysInt } : {}) },
      userProfile: userProfile || { message: 'Complete your profile for personalized insights' },
      temporalIntelligence,
      behavioralIntelligence,
      comparativeIntelligence,
      microInsights,
      efficiencyMetrics,
      predictiveAnalytics,
      psychologicalInsights,
      recommendations,
      overallHealthScore: enhancedScore.overallScore,
      healthBreakdown: enhancedScore.breakdown,
      healthScoreMeta: {
        adjustedBreakdown: enhancedScore.adjustedBreakdown,
        confidence: enhancedScore.confidence,
        notes: enhancedScore.notes,
        meta: enhancedScore.meta,
      },
      dataQuality,
    };
    if (!skipCache) {
      personalIntelligenceCache.set(cacheKey, response);
    }
    return response;
  } finally {
    client.release();
  }
}

module.exports = {
  getPersonalIntelligence,
};

module.exports.default = module.exports;
