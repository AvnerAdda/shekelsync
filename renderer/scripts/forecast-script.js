#!/usr/bin/env node

/**
 * Financial Forecasting Script
 * Predicts next month's financial metrics based on 3 months of historical data
 *
 * Usage: node scripts/forecast-script.js [options]
 *
 * Options:
 *   --exclude-outliers    Exclude statistical outliers from calculations
 *   --months <n>          Number of months to analyze (default: 3)
 *   --export-json         Export forecast to JSON file
 *   --export-chart        Export chart-ready data
 *   --verbose             Show detailed calculations
 *   --help                Show this help message
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== CONFIGURATION ====================
const preferredDbPath = path.join(__dirname, '../../dist/shekelsync.sqlite');
const legacyDbPath = path.join(__dirname, '../../dist/clarify.sqlite');
const CONFIG = {
  dbPath: fs.existsSync(preferredDbPath) ? preferredDbPath : fs.existsSync(legacyDbPath) ? legacyDbPath : preferredDbPath,
  outputDir: path.join(__dirname),
  analysisMonths: 3,
  excludeOutliers: false,
  verbose: false,
  exportJson: false,
  exportChart: false,
};

// Parse command line arguments
process.argv.slice(2).forEach(arg => {
  if (arg === '--exclude-outliers') CONFIG.excludeOutliers = true;
  if (arg === '--verbose') CONFIG.verbose = true;
  if (arg === '--export-json') CONFIG.exportJson = true;
  if (arg === '--export-chart') CONFIG.exportChart = true;
  if (arg.startsWith('--months=')) CONFIG.analysisMonths = parseInt(arg.split('=')[1]);
  if (arg === '--help') {
    console.log(__doc__);
    process.exit(0);
  }
});

// ==================== DATABASE QUERIES ====================

/**
 * Get complete months of transaction data for analysis
 */
function getHistoricalData(db, months = 3) {
  // Get last N complete months
  const query = `
    WITH monthly_aggregates AS (
      SELECT
        strftime('%Y-%m', date) as month,
        strftime('%Y-%m-01', date) as month_start,
        category_type,
        category_definition_id,
        cd.name as category_name,
        cd.parent_id,
        parent_cd.name as parent_category_name,
        SUM(CASE WHEN category_type = 'expense' THEN ABS(price) ELSE 0 END) as total_expenses,
        SUM(CASE WHEN category_type = 'income' THEN price ELSE 0 END) as total_income,
        SUM(CASE WHEN category_type = 'investment' THEN ABS(price) ELSE 0 END) as total_investments,
        COUNT(*) as transaction_count,
        price,
        identifier,
        vendor,
        name as transaction_name,
        date
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
      WHERE
        date >= date('now', 'start of month', '-${months} months')
        AND date < date('now', 'start of month')
        AND status = 'completed'
      GROUP BY month, category_type
    )
    SELECT * FROM monthly_aggregates
    ORDER BY month;
  `;

  const rows = db.prepare(query).all();

  // Also get detailed transaction data for pattern analysis
  const detailedQuery = `
    SELECT
      t.identifier,
      t.vendor,
      t.vendor_nickname,
      t.date,
      t.name,
      t.price,
      t.type,
      t.category_type,
      strftime('%Y-%m', t.date) as month,
      cd.id as category_id,
      cd.name as category_name,
      parent_cd.name as parent_category_name,
      cd.category_type
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
    WHERE
      t.date >= date('now', 'start of month', '-${months} months')
      AND t.date < date('now', 'start of month')
      AND t.status = 'completed'
    ORDER BY t.date;
  `;

  const transactions = db.prepare(detailedQuery).all();

  return { aggregates: rows, transactions };
}

/**
 * Get monthly summaries for each category
 */
function getCategorySummaries(db, months = 3) {
  const query = `
    SELECT
      strftime('%Y-%m', t.date) as month,
      cd.id as category_id,
      cd.name as category_name,
      parent_cd.name as parent_category_name,
      t.category_type,
      COUNT(*) as transaction_count,
      SUM(ABS(t.price)) as total_amount,
      AVG(ABS(t.price)) as avg_transaction,
      MIN(ABS(t.price)) as min_amount,
      MAX(ABS(t.price)) as max_amount
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
    WHERE
      t.date >= date('now', 'start of month', '-${months} months')
      AND t.date < date('now', 'start of month')
      AND t.status = 'completed'
      AND t.category_type = 'expense'
    GROUP BY month, category_id, category_name
    ORDER BY month, total_amount DESC;
  `;

  return db.prepare(query).all();
}

