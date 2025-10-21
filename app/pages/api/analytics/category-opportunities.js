import pool from '../db';

/**
 * Category Opportunities API
 * Analyzes spending patterns to identify cost reduction opportunities
 * Detects outliers, trends, and generates actionable suggestions
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { months = 6, minTransactions = 3 } = req.query;
    const monthsInt = parseInt(months);
    const minTxInt = parseInt(minTransactions);

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsInt);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Get transaction details for outlier detection
    const transactionsQuery = `
      SELECT 
        cd.id as category_definition_id,
        COALESCE(cd.name, cd.name_en, 'Unknown') as category_name,
        COALESCE(parent.id, cd.id) as parent_id,
        COALESCE(parent.name, parent.name_en, cd.name, cd.name_en) as parent_name,
        t.date,
        ABS(t.price) as amount,
        t.vendor as merchant_name,
        t.name as description
      FROM transactions t
      INNER JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE t.date >= $1
        AND t.price < 0
        AND cd.category_type = 'expense'
        AND cd.is_active = true
      ORDER BY t.date DESC;
    `;

    const transactionsResult = await pool.query(transactionsQuery, [startDateStr]);

    const actionabilityResult = await pool.query(
      `SELECT category_definition_id, actionability_level
       FROM category_actionability_settings`
    );
    const actionabilityMap = new Map(
      actionabilityResult.rows.map(row => [
        row.category_definition_id,
        row.actionability_level || 'medium',
      ])
    );

    const categorySummaries = calculateCategorySummaries(
      transactionsResult.rows,
      minTxInt,
      actionabilityMap
    );

    // Process opportunities
    const opportunities = categorySummaries.map(subcategory => {
      const subTransactions = subcategory.transactions;

      // Detect outliers (transactions > 2 standard deviations from mean)
      const outliers = detectOutliers(subTransactions, subcategory.avg_transaction_amount);

      // Analyze spending trend
      const trend = analyzeSpendingTrend(subTransactions, monthsInt);

      // Generate reduction suggestions
      const suggestions = generateReductionSuggestions(
        subcategory,
        outliers,
        trend,
        subTransactions
      );

      // Calculate opportunity score (0-100)
      const opportunityScore = calculateOpportunityScore(
        subcategory,
        outliers,
        trend,
        suggestions
      );

      return {
        category_definition_id: subcategory.category_definition_id,
        category_name: subcategory.category_name,
        parent_id: subcategory.parent_id,
        parent_name: subcategory.parent_name,
        actionability_level: subcategory.actionability_level,
        spending_summary: {
          total_spending: parseFloat(subcategory.total_spending),
          avg_monthly_spending: parseFloat(subcategory.avg_monthly_spending),
          months_active: parseInt(subcategory.months_active),
          total_transactions: parseInt(subcategory.total_transactions),
          avg_transaction_amount: parseFloat(subcategory.avg_transaction_amount),
          highest_transaction: parseFloat(subcategory.highest_transaction),
          spending_variance: parseFloat(subcategory.spending_variance) || 0
        },
        outliers: outliers.slice(0, 5), // Top 5 outliers
        trend: trend,
        suggestions: suggestions,
        opportunity_score: opportunityScore
      };
    });

    // Filter to show only actionable opportunities
    const actionableOpportunities = opportunities.filter(
      opp => opp.actionability_level !== 'low' && 
             opp.opportunity_score >= 30 &&
             opp.suggestions.length > 0
    );

    // Sort by opportunity score
    actionableOpportunities.sort((a, b) => b.opportunity_score - a.opportunity_score);

    const response = {
      period: {
        start_date: startDate,
        end_date: new Date(),
        months: monthsInt
      },
      opportunities: actionableOpportunities,
      summary: {
        total_opportunities: actionableOpportunities.length,
        total_potential_savings: actionableOpportunities.reduce(
          (sum, opp) => sum + opp.suggestions.reduce((s, sug) => s + (sug.potential_savings || 0), 0),
          0
        ),
        high_priority_count: actionableOpportunities.filter(o => o.opportunity_score >= 70).length,
        medium_priority_count: actionableOpportunities.filter(o => o.opportunity_score >= 50 && o.opportunity_score < 70).length
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error analyzing category opportunities:', error);
    res.status(500).json({ error: 'Failed to analyze opportunities', details: error.message });
  }
}

function calculateCategorySummaries(transactions, minTransactions, actionabilityMap) {
  const categories = new Map();

  transactions.forEach(txn => {
    const categoryId = txn.category_definition_id;
    if (!categories.has(categoryId)) {
      categories.set(categoryId, {
        category_definition_id: categoryId,
        category_name: txn.category_name,
        parent_id: txn.parent_id,
        parent_name: txn.parent_name,
        actionability_level: actionabilityMap.get(categoryId) || 'medium',
        transactions: [],
        total_spending: 0,
        total_transactions: 0,
        highest_transaction: 0,
        monthTotals: new Map(),
      });
    }

    const summary = categories.get(categoryId);
    summary.transactions.push(txn);
    summary.total_spending += txn.amount;
    summary.total_transactions += 1;
    summary.highest_transaction = Math.max(summary.highest_transaction, txn.amount);

    const monthKey = new Date(txn.date).toISOString().slice(0, 7);
    summary.monthTotals.set(
      monthKey,
      (summary.monthTotals.get(monthKey) || 0) + txn.amount
    );
  });

  const summaries = [];

  categories.forEach(summary => {
    const monthsActive = summary.monthTotals.size;
    if (summary.total_transactions < minTransactions || monthsActive === 0) {
      return;
    }

    const avgMonthlySpending = summary.total_spending / monthsActive;
    const monthValues = Array.from(summary.monthTotals.values());
    const spendingVariance = calculateStdDev(monthValues);
    const avgTransactionAmount = summary.total_spending / summary.total_transactions;

    summaries.push({
      ...summary,
      months_active: monthsActive,
      avg_monthly_spending: avgMonthlySpending,
      spending_variance: spendingVariance,
      avg_transaction_amount: avgTransactionAmount,
      highest_transaction: summary.highest_transaction,
    });
  });

  summaries.sort((a, b) => b.total_spending - a.total_spending);
  return summaries;
}

function calculateStdDev(values) {
  if (!values || values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Detect outlier transactions (>2 std deviations from mean)
 */
