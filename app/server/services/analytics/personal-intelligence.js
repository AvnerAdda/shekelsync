const database = require('../database.js');
const { BANK_CATEGORY_NAME } = require('../../../lib/category-constants.js');
const { validateDataQuality } = require('./data-quality-validation.js');
const { computeEnhancedHealthScore } = require('./health-score-enhanced.js');

let dateFnsPromise = null;

async function loadDateFns() {
  if (!dateFnsPromise) {
    dateFnsPromise = import('date-fns');
  }
  return dateFnsPromise;
}

function average(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values) {
  if (!values || values.length === 0) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function detectRecurringSubscriptions(transactions) {
  const groups = new Map();

  transactions.forEach((t) => {
    const name = t.name?.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, { name, amounts: [] });
    }
    groups.get(key).amounts.push(Math.abs(t.price));
  });

  const subscriptions = [];
  groups.forEach(({ name, amounts }) => {
    if (amounts.length < 2) return;
    const stdDev = standardDeviation(amounts);
    if (stdDev >= 10) return;
    const avgAmount = average(amounts);
    const totalSpent = amounts.reduce((sum, val) => sum + val, 0);
    subscriptions.push({
      name,
      occurrences: amounts.length,
      avg_amount: avgAmount,
      total_spent: totalSpent,
    });
  });

  subscriptions.sort((a, b) => b.total_spent - a.total_spent);
  return subscriptions.slice(0, 10);
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
        AND (cd.category_type = 'expense' OR cd.category_type IS NULL)
        AND COALESCE(cd.name, '') != $3
        AND COALESCE(parent.name, '') != $3
        AND ap.id IS NULL
      ORDER BY t.date ASC
      `,
      [startStr, endStr, BANK_CATEGORY_NAME],
    );

    const transactions = transactionsResult.rows.map((row) => {
      const dateObj = new Date(row.date);
      const hour = dateObj.getHours();
      const minutes = dateObj.getMinutes();
      const seconds = dateObj.getSeconds();
      const hasPreciseTime = !(hour === 0 && minutes === 0 && seconds === 0);
      return {
        ...row,
        price: parseFloat(row.price),
        date: dateObj,
        hour,
        day_of_week: dateObj.getDay(),
        hasPreciseTime,
      };
    });

    const totalExpenses = transactions.reduce((sum, t) => sum + Math.abs(t.price), 0);

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
    const currentBalance = parseFloat(total_income || 0) - parseFloat(total_expenses || 0);

    const dayCount = differenceInDays(endDate, startDate) || 1;
    const dailyBurnRate = parseFloat(period_expenses || 0) / dayCount;
    const financialRunwayDays = Math.floor(currentBalance / (dailyBurnRate || 1));

    const preciseTransactions = transactions.filter((t) => t.hasPreciseTime);
    const hourlySpending = Array(24).fill(0);
    preciseTransactions.forEach((t) => {
      const hour = Number.isFinite(t.hour) ? t.hour : 12;
      hourlySpending[hour] += Math.abs(t.price);
    });
    const peakHour = hourlySpending.indexOf(Math.max(...hourlySpending));
    const preciseTimePercentage =
      transactions.length > 0 ? Math.round((preciseTransactions.length / transactions.length) * 100) : 0;

    const earlyMonthSpend = transactions
      .filter((t) => t.date.getDate() <= 7)
      .reduce((sum, t) => sum + Math.abs(t.price), 0);
    const lateMonthSpend = transactions
      .filter((t) => t.date.getDate() >= 23)
      .reduce((sum, t) => sum + Math.abs(t.price), 0);
    const paydayEffect = earlyMonthSpend > 0 ? (earlyMonthSpend / (earlyMonthSpend + lateMonthSpend || 1)) * 100 : 50;

    const weekendSpend = transactions
      .filter((t) => [0, 6].includes(t.day_of_week))
      .reduce((sum, t) => sum + Math.abs(t.price), 0);
    const weekdaySpend = totalExpenses - weekendSpend;

    const temporalIntelligence = {
      dailyBurnRate: Math.round(dailyBurnRate),
      financialRunwayDays: financialRunwayDays > 0 ? financialRunwayDays : 0,
      currentBalance: Math.round(currentBalance),
      peakSpendingHour: peakHour,
      hourlyHeatmap: hourlySpending.map((v) => Math.round(v)),
      preciseTimePercentage,
      transactionsWithPreciseTime: preciseTransactions.length,
      totalTransactions: transactions.length,
      paydayEffect: Math.round(paydayEffect),
      earlyMonthSpend: Math.round(earlyMonthSpend),
      lateMonthSpend: Math.round(lateMonthSpend),
      weekendVsWeekday: {
        weekendSpend: Math.round(weekendSpend),
        weekdaySpend: Math.round(weekdaySpend),
        weekendPercentage: totalExpenses > 0 ? Math.round((weekendSpend / totalExpenses) * 100) : 0,
      },
    };

    const smallTransactions = transactions.filter((t) => Math.abs(t.price) < 50);
    const impulseScore = Math.min(100, (smallTransactions.length / (transactions.length || 1)) * 150);

    const morningTxns = preciseTransactions.filter((t) => t.hour >= 6 && t.hour <= 12);
    const eveningTxns = preciseTransactions.filter((t) => t.hour >= 18 && t.hour <= 23);
    const morningAvg = morningTxns.reduce((sum, t) => sum + Math.abs(t.price), 0) / (morningTxns.length || 1);
    const eveningAvg = eveningTxns.reduce((sum, t) => sum + Math.abs(t.price), 0) / (eveningTxns.length || 1);
    const decisionFatigueIndex = eveningAvg > morningAvg ? (eveningAvg / (morningAvg || 1) - 1) * 100 : 0;

    const weekendEntertainment = transactions
      .filter(
        (t) =>
          [0, 6].includes(t.day_of_week) &&
          (t.parent_category === 'אוכל' || t.parent_category === 'פנאי' || t.subcategory === 'בילויים'),
      )
      .reduce((sum, t) => sum + Math.abs(t.price), 0);
    const fomoScore = totalExpenses > 0 ? Math.round((weekendEntertainment / totalExpenses) * 200) : 0;

    const behavioralIntelligence = {
      impulseSpendingScore: Math.round(impulseScore),
      decisionFatigueIndex: Math.round(decisionFatigueIndex),
      fomoScore: Math.min(100, Math.max(0, fomoScore)),
      smallTransactionCount: smallTransactions.length,
      averageTransactionSize: Math.round(totalExpenses / (transactions.length || 1)),
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

    const coffeeTransactions = transactions.filter(
      (t) =>
        t.name?.toLowerCase().includes('קפה') ||
        t.name?.toLowerCase().includes('coffee') ||
        t.name?.toLowerCase().includes('aroma') ||
        t.name?.toLowerCase().includes('cofix'),
    );
    const coffeeSpend = coffeeTransactions.reduce((sum, t) => sum + Math.abs(t.price), 0);
    const coffeeYearly = Math.round((coffeeSpend / dayCount) * 365);

    const recurringSubscriptions = detectRecurringSubscriptions(transactions);
    const roundNumbers = transactions.filter((t) => Math.abs(t.price) % 10 === 0);
    const roundNumberPercentage =
      transactions.length > 0 ? Math.round((roundNumbers.length / transactions.length) * 100) : 0;

    const microInsights = {
      coffeeIndex: {
        monthlySpend: Math.round(coffeeSpend),
        yearlyProjection: coffeeYearly,
        transactionCount: coffeeTransactions.length,
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
      AND parent.name IS NOT NULL
      AND COALESCE(cd.name, '') != $3
      AND COALESCE(parent.name, '') != $3
      AND ap.id IS NULL
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
      avgTransactionSize: Math.round(safeDiv(totalExpenses, transactions.length)),
      financialDiversityScore,
      categoryCount,
      automationPercentage,
      costPerTransaction: Math.round(safeDiv(totalExpenses, transactions.length)),
    };

    const savingsRate = monthlyIncome > 0 ? monthlySavings / monthlyIncome : 0;

    const currentDayOfMonth = new Date().getDate();
    const daysInMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate();
    const currentMonthSpend = transactions
      .filter((t) => t.date.getMonth() === endDate.getMonth())
      .reduce((sum, t) => sum + Math.abs(t.price), 0);
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
    const avgTransactionHours = (totalExpenses / (transactions.length || 1)) / (hourlyWage || 1);

    const psychologicalInsights = {
      hourlyWage: Math.round(hourlyWage),
      avgTransactionInHours: Math.round(avgTransactionHours * 10) / 10,
      biggestPurchaseHours:
        transactions.length > 0
          ? Math.round((Math.max(...transactions.map((t) => Math.abs(t.price))) / (hourlyWage || 1)) * 10) / 10
          : 0,
      opportunityCosts: [
        {
          category: 'אוכל',
          monthlySpend: Math.round(
            transactions
              .filter((t) => t.parent_category === 'אוכל')
              .reduce((s, t) => s + Math.abs(t.price), 0),
          ),
          equivalentTo: 'טיסה לאירופה',
        },
        {
          category: 'פנאי',
          monthlySpend: Math.round(
            transactions
              .filter((t) => t.parent_category === 'פנאי')
              .reduce((s, t) => s + Math.abs(t.price), 0),
          ),
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

    return {
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
  } finally {
    client.release();
  }
}

module.exports = {
  getPersonalIntelligence,
};

module.exports.default = module.exports;