/**
 * Get monthly totals (high-level summary)
 */
function getMonthlyTotals(db, months = 3) {
  const query = `
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(CASE WHEN category_type = 'expense' THEN ABS(price) ELSE 0 END) as total_expenses,
      SUM(CASE WHEN category_type = 'income' THEN price ELSE 0 END) as total_income,
      SUM(CASE WHEN category_type = 'investment' THEN ABS(price) ELSE 0 END) as total_investments,
      COUNT(*) as transaction_count
    FROM transactions
    WHERE
      date >= date('now', 'start of month', '-${months} months')
      AND date < date('now', 'start of month')
      AND status = 'completed'
    GROUP BY month
    ORDER BY month;
  `;

  return db.prepare(query).all();
}

// ==================== STATISTICAL FUNCTIONS ====================

/**
 * Calculate mean of an array
 */
function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values) {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  const avgSquareDiff = mean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

/**
 * Detect outliers using IQR method
 */
function detectOutliers(values) {
  if (values.length < 4) return { outliers: [], clean: values };

  const sorted = [...values].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);

  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;

  const lowerBound = q1 - (1.5 * iqr);
  const upperBound = q3 + (1.5 * iqr);

  const outliers = values.filter(v => v < lowerBound || v > upperBound);
  const clean = values.filter(v => v >= lowerBound && v <= upperBound);

  return { outliers, clean, lowerBound, upperBound };
}

/**
 * Calculate linear regression
 */