function detectOutliers(transactions, avgAmount) {
  if (!transactions || transactions.length === 0) return [];

  const amounts = transactions.map(t => t.amount);
  const mean = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
  const variance = amounts.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);

  const threshold = mean + (2 * stdDev);

  return transactions
    .filter(t => t.amount > threshold)
    .map(t => ({
      date: t.date,
      amount: t.amount,
      merchant_name: t.merchant_name,
      description: t.description,
      deviation: ((t.amount - mean) / mean * 100).toFixed(1)
    }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Analyze spending trend (increasing, decreasing, stable)
 */
function analyzeSpendingTrend(transactions, totalMonths) {
  if (!transactions || transactions.length < 2) {
    return { direction: 'stable', change_percentage: 0, description: 'Insufficient data' };
  }

  // Group by month
  const monthlyTotals = {};
  transactions.forEach(t => {
    const monthKey = new Date(t.date).toISOString().substring(0, 7); // YYYY-MM
    monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + t.amount;
  });

  const months = Object.keys(monthlyTotals).sort();
  if (months.length < 2) {
    return { direction: 'stable', change_percentage: 0, description: 'Insufficient data' };
  }

  // Compare first half vs second half
  const midpoint = Math.floor(months.length / 2);
  const firstHalf = months.slice(0, midpoint);
  const secondHalf = months.slice(midpoint);

  const firstHalfAvg = firstHalf.reduce((sum, m) => sum + monthlyTotals[m], 0) / firstHalf.length;
  const secondHalfAvg = secondHalf.reduce((sum, m) => sum + monthlyTotals[m], 0) / secondHalf.length;

  const changePercentage = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg * 100);

  let direction = 'stable';
  let description = 'Spending is consistent';

  if (changePercentage > 15) {
    direction = 'increasing';
    description = `Spending increased by ${changePercentage.toFixed(1)}% recently`;
  } else if (changePercentage < -15) {
    direction = 'decreasing';
    description = `Spending decreased by ${Math.abs(changePercentage).toFixed(1)}% recently`;
  }

  return {
    direction,
    change_percentage: changePercentage,
    description,
    first_half_avg: firstHalfAvg,
    second_half_avg: secondHalfAvg
  };
}

/**
 * Generate actionable reduction suggestions
 */
function generateReductionSuggestions(subcategory, outliers, trend, transactions) {
  const suggestions = [];
  const avgMonthly = subcategory.avg_monthly_spending;
  const categoryName = subcategory.category_name;

  // 1. Outlier-based suggestion
  if (outliers.length > 0) {
    const outlierSum = outliers.reduce((sum, o) => sum + o.amount, 0);
    const normalSum = transactions.reduce((sum, t) => sum + t.amount, 0) - outlierSum;
    const potentialSavings = outlierSum * 0.3; // Assume 30% reduction possible

    suggestions.push({
      type: 'reduce_outliers',
      priority: 'high',
      title: 'Reduce Large Transactions',
      description: `You have ${outliers.length} unusually large transactions in ${categoryName}. Review these purchases for potential alternatives or bulk buying opportunities.`,
      potential_savings: potentialSavings,
      action_items: [
        'Review the largest transactions listed',
        'Look for bulk buying or wholesale alternatives',
        'Set a spending limit alert for this category',
        `Consider if all purchases are necessary`
      ]
    });
  }

  // 2. Trend-based suggestion
  if (trend.direction === 'increasing' && trend.change_percentage > 20) {
    const excessSpending = trend.second_half_avg - trend.first_half_avg;
    
    suggestions.push({
      type: 'reverse_trend',
      priority: 'high',
      title: 'Reverse Increasing Trend',
      description: `${categoryName} spending has increased by ${trend.change_percentage.toFixed(1)}% recently. Identify what changed and consider reverting to previous spending levels.`,
      potential_savings: excessSpending,
      action_items: [
        'Identify what caused the spending increase',
        'Review recent purchase decisions',
        'Set a monthly budget based on previous average',
        'Track spending more closely this month'
      ]
    });
  }

  // 3. High frequency suggestion
  const avgTransactionsPerMonth = subcategory.total_transactions / subcategory.months_active;
  if (avgTransactionsPerMonth > 15) {
    const consolidationSavings = avgMonthly * 0.10; // 10% through consolidation

    suggestions.push({
      type: 'consolidate_purchases',
      priority: 'medium',
      title: 'Consolidate Purchases',
      description: `You make ~${Math.round(avgTransactionsPerMonth)} transactions per month in ${categoryName}. Consolidating purchases could reduce impulse buying and save time.`,
      potential_savings: consolidationSavings,
      action_items: [
        'Plan purchases in advance (weekly/monthly)',
        'Make a shopping list before buying',
        'Reduce shopping frequency',
        'Avoid impulse purchases by batching needs'
      ]
    });
  }

  // 4. Category-specific suggestions
  const specificSuggestions = getCategorySpecificSuggestions(
    categoryName,
    subcategory,
    transactions
  );
  suggestions.push(...specificSuggestions);

  // 5. General optimization if high spending
  if (avgMonthly > 500 && suggestions.length === 0) {
    suggestions.push({
      type: 'general_optimization',
      priority: 'medium',
      title: 'Optimize High Spending Category',
      description: `${categoryName} is a significant expense (₪${avgMonthly.toFixed(0)}/month). Even small percentage reductions can lead to meaningful savings.`,
      potential_savings: avgMonthly * 0.15, // 15% potential
      action_items: [
        'Research cheaper alternatives',
        'Negotiate better rates with providers',
        'Look for loyalty discounts or coupons',
        'Review if all expenses are necessary'
      ]
    });
  }

  return suggestions;
}

/**
 * Get category-specific optimization suggestions
 */
function getCategorySpecificSuggestions(categoryName, subcategory, transactions) {
  const suggestions = [];
  const avgMonthly = subcategory.avg_monthly_spending;
  const lower = categoryName.toLowerCase();

  // Food & Groceries
  if (lower.includes('food') || lower.includes('מזון') || lower.includes('grocery') || lower.includes('סופר')) {
    suggestions.push({
      type: 'meal_planning',
      priority: 'medium',
      title: 'Implement Meal Planning',
      description: 'Plan meals weekly and create shopping lists to reduce food waste and impulse purchases.',
      potential_savings: avgMonthly * 0.20,
      action_items: [
        'Plan meals for the week every Sunday',
        'Create detailed shopping lists',
        'Buy generic brands where quality is similar',
        'Reduce dining out by cooking more at home',
        'Track food waste and adjust purchases'
      ]
    });
  }

  // Dining & Restaurants
  if (lower.includes('dining') || lower.includes('restaurant') || lower.includes('משלוחים') || lower.includes('מסעד')) {
    suggestions.push({
      type: 'reduce_dining_out',
      priority: 'high',
      title: 'Reduce Dining Out Frequency',
      description: 'Dining out is significantly more expensive than home cooking. Set a monthly limit.',
      potential_savings: avgMonthly * 0.30,
      action_items: [
        `Set a monthly dining out budget (e.g., ₪${(avgMonthly * 0.7).toFixed(0)})`,
        'Cook meals at home more often',
        'Bring lunch to work instead of buying',
        'Reserve restaurants for special occasions',
        'Use lunch specials when dining out'
      ]
    });
  }

  // Transportation
  if (lower.includes('transport') || lower.includes('fuel') || lower.includes('תחבורה') || lower.includes('דלק')) {
    suggestions.push({
      type: 'optimize_transportation',
      priority: 'medium',
      title: 'Optimize Transportation Costs',
      description: 'Explore alternative transportation methods or carpooling options.',
      potential_savings: avgMonthly * 0.25,
      action_items: [
        'Compare public transport vs. driving costs',
        'Consider carpooling with colleagues',
        'Combine errands to reduce trips',
        'Maintain vehicle properly to improve fuel efficiency',
        'Explore bike or walking for short distances'
      ]
    });
  }

  // Entertainment
  if (lower.includes('entertainment') || lower.includes('בילויים') || lower.includes('hobby')) {
    suggestions.push({
      type: 'budget_entertainment',
      priority: 'low',
      title: 'Set Entertainment Budget',
      description: 'Entertainment is flexible spending - set clear limits while maintaining enjoyment.',
      potential_savings: avgMonthly * 0.20,
      action_items: [
        'Set a fixed monthly entertainment budget',
        'Look for free or low-cost activities',
        'Take advantage of discounts and promotions',
        'Alternate expensive outings with budget-friendly ones',
        'Review streaming subscriptions for duplication'
      ]
    });
  }

  // Shopping & Clothing
  if (lower.includes('shopping') || lower.includes('clothing') || lower.includes('קניות') || lower.includes('בגדים')) {
    suggestions.push({
      type: 'mindful_shopping',
      priority: 'medium',
      title: 'Practice Mindful Shopping',
      description: 'Implement a waiting period before purchases to reduce impulse buying.',
      potential_savings: avgMonthly * 0.35,
      action_items: [
        'Wait 24-48 hours before non-essential purchases',
        'Unsubscribe from promotional emails',
        'Shop sales and clearance sections',
        'Buy quality items that last longer',
        'Maintain a wish list to avoid impulse buys'
      ]
    });
  }

  return suggestions;
}

/**
 * Calculate opportunity score (0-100)
 * Higher score = better opportunity for savings
 */
function calculateOpportunityScore(subcategory, outliers, trend, suggestions) {
  let score = 0;

  // Factor 1: Spending amount (max 30 points)
  const monthlySpending = subcategory.avg_monthly_spending;
  if (monthlySpending > 1000) score += 30;
  else if (monthlySpending > 500) score += 20;
  else if (monthlySpending > 200) score += 10;
  else score += 5;

  // Factor 2: Actionability level (max 25 points)
  if (subcategory.actionability_level === 'high') score += 25;
  else if (subcategory.actionability_level === 'medium') score += 15;
  else score += 5;

  // Factor 3: Outliers present (max 20 points)
  if (outliers.length >= 5) score += 20;
  else if (outliers.length >= 3) score += 15;
  else if (outliers.length >= 1) score += 10;

  // Factor 4: Increasing trend (max 15 points)
  if (trend.direction === 'increasing' && trend.change_percentage > 20) score += 15;
  else if (trend.direction === 'increasing' && trend.change_percentage > 10) score += 10;
  else if (trend.direction === 'stable') score += 5;

  // Factor 5: Number of suggestions (max 10 points)
  score += Math.min(suggestions.length * 3, 10);

  return Math.min(Math.round(score), 100);
}
