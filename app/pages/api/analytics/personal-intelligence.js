import { getDB } from '../db.js';
import { subMonths, differenceInDays, format, parseISO } from 'date-fns';

/**
 * Personal Financial Intelligence API
 * Provides never-before-seen insights: behavioral patterns, temporal analysis,
 * peer comparisons, micro-insights, and predictive analytics
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { months = 3 } = req.query;
    const endDate = new Date();
    const startDate = subMonths(endDate, parseInt(months));

    // Fetch user profile for contextual benchmarking
    const profileResult = await client.query('SELECT * FROM user_profile LIMIT 1');
    const userProfile = profileResult.rows[0] || null;

    // ============================================================
    // 1. TEMPORAL INTELLIGENCE - "Your Financial Rhythm"
    // ============================================================

    // Get all transactions with hour extraction
    const transactionsResult = await client.query(`
      SELECT
        date,
        price,
        parent_category,
        name,
        EXTRACT(HOUR FROM date::timestamp) as hour,
        EXTRACT(DOW FROM date) as day_of_week
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      ORDER BY date ASC
    `, [startDate, endDate]);

    const transactions = transactionsResult.rows;
    const totalExpenses = transactions.reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0);
    const dayCount = differenceInDays(endDate, startDate) || 1;
    const dailyBurnRate = totalExpenses / dayCount;

    // Get latest balance (total income - total expenses)
    const balanceResult = await client.query(`
      SELECT
        SUM(CASE WHEN price > 0 THEN price ELSE 0 END) as total_income,
        SUM(CASE WHEN price < 0 THEN ABS(price) ELSE 0 END) as total_expenses
      FROM transactions
    `);
    const { total_income, total_expenses } = balanceResult.rows[0];
    const currentBalance = parseFloat(total_income || 0) - parseFloat(total_expenses || 0);
    const financialRunwayDays = Math.floor(currentBalance / dailyBurnRate);

    // Peak spending hours (heatmap data)
    const hourlySpending = Array(24).fill(0);
    transactions.forEach(t => {
      const hour = parseInt(t.hour) || 12;
      hourlySpending[hour] += Math.abs(parseFloat(t.price));
    });
    const peakHour = hourlySpending.indexOf(Math.max(...hourlySpending));

    // Payday effect (spending in first 7 days vs last 7 days of month)
    const earlyMonthSpend = transactions
      .filter(t => new Date(t.date).getDate() <= 7)
      .reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0);
    const lateMonthSpend = transactions
      .filter(t => new Date(t.date).getDate() >= 23)
      .reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0);
    const paydayEffect = earlyMonthSpend > 0 ? (earlyMonthSpend / (earlyMonthSpend + lateMonthSpend) * 100) : 50;

    // Weekend vs Weekday spending
    const weekendSpend = transactions
      .filter(t => [0, 6].includes(parseInt(t.day_of_week)))
      .reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0);
    const weekdaySpend = totalExpenses - weekendSpend;

    const temporalIntelligence = {
      dailyBurnRate: Math.round(dailyBurnRate),
      financialRunwayDays: financialRunwayDays > 0 ? financialRunwayDays : 0,
      currentBalance: Math.round(currentBalance),
      peakSpendingHour: peakHour,
      hourlyHeatmap: hourlySpending.map(v => Math.round(v)),
      paydayEffect: Math.round(paydayEffect),
      earlyMonthSpend: Math.round(earlyMonthSpend),
      lateMonthSpend: Math.round(lateMonthSpend),
      weekendVsWeekday: {
        weekendSpend: Math.round(weekendSpend),
        weekdaySpend: Math.round(weekdaySpend),
        weekendPercentage: Math.round((weekendSpend / totalExpenses) * 100)
      }
    };

    // ============================================================
    // 2. BEHAVIORAL INTELLIGENCE - "Your Money Personality"
    // ============================================================

    // Impulse spending score (small transactions, rapid succession)
    const smallTransactions = transactions.filter(t => Math.abs(parseFloat(t.price)) < 50);
    const impulseScore = Math.min(100, (smallTransactions.length / transactions.length) * 150);

    // Decision fatigue index (are evening transactions larger/smaller than morning?)
    const morningTxns = transactions.filter(t => parseInt(t.hour) >= 6 && parseInt(t.hour) <= 12);
    const eveningTxns = transactions.filter(t => parseInt(t.hour) >= 18 && parseInt(t.hour) <= 23);
    const morningAvg = morningTxns.reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0) / (morningTxns.length || 1);
    const eveningAvg = eveningTxns.reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0) / (eveningTxns.length || 1);
    const decisionFatigueIndex = eveningAvg > morningAvg ? ((eveningAvg / morningAvg - 1) * 100) : 0;

    // Financial FOMO (weekend entertainment spending)
    const weekendEntertainment = transactions
      .filter(t =>
        [0, 6].includes(parseInt(t.day_of_week)) &&
        (t.parent_category === 'בילויים' || t.parent_category === 'אוכל')
      )
      .reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0);
    const fomoScore = Math.round((weekendEntertainment / totalExpenses) * 200);

    const behavioralIntelligence = {
      impulseSpendingScore: Math.round(impulseScore),
      decisionFatigueIndex: Math.round(decisionFatigueIndex),
      fomoScore: Math.min(100, fomoScore),
      smallTransactionCount: smallTransactions.length,
      averageTransactionSize: Math.round(totalExpenses / transactions.length)
    };

    // ============================================================
    // 3. COMPARATIVE INTELLIGENCE - "How You Compare" (Placeholders)
    // ============================================================

    // Generate realistic Israeli benchmarks based on user profile
    const age = userProfile?.age || 28;
    const income = userProfile?.monthly_income || 15000;
    const location = userProfile?.location || 'Tel Aviv';

    // Realistic Israeli benchmarks (will be replaced with LLM later)
    const comparativeIntelligence = {
      ageGroup: {
        bracket: `${Math.floor(age/5)*5}-${Math.floor(age/5)*5+5}`,
        avgMonthlyExpense: age < 30 ? 12000 : 15000,
        yourExpense: Math.round(totalExpenses / parseInt(months)),
        difference: Math.round((totalExpenses / parseInt(months)) - (age < 30 ? 12000 : 15000))
      },
      incomeGroup: {
        bracket: `₪${Math.floor(income/5000)*5000}-${Math.floor(income/5000)*5000+5000}`,
        avgSavingsRate: income > 18000 ? 22 : 15,
        yourSavingsRate: currentBalance > 0 ? Math.round((currentBalance / (total_income || 1)) * 100) : 0
      },
      location: {
        city: location,
        avgExpense: location === 'Tel Aviv' ? 16000 : 12000,
        costOfLivingIndex: location === 'Tel Aviv' ? 130 : 100
      },
      occupation: {
        field: userProfile?.occupation || 'Tech',
        avgFoodSpending: 3500,
        avgTransportSpending: 1200
      }
    };

    // ============================================================
    // 4. MICRO-INSIGHTS - "The Small Things That Matter"
    // ============================================================

    // Coffee/cafe spending
    const coffeeTransactions = transactions.filter(t =>
      t.name?.toLowerCase().includes('קפה') ||
      t.name?.toLowerCase().includes('coffee') ||
      t.name?.toLowerCase().includes('aroma') ||
      t.name?.toLowerCase().includes('cofix')
    );
    const coffeeSpend = coffeeTransactions.reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0);
    const coffeeYearly = Math.round((coffeeSpend / dayCount) * 365);

    // Recurring subscriptions detection
    const recurringResult = await client.query(`
      SELECT
        name,
        COUNT(*) as occurrences,
        AVG(ABS(price)) as avg_amount,
        SUM(ABS(price)) as total_spent
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      GROUP BY name
      HAVING COUNT(*) >= 2
      AND STDDEV(ABS(price)) < 10
      ORDER BY total_spent DESC
      LIMIT 10
    `, [startDate, endDate]);

    // Round number bias
    const roundNumbers = transactions.filter(t => Math.abs(parseFloat(t.price)) % 10 === 0);
    const roundNumberPercentage = Math.round((roundNumbers.length / transactions.length) * 100);

    const microInsights = {
      coffeeIndex: {
        monthlySpend: Math.round(coffeeSpend),
        yearlyProjection: coffeeYearly,
        transactionCount: coffeeTransactions.length
      },
      subscriptions: recurringResult.rows.map(s => ({
        name: s.name,
        monthlyAmount: Math.round(parseFloat(s.avg_amount)),
        occurrences: parseInt(s.occurrences),
        totalSpent: Math.round(parseFloat(s.total_spent))
      })),
      roundNumberBias: roundNumberPercentage
    };

    // ============================================================
    // 5. EFFICIENCY METRICS - "Financial Health Score"
    // ============================================================

    // Financial diversity (how spread out spending is)
    const categoryBreakdown = await client.query(`
      SELECT
        parent_category,
        SUM(ABS(price)) as amount
      FROM transactions
      WHERE date >= $1 AND date <= $2
      AND price < 0
      AND parent_category IS NOT NULL
      GROUP BY parent_category
    `, [startDate, endDate]);

    const categoryCount = categoryBreakdown.rows.length;
    const maxCategorySpend = Math.max(...categoryBreakdown.rows.map(c => parseFloat(c.amount)));
    const financialDiversityScore = Math.round((1 - (maxCategorySpend / totalExpenses)) * 100);

    // Automation percentage (recurring vs one-time)
    const recurringTotal = recurringResult.rows.reduce((sum, r) => sum + parseFloat(r.total_spent), 0);
    const automationPercentage = Math.round((recurringTotal / totalExpenses) * 100);

    const efficiencyMetrics = {
      avgTransactionSize: Math.round(totalExpenses / transactions.length),
      financialDiversityScore,
      categoryCount,
      automationPercentage,
      costPerTransaction: Math.round(totalExpenses / transactions.length)
    };

    // ============================================================
    // 6. PREDICTIVE ANALYTICS - "Your Financial Future"
    // ============================================================

    // End of month forecast based on current velocity
    const currentDayOfMonth = new Date().getDate();
    const daysInMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate();
    const currentMonthSpend = transactions
      .filter(t => new Date(t.date).getMonth() === endDate.getMonth())
      .reduce((sum, t) => sum + Math.abs(parseFloat(t.price)), 0);
    const spendingVelocity = currentMonthSpend / currentDayOfMonth;
    const forecastEndMonth = Math.round(spendingVelocity * daysInMonth);

    // 6-month savings trajectory
    const monthlySavings = parseFloat(total_income || 0) / 6 - (totalExpenses / parseInt(months));
    const savingsTrajectory6m = Math.round(monthlySavings * 6);

    const predictiveAnalytics = {
      forecastEndMonth,
      currentMonthSpend: Math.round(currentMonthSpend),
      spendingVelocity: Math.round(spendingVelocity),
      savingsTrajectory6m,
      monthlySavings: Math.round(monthlySavings)
    };

    // ============================================================
    // 7. PSYCHOLOGICAL INSIGHTS - "Make It Real"
    // ============================================================

    const hourlyWage = userProfile?.monthly_income ? (userProfile.monthly_income / 160) : 100;
    const avgTransactionHours = (totalExpenses / transactions.length) / hourlyWage;

    const psychologicalInsights = {
      hourlyWage: Math.round(hourlyWage),
      avgTransactionInHours: avgTransactionHours.toFixed(1),
      biggestPurchaseHours: transactions.length > 0
        ? Math.round(Math.max(...transactions.map(t => Math.abs(parseFloat(t.price)))) / hourlyWage * 10) / 10
        : 0,
      opportunityCosts: [
        {
          category: 'אוכל',
          monthlySpend: Math.round(transactions.filter(t => t.parent_category === 'אוכל').reduce((s, t) => s + Math.abs(parseFloat(t.price)), 0)),
          equivalentTo: 'טיסה לאירופה'
        },
        {
          category: 'בילויים',
          monthlySpend: Math.round(transactions.filter(t => t.parent_category === 'בילויים').reduce((s, t) => s + Math.abs(parseFloat(t.price)), 0)),
          equivalentTo: '2 חודשי Netflix + Spotify'
        }
      ]
    };

    // ============================================================
    // 8. ACTION RECOMMENDATIONS - "What You Should Do Next"
    // ============================================================

    const recommendations = [];

    // Subscription waste
    if (recurringResult.rows.length > 5) {
      const totalRecurring = recurringResult.rows.reduce((s, r) => s + parseFloat(r.total_spent), 0);
      recommendations.push({
        type: 'subscription_audit',
        priority: 'high',
        title: 'Subscription Audit Recommended',
        message: `Found ${recurringResult.rows.length} recurring charges totaling ₪${Math.round(totalRecurring)}/month`,
        potentialSavings: Math.round(totalRecurring * 0.3),
        action: 'Review and cancel unused subscriptions'
      });
    }

    // Budget overrun warning
    if (forecastEndMonth > (userProfile?.monthly_income || 20000) * 0.8) {
      recommendations.push({
        type: 'budget_warning',
        priority: 'critical',
        title: 'Budget Overrun Alert',
        message: `Projected to spend ₪${forecastEndMonth} this month`,
        action: 'Reduce spending velocity by 20%'
      });
    }

    // Savings opportunity
    if (monthlySavings < (userProfile?.monthly_income || 15000) * 0.15) {
      recommendations.push({
        type: 'savings_goal',
        priority: 'medium',
        title: 'Increase Savings Rate',
        message: `Currently saving ${Math.round((monthlySavings / (userProfile?.monthly_income || 15000)) * 100)}% of income`,
        action: 'Target 15-20% savings rate for financial health'
      });
    }

    // Coffee optimization
    if (coffeeYearly > 3000) {
      recommendations.push({
        type: 'cost_optimization',
        priority: 'low',
        title: 'Coffee Spending Optimization',
        message: `Spending ₪${coffeeYearly}/year on coffee`,
        potentialSavings: Math.round(coffeeYearly * 0.5),
        action: 'Consider home brewing or reducing frequency'
      });
    }

    // ============================================================
    // 9. OVERALL FINANCIAL HEALTH SCORE
    // ============================================================

    const savingsScore = Math.min(100, (monthlySavings / (userProfile?.monthly_income || 15000)) * 400);
    const diversityScore = financialDiversityScore;
    const impulseHealthScore = Math.max(0, 100 - impulseScore);
    const runwayScore = Math.min(100, financialRunwayDays / 60 * 100);

    const overallHealthScore = Math.round((savingsScore + diversityScore + impulseHealthScore + runwayScore) / 4);

    // Response
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      period: { startDate, endDate, months: parseInt(months) },
      userProfile: userProfile || { message: 'Complete your profile for personalized insights' },

      temporalIntelligence,
      behavioralIntelligence,
      comparativeIntelligence,
      microInsights,
      efficiencyMetrics,
      predictiveAnalytics,
      psychologicalInsights,
      recommendations,

      overallHealthScore,
      healthBreakdown: {
        savingsScore: Math.round(savingsScore),
        diversityScore: Math.round(diversityScore),
        impulseScore: Math.round(impulseHealthScore),
        runwayScore: Math.round(runwayScore)
      }
    });

  } catch (error) {
    console.error('Error in personal intelligence API:', error);
    res.status(500).json({
      error: 'Failed to generate personal intelligence',
      details: error.message
    });
  } finally {
    client.release();
  }
}