function linearRegression(xValues, yValues) {
  const n = xValues.length;
  if (n === 0) return { slope: 0, intercept: 0, predict: () => 0 };

  const sumX = xValues.reduce((sum, x) => sum + x, 0);
  const sumY = yValues.reduce((sum, y) => sum + y, 0);
  const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
  const sumX2 = xValues.reduce((sum, x) => sum + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return {
    slope,
    intercept,
    predict: (x) => slope * x + intercept,
    rSquared: calculateRSquared(xValues, yValues, slope, intercept)
  };
}

/**
 * Calculate R-squared (coefficient of determination)
 */
function calculateRSquared(xValues, yValues, slope, intercept) {
  const yMean = mean(yValues);
  const ssTot = yValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
  const ssRes = yValues.reduce((sum, y, i) => {
    const predicted = slope * xValues[i] + intercept;
    return sum + Math.pow(y - predicted, 2);
  }, 0);

  return 1 - (ssRes / ssTot);
}

// ==================== PATTERN DETECTION ====================

/**
 * Detect recurring transactions (fixed monthly expenses)
 */
function detectRecurringTransactions(transactions) {
  // Group transactions by name/vendor and check consistency
  const grouped = {};

  transactions.forEach(txn => {
    const key = `${txn.name}-${txn.vendor}`.toLowerCase();
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(txn);
  });

  const recurring = [];

  Object.entries(grouped).forEach(([key, txns]) => {
    if (txns.length < 2) return;

    // Check if amounts are consistent (within 10% variance)
    const amounts = txns.map(t => Math.abs(t.price));
    const avgAmount = mean(amounts);
    const variance = amounts.map(a => Math.abs(a - avgAmount) / avgAmount);
    const maxVariance = Math.max(...variance);

    // Check if appears monthly
    const months = [...new Set(txns.map(t => t.month))];

    if (maxVariance < 0.1 && months.length >= 2) {
      recurring.push({
        name: txns[0].name,
        vendor: txns[0].vendor,
        category: txns[0].category_name,
        avgAmount,
        occurrences: txns.length,
        months: months,
        consistency: 1 - maxVariance,
        transactions: txns
      });
    }
  });

  return recurring.sort((a, b) => b.avgAmount - a.avgAmount);
}

/**
 * Detect spending trends (growth/decline)
 */
function detectTrends(monthlyData) {
  if (monthlyData.length < 2) {
    return { trend: 'insufficient_data', rate: 0 };
  }

  const xValues = monthlyData.map((_, i) => i);
  const yValues = monthlyData.map(m => m.total_expenses);

  const regression = linearRegression(xValues, yValues);
  const avgExpense = mean(yValues);
  const growthRate = avgExpense > 0 ? (regression.slope / avgExpense) * 100 : 0;

  let trend = 'stable';
  if (Math.abs(growthRate) < 5) trend = 'stable';
  else if (growthRate > 5) trend = 'increasing';
  else if (growthRate < -5) trend = 'decreasing';

  return {
    trend,
    growthRate,
    slope: regression.slope,
    rSquared: regression.rSquared
  };
}

/**
 * Detect seasonal patterns in categories
 */
function detectSeasonalPatterns(categorySummaries) {
  const categories = {};

  categorySummaries.forEach(row => {
    const key = row.category_name || 'Uncategorized';
    if (!categories[key]) {
      categories[key] = [];
    }
    categories[key].push(row.total_amount);
  });

  const patterns = [];

  Object.entries(categories).forEach(([category, amounts]) => {
    if (amounts.length < 2) return;

    const avg = mean(amounts);
    const stdDev = standardDeviation(amounts);
    const coefficientOfVariation = avg > 0 ? stdDev / avg : 0;

    patterns.push({
      category,
      avgAmount: avg,
      stdDev,
      consistency: 1 - Math.min(coefficientOfVariation, 1),
      isConsistent: coefficientOfVariation < 0.3
    });
  });

  return patterns.sort((a, b) => b.avgAmount - a.avgAmount);
}

// ==================== FORECASTING MODELS ====================

/**
 * Model 1: Simple Average
 */
function forecastSimpleAverage(monthlyData) {
  const expenses = monthlyData.map(m => m.total_expenses);
  const income = monthlyData.map(m => m.total_income);
  const investments = monthlyData.map(m => m.total_investments);

  return {
    expenses: mean(expenses),
    income: mean(income),
    investments: mean(investments),
    netCashFlow: mean(income) - mean(expenses),
    stdDev: {
      expenses: standardDeviation(expenses),
      income: standardDeviation(income),
      investments: standardDeviation(investments)
    }
  };
}

/**
 * Model 2: Weighted Average (more recent = higher weight)
 */
function forecastWeightedAverage(monthlyData) {
  const weights = [0.2, 0.3, 0.5]; // oldest to newest
  const n = monthlyData.length;

  // Adjust weights if we have fewer than 3 months
  const activeWeights = weights.slice(-n);
  const weightSum = activeWeights.reduce((sum, w) => sum + w, 0);
  const normalizedWeights = activeWeights.map(w => w / weightSum);

  const weightedExpenses = monthlyData.reduce((sum, m, i) =>
    sum + m.total_expenses * normalizedWeights[i], 0);
  const weightedIncome = monthlyData.reduce((sum, m, i) =>
    sum + m.total_income * normalizedWeights[i], 0);
  const weightedInvestments = monthlyData.reduce((sum, m, i) =>
    sum + m.total_investments * normalizedWeights[i], 0);

  return {
    expenses: weightedExpenses,
    income: weightedIncome,
    investments: weightedInvestments,
    netCashFlow: weightedIncome - weightedExpenses,
    weights: normalizedWeights
  };
}

/**
 * Model 3: Linear Regression (trend extrapolation)
 */
function forecastLinearRegression(monthlyData) {
  const xValues = monthlyData.map((_, i) => i);
  const nextX = monthlyData.length;

  const expensesRegression = linearRegression(
    xValues,
    monthlyData.map(m => m.total_expenses)
  );

  const incomeRegression = linearRegression(
    xValues,
    monthlyData.map(m => m.total_income)
  );

  const investmentsRegression = linearRegression(
    xValues,
    monthlyData.map(m => m.total_investments)
  );

  const predictedExpenses = expensesRegression.predict(nextX);
  const predictedIncome = incomeRegression.predict(nextX);
  const predictedInvestments = investmentsRegression.predict(nextX);

  return {
    expenses: Math.max(0, predictedExpenses), // Ensure non-negative
    income: Math.max(0, predictedIncome),
    investments: Math.max(0, predictedInvestments),
    netCashFlow: predictedIncome - predictedExpenses,
    rSquared: {
      expenses: expensesRegression.rSquared,
      income: incomeRegression.rSquared,
      investments: investmentsRegression.rSquared
    },
    trend: {
      expenses: expensesRegression.slope,
      income: incomeRegression.slope,
      investments: investmentsRegression.slope
    }
  };
}

/**
 * Forecast category-level spending
 */
function forecastCategories(categorySummaries, method = 'weighted') {
  const categoryData = {};

  // Group by category
  categorySummaries.forEach(row => {
    const key = row.category_name || 'Uncategorized';
    if (!categoryData[key]) {
      categoryData[key] = {
        name: key,
        parent: row.parent_category_name,
        type: row.category_type,
        months: []
      };
    }
    categoryData[key].months.push(row.total_amount);
  });

  // Forecast each category
  const forecasts = [];

  Object.values(categoryData).forEach(cat => {
    let predicted;

    if (method === 'weighted') {
      const weights = [0.2, 0.3, 0.5].slice(-cat.months.length);
      const weightSum = weights.reduce((s, w) => s + w, 0);
      const normalizedWeights = weights.map(w => w / weightSum);
      predicted = cat.months.reduce((sum, amount, i) =>
        sum + amount * normalizedWeights[i], 0);
    } else {
      predicted = mean(cat.months);
    }

    const avg = mean(cat.months);
    const stdDev = standardDeviation(cat.months);

    forecasts.push({
      category: cat.name,
      parentCategory: cat.parent,
      type: cat.type,
      predicted,
      avg,
      stdDev,
      min: predicted - stdDev,
      max: predicted + stdDev,
      historical: cat.months
    });
  });

  return forecasts.sort((a, b) => b.predicted - a.predicted);
}

// ==================== CONFIDENCE INTERVALS ====================

/**
 * Calculate confidence intervals for predictions
 */
function calculateConfidenceIntervals(forecast, stdDev) {
  return {
    conservative: forecast - stdDev,
    expected: forecast,
    optimistic: forecast + stdDev,
    range: {
      lower: Math.max(0, forecast - stdDev),
      upper: forecast + stdDev
    }
  };
}

// ==================== INSIGHTS GENERATOR ====================

/**
 * Generate actionable insights from forecast data
 */
function generateInsights(monthlyData, forecasts, patterns, trends) {
  const insights = [];

  // Trend insights
  if (trends.trend === 'increasing') {
    insights.push({
      type: 'warning',
      title: 'Rising Expenses Detected',
      message: `Your expenses are trending upward at ${trends.growthRate.toFixed(1)}% per month. Consider reviewing your spending habits.`,
      impact: 'high'
    });
  } else if (trends.trend === 'decreasing') {
    insights.push({
      type: 'success',
      title: 'Spending Reduction Detected',
      message: `Great job! Your expenses are decreasing at ${Math.abs(trends.growthRate).toFixed(1)}% per month.`,
      impact: 'medium'
    });
  }

  // Savings rate insight
  const lastMonth = monthlyData[monthlyData.length - 1];
  const savingsRate = lastMonth.total_income > 0
    ? ((lastMonth.total_income - lastMonth.total_expenses) / lastMonth.total_income) * 100
    : 0;

  if (savingsRate > 20) {
    insights.push({
      type: 'success',
      title: 'Healthy Savings Rate',
      message: `Your current savings rate is ${savingsRate.toFixed(1)}%. You're saving ${savingsRate.toFixed(0)}% of your income!`,
      impact: 'high'
    });
  } else if (savingsRate < 10 && savingsRate > 0) {
    insights.push({
      type: 'warning',
      title: 'Low Savings Rate',
      message: `Your savings rate is only ${savingsRate.toFixed(1)}%. Consider reducing expenses or increasing income.`,
      impact: 'high'
    });
  } else if (savingsRate < 0) {
    insights.push({
      type: 'error',
      title: 'Spending More Than Income',
      message: `You're spending ${Math.abs(savingsRate).toFixed(1)}% more than you earn. This is unsustainable.`,
      impact: 'critical'
    });
  }

  // Recurring transactions insight
  const recurringTotal = patterns.recurring.reduce((sum, r) => sum + r.avgAmount, 0);
  if (patterns.recurring.length > 0) {
    insights.push({
      type: 'info',
      title: 'Fixed Monthly Expenses',
      message: `Detected ${patterns.recurring.length} recurring expenses totaling ₪${recurringTotal.toFixed(0)}/month. These are predictable costs.`,
      impact: 'medium',
      details: patterns.recurring.slice(0, 5).map(r =>
        `${r.name}: ₪${r.avgAmount.toFixed(0)}`
      )
    });
  }

  // Forecast comparison insight
  const avgExpenses = mean(monthlyData.map(m => m.total_expenses));
  const forecastDiff = forecasts.weightedAverage.expenses - avgExpenses;
  const forecastDiffPct = (forecastDiff / avgExpenses) * 100;

  if (Math.abs(forecastDiffPct) > 10) {
    insights.push({
      type: forecastDiffPct > 0 ? 'warning' : 'success',
      title: 'Forecast vs Historical',
      message: `Next month's forecast is ${Math.abs(forecastDiffPct).toFixed(1)}% ${forecastDiffPct > 0 ? 'higher' : 'lower'} than your 3-month average.`,
      impact: 'medium'
    });
  }

  // High variance categories
  const highVarianceCategories = patterns.seasonal
    .filter(p => !p.isConsistent && p.avgAmount > 500)
    .slice(0, 3);

  if (highVarianceCategories.length > 0) {
    insights.push({
      type: 'info',
      title: 'Variable Spending Categories',
      message: `These categories show high variance: ${highVarianceCategories.map(c => c.category).join(', ')}. Budget carefully.`,
      impact: 'low'
    });
  }

  return insights;
}

// ==================== OUTPUT FORMATTERS ====================

/**
 * Format currency for display
 */
function formatCurrency(amount, symbol = '₪') {
  return `${symbol}${Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Print console output with colors (basic version without chalk)
 */
function printConsoleOutput(results) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 FINANCIAL FORECAST REPORT');
  console.log('='.repeat(80));

  // Analysis period
  console.log(`\n📅 Analysis Period: ${results.period.start} to ${results.period.end}`);
  console.log(`📅 Forecast Month: ${results.period.forecastMonth}`);
  console.log(`📊 Data Points: ${results.monthlyData.length} months`);

  // Historical Summary
  console.log('\n' + '-'.repeat(80));
  console.log('📈 HISTORICAL SUMMARY (Last 3 Months)');
  console.log('-'.repeat(80));

  results.monthlyData.forEach(month => {
    const netFlow = month.total_income - month.total_expenses;
    console.log(`\n${month.month}:`);
    console.log(`  Income:      ${formatCurrency(month.total_income)}`);
    console.log(`  Expenses:    ${formatCurrency(month.total_expenses)}`);
    console.log(`  Investments: ${formatCurrency(month.total_investments)}`);
    console.log(`  Net Flow:    ${formatCurrency(netFlow)} ${netFlow > 0 ? '✓' : '✗'}`);
  });

  // Forecast Models Comparison
  console.log('\n' + '-'.repeat(80));
  console.log('🔮 FORECAST MODELS COMPARISON');
  console.log('-'.repeat(80));

  const models = [
    { name: 'Simple Average', data: results.forecasts.simpleAverage },
    { name: 'Weighted Average', data: results.forecasts.weightedAverage },
    { name: 'Linear Regression', data: results.forecasts.linearRegression }
  ];

  console.log('\n' + ' '.repeat(20) + 'Expenses' + ' '.repeat(8) + 'Income' + ' '.repeat(10) + 'Net Flow');
  console.log('-'.repeat(80));

  models.forEach(model => {
    const name = model.name.padEnd(18);
    const expenses = formatCurrency(model.data.expenses).padStart(15);
    const income = formatCurrency(model.data.income).padStart(15);
    const netFlow = formatCurrency(model.data.netCashFlow).padStart(15);
    console.log(`${name} ${expenses} ${income} ${netFlow}`);
  });

  // Confidence Intervals
  console.log('\n' + '-'.repeat(80));
  console.log('📊 CONFIDENCE INTERVALS (Weighted Average Model)');
  console.log('-'.repeat(80));

  const ci = results.confidenceIntervals;
  console.log(`\nExpenses:`);
  console.log(`  Conservative (μ-σ): ${formatCurrency(ci.expenses.conservative)}`);
  console.log(`  Expected (μ):       ${formatCurrency(ci.expenses.expected)}`);
  console.log(`  Optimistic (μ+σ):   ${formatCurrency(ci.expenses.optimistic)}`);
  console.log(`  Range: ${formatCurrency(ci.expenses.range.lower)} - ${formatCurrency(ci.expenses.range.upper)}`);

  console.log(`\nIncome:`);
  console.log(`  Conservative (μ-σ): ${formatCurrency(ci.income.conservative)}`);
  console.log(`  Expected (μ):       ${formatCurrency(ci.income.expected)}`);
  console.log(`  Optimistic (μ+σ):   ${formatCurrency(ci.income.optimistic)}`);
  console.log(`  Range: ${formatCurrency(ci.income.range.lower)} - ${formatCurrency(ci.income.range.upper)}`);

  // Category Forecasts
  console.log('\n' + '-'.repeat(80));
  console.log('💰 TOP CATEGORY FORECASTS (Next Month)');
  console.log('-'.repeat(80));

  const topCategories = results.categoryForecasts.slice(0, 10);
  console.log('\n' + 'Category'.padEnd(30) + 'Predicted'.padStart(15) + 'Range'.padStart(25));
  console.log('-'.repeat(80));

  topCategories.forEach(cat => {
    const name = cat.category.substring(0, 28).padEnd(30);
    const predicted = formatCurrency(cat.predicted).padStart(15);
    const range = `${formatCurrency(cat.min)} - ${formatCurrency(cat.max)}`.padStart(25);
    console.log(`${name}${predicted}${range}`);
  });

  // Patterns & Trends
  console.log('\n' + '-'.repeat(80));
  console.log('🔍 DETECTED PATTERNS');
  console.log('-'.repeat(80));

  console.log(`\nTrend: ${results.trends.trend.toUpperCase()}`);
  console.log(`Growth Rate: ${results.trends.growthRate.toFixed(2)}% per month`);
  console.log(`R-Squared: ${results.trends.rSquared.toFixed(3)} (fit quality)`);

  if (results.patterns.recurring.length > 0) {
    console.log(`\n🔄 Recurring Transactions (${results.patterns.recurring.length} found):`);
    results.patterns.recurring.slice(0, 5).forEach(r => {
      console.log(`  • ${r.name}: ${formatCurrency(r.avgAmount)}/month (${r.occurrences}x, ${(r.consistency * 100).toFixed(0)}% consistent)`);
    });
  }

  // Insights
  console.log('\n' + '-'.repeat(80));
  console.log('💡 INSIGHTS & RECOMMENDATIONS');
  console.log('-'.repeat(80));

  results.insights.forEach((insight, i) => {
    const icon = insight.type === 'success' ? '✓' :
                 insight.type === 'warning' ? '⚠' :
                 insight.type === 'error' ? '✗' : 'ℹ';
    console.log(`\n${i + 1}. ${icon} ${insight.title} [${insight.impact.toUpperCase()}]`);
    console.log(`   ${insight.message}`);
    if (insight.details) {
      insight.details.forEach(detail => console.log(`   - ${detail}`));
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('✅ Forecast generation complete!');
  console.log('='.repeat(80) + '\n');
}

/**
 * Export forecast to JSON file
 */
function exportToJson(results, filename = 'forecast-output.json') {
  const filepath = path.join(CONFIG.outputDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
  console.log(`✅ Forecast exported to: ${filepath}`);
}

/**
 * Export chart-ready data
 */
function exportChartData(results, filename = 'forecast-chart-data.json') {
  // Format data for Recharts (compatible with TransactionHistorySection)
  const chartData = {
    historical: results.monthlyData.map(m => ({
      date: m.month,
      income: m.total_income,
      expenses: m.total_expenses,
      netFlow: m.total_income - m.total_expenses
    })),
    forecast: {
      date: results.period.forecastMonth,
      income: results.forecasts.weightedAverage.income,
      expenses: results.forecasts.weightedAverage.expenses,
      netFlow: results.forecasts.weightedAverage.netCashFlow,
      confidenceIntervals: results.confidenceIntervals
    },
    categoryForecasts: results.categoryForecasts.map(c => ({
      category: c.category,
      predicted: c.predicted,
      min: c.min,
      max: c.max
    }))
  };

  const filepath = path.join(CONFIG.outputDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(chartData, null, 2));
  console.log(`✅ Chart data exported to: ${filepath}`);
}

// ==================== MAIN EXECUTION ====================

async function main() {
  console.log('\n🚀 Starting Financial Forecast Analysis...\n');

  // Check if database exists
  if (!fs.existsSync(CONFIG.dbPath)) {
    console.error(`❌ Database not found at: ${CONFIG.dbPath}`);
    process.exit(1);
  }

  // Connect to database
  const db = new Database(CONFIG.dbPath, { readonly: true });

  try {
    // 1. Get historical data
    console.log('📊 Fetching historical data...');
    const { aggregates, transactions } = getHistoricalData(db, CONFIG.analysisMonths);
    const monthlyTotals = getMonthlyTotals(db, CONFIG.analysisMonths);
    const categorySummaries = getCategorySummaries(db, CONFIG.analysisMonths);

    if (monthlyTotals.length === 0) {
      console.error('❌ No transaction data found for analysis period');
      process.exit(1);
    }

    console.log(`✓ Loaded ${transactions.length} transactions across ${monthlyTotals.length} months`);

    // 2. Pattern detection
    console.log('\n🔍 Detecting patterns...');
    const recurring = detectRecurringTransactions(transactions);
    const trends = detectTrends(monthlyTotals);
    const seasonal = detectSeasonalPatterns(categorySummaries);

    console.log(`✓ Found ${recurring.length} recurring transactions`);
    console.log(`✓ Detected ${trends.trend} trend (${trends.growthRate.toFixed(2)}% growth rate)`);

    // 3. Generate forecasts
    console.log('\n🔮 Generating forecasts...');
    const simpleAvg = forecastSimpleAverage(monthlyTotals);
    const weightedAvg = forecastWeightedAverage(monthlyTotals);
    const linearReg = forecastLinearRegression(monthlyTotals);
    const categoryForecasts = forecastCategories(categorySummaries, 'weighted');

    console.log(`✓ Generated 3 forecast models`);
    console.log(`✓ Forecasted ${categoryForecasts.length} categories`);

    // 4. Calculate confidence intervals
    const confidenceIntervals = {
      expenses: calculateConfidenceIntervals(
        weightedAvg.expenses,
        simpleAvg.stdDev.expenses
      ),
      income: calculateConfidenceIntervals(
        weightedAvg.income,
        simpleAvg.stdDev.income
      ),
      netCashFlow: calculateConfidenceIntervals(
        weightedAvg.netCashFlow,
        simpleAvg.stdDev.expenses + simpleAvg.stdDev.income
      )
    };

    // 5. Generate insights
    console.log('\n💡 Generating insights...');
    const patterns = { recurring, seasonal };
    const forecasts = { simpleAverage: simpleAvg, weightedAverage: weightedAvg, linearRegression: linearReg };
    const insights = generateInsights(monthlyTotals, forecasts, patterns, trends);

    console.log(`✓ Generated ${insights.length} insights`);

    // 6. Compile results
    const results = {
      generated: new Date().toISOString(),
      period: {
        start: monthlyTotals[0].month,
        end: monthlyTotals[monthlyTotals.length - 1].month,
        forecastMonth: new Date(new Date(monthlyTotals[monthlyTotals.length - 1].month).setMonth(
          new Date(monthlyTotals[monthlyTotals.length - 1].month).getMonth() + 1
        )).toISOString().substring(0, 7)
      },
      monthlyData: monthlyTotals,
      forecasts,
      confidenceIntervals,
      categoryForecasts,
      patterns,
      trends,
      insights,
      config: CONFIG
    };

    // 7. Output results
    printConsoleOutput(results);

    if (CONFIG.exportJson) {
      exportToJson(results);
    }

    if (CONFIG.exportChart) {
      exportChartData(results);
    }

  } catch (error) {
    console.error('❌ Error during forecast:', error);
    throw error;
  } finally {
    db.close();
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Export functions for potential reuse
export {
  forecastSimpleAverage,
  forecastWeightedAverage,
  forecastLinearRegression,
  forecastCategories,
  detectRecurringTransactions,
  detectTrends,
  calculateConfidenceIntervals
};
