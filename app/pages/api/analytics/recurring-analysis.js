import { getDB } from '../db.js';
import { subMonths, differenceInDays, addDays } from 'date-fns';

/**
 * Recurring Transaction Analysis API
 * Detects recurring charges using rule-based heuristics
 * 
 * GET /api/analytics/recurring-analysis?months=6&minOccurrences=3
 * Returns detected recurring transactions with optimization suggestions
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await getDB();

  try {
    const { 
      months = 6, 
      minOccurrences = 3,
      minConfidence = 0.5 
    } = req.query;

    const startDate = subMonths(new Date(), parseInt(months));
    const endDate = new Date();

    // Fetch all expense transactions
    const transactionsResult = await client.query(`
      SELECT
        t.identifier,
        t.vendor,
        t.date,
        t.name,
        ABS(t.price) as amount,
        cd.name as category,
        parent.name as parent_category,
        cd.id as category_definition_id
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN category_definitions parent ON cd.parent_id = parent.id
      WHERE t.date >= $1 AND t.date <= $2
      AND t.price < 0
      AND cd.category_type = 'expense'
      ORDER BY t.name, t.date ASC
    `, [startDate, endDate]);

    const transactions = transactionsResult.rows;

    // Group transactions by merchant name (normalized)
    const merchantGroups = groupByMerchant(transactions);

    // Detect recurring patterns
    const recurringPatterns = [];

    for (const [merchantPattern, txns] of Object.entries(merchantGroups)) {
      if (txns.length < parseInt(minOccurrences)) continue;

      const pattern = analyzeRecurringPattern(txns, merchantPattern);
      
      if (pattern && pattern.confidence >= parseFloat(minConfidence)) {
        // Get existing user status from database
        const existingResult = await client.query(
          `SELECT user_status, optimization_note 
           FROM recurring_transaction_analysis 
           WHERE merchant_pattern = $1 AND frequency = $2`,
          [merchantPattern, pattern.frequency]
        );

        const existing = existingResult.rows[0];
        pattern.user_status = existing?.user_status || 'active';
        pattern.user_optimization_note = existing?.optimization_note || null;

        // Add optimization suggestions
        pattern.optimization_suggestions = generateOptimizationSuggestions(pattern);

        recurringPatterns.push(pattern);
      }
    }

    // Sort by monthly cost (highest first)
    recurringPatterns.sort((a, b) => b.monthly_equivalent - a.monthly_equivalent);

    // Calculate summary statistics
    const summary = {
      total_recurring: recurringPatterns.length,
      total_monthly_cost: recurringPatterns.reduce((sum, p) => sum + p.monthly_equivalent, 0),
      by_frequency: {
        weekly: recurringPatterns.filter(p => p.frequency === 'weekly').length,
        monthly: recurringPatterns.filter(p => p.frequency === 'monthly').length,
        quarterly: recurringPatterns.filter(p => p.frequency === 'quarterly').length,
        yearly: recurringPatterns.filter(p => p.frequency === 'yearly').length
      },
      by_status: {
        active: recurringPatterns.filter(p => p.user_status === 'active').length,
        marked_cancel: recurringPatterns.filter(p => p.user_status === 'marked_cancel').length,
        essential: recurringPatterns.filter(p => p.user_status === 'essential').length,
        reviewed: recurringPatterns.filter(p => p.user_status === 'reviewed').length
      },
      potential_savings: recurringPatterns
        .filter(p => p.optimization_suggestions.length > 0)
        .reduce((sum, p) => {
          const maxSaving = Math.max(...p.optimization_suggestions.map(s => s.potential_savings || 0));
          return sum + maxSaving;
        }, 0)
    };

    return res.status(200).json({
      period: { startDate, endDate, months: parseInt(months) },
      recurring_patterns: recurringPatterns,
      summary
    });

  } catch (error) {
    console.error('Error analyzing recurring transactions:', error);
    return res.status(500).json({
      error: 'Failed to analyze recurring transactions',
      details: error.message
    });
  } finally {
    client.release();
  }
}

/**
 * Group transactions by normalized merchant name
 */
function groupByMerchant(transactions) {
  const groups = {};

  for (const txn of transactions) {
    const normalized = normalizeMerchantName(txn.name);
    if (!groups[normalized]) {
      groups[normalized] = [];
    }
    groups[normalized].push(txn);
  }

  return groups;
}

/**
 * Normalize merchant name for grouping
 * Remove common prefixes, numbers, dates, etc.
 */
function normalizeMerchantName(name) {
  let normalized = name.toLowerCase();
  
  // Remove common prefixes (Hebrew and English)
  normalized = normalized.replace(/^(קניה ב-|רכישה ב-|עסקה ב-|תשלום ל-|payment to|purchase at)/i, '');
  
  // Remove dates and numbers at the end
  normalized = normalized.replace(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/, '');
  normalized = normalized.replace(/\s*\d+\s*$/, '');
  
  // Remove multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized || name; // Fallback to original if empty
}

/**
 * Analyze transactions for recurring patterns
 */
function analyzeRecurringPattern(transactions, merchantPattern) {
  if (transactions.length < 2) return null;

  // Sort by date
  const sorted = [...transactions].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Calculate intervals between transactions (in days)
  const intervals = [];
  for (let i = 1; i < sorted.length; i++) {
    const days = differenceInDays(
      new Date(sorted[i].date),
      new Date(sorted[i - 1].date)
    );
    intervals.push(days);
  }

  // Calculate average interval and variance
  const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
  const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  // Determine frequency and confidence
  const { frequency, expectedInterval, tolerance } = classifyFrequency(avgInterval);
  
  if (!frequency) return null; // Not a recognizable pattern

  // Calculate confidence score based on consistency
  const consistencyScore = calculateConsistencyScore(intervals, expectedInterval, tolerance);
  
  // Calculate amount variance
  const amounts = sorted.map(t => parseFloat(t.amount));
  const avgAmount = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
  const amountVariance = amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length;
  const amountStdDev = Math.sqrt(amountVariance);
  const amountConsistency = 1 - Math.min(1, amountStdDev / avgAmount);

  // Combined confidence (70% interval consistency, 30% amount consistency)
  const confidence = (consistencyScore * 0.7 + amountConsistency * 0.3);

  // Calculate monthly equivalent cost
  const monthlyEquivalent = calculateMonthlyEquivalent(avgAmount, frequency);

  // Detect if likely a subscription (high confidence + known patterns)
  const isSubscription = detectSubscription(merchantPattern, frequency, confidence);

  // Calculate next expected date
  const lastDate = new Date(sorted[sorted.length - 1].date);
  const nextExpectedDate = addDays(lastDate, expectedInterval);

  return {
    merchant_pattern: merchantPattern,
    merchant_display_name: transactions[0].name,
    category: transactions[0].category,
    parent_category: transactions[0].parent_category,
    frequency,
    transaction_count: transactions.length,
    average_amount: Math.round(avgAmount * 100) / 100,
    amount_variance: Math.round(amountStdDev * 100) / 100,
    monthly_equivalent: Math.round(monthlyEquivalent * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    is_subscription: isSubscription,
    first_transaction: sorted[0].date,
    last_transaction: sorted[sorted.length - 1].date,
    next_expected_date: nextExpectedDate.toISOString().split('T')[0],
    average_interval_days: Math.round(avgInterval),
    interval_variance: Math.round(stdDev),
    user_status: 'active' // Default, will be overridden from DB
  };
}

/**
 * Classify frequency based on average interval
 */
function classifyFrequency(avgInterval) {
  // Weekly: 6-8 days
  if (avgInterval >= 6 && avgInterval <= 8) {
    return { frequency: 'weekly', expectedInterval: 7, tolerance: 2 };
  }
  
  // Monthly: 28-32 days
  if (avgInterval >= 25 && avgInterval <= 35) {
    return { frequency: 'monthly', expectedInterval: 30, tolerance: 5 };
  }
  
  // Quarterly: 88-95 days (3 months)
  if (avgInterval >= 85 && avgInterval <= 95) {
    return { frequency: 'quarterly', expectedInterval: 90, tolerance: 7 };
  }
  
  // Yearly: 360-370 days
  if (avgInterval >= 355 && avgInterval <= 375) {
    return { frequency: 'yearly', expectedInterval: 365, tolerance: 10 };
  }
  
  return { frequency: null, expectedInterval: 0, tolerance: 0 };
}

/**
 * Calculate consistency score based on interval variations
 */
function calculateConsistencyScore(intervals, expectedInterval, tolerance) {
  if (intervals.length === 0) return 0;

  let withinTolerance = 0;
  for (const interval of intervals) {
    const deviation = Math.abs(interval - expectedInterval);
    if (deviation <= tolerance) {
      withinTolerance++;
    }
  }

  return withinTolerance / intervals.length;
}

/**
 * Calculate monthly equivalent cost
 */
function calculateMonthlyEquivalent(avgAmount, frequency) {
  switch (frequency) {
    case 'weekly': return avgAmount * 4.33; // Average weeks per month
    case 'monthly': return avgAmount;
    case 'quarterly': return avgAmount / 3;
    case 'yearly': return avgAmount / 12;
    default: return avgAmount;
  }
}

/**
 * Detect if transaction is likely a subscription
 */
function detectSubscription(merchantPattern, frequency, confidence) {
  const pattern = merchantPattern.toLowerCase();
  
  // Known subscription keywords
  const subscriptionKeywords = [
    'netflix', 'spotify', 'apple', 'google', 'microsoft', 'amazon',
    'youtube', 'disney', 'hbo', 'prime', 'icloud', 'office',
    'dropbox', 'adobe', 'github', 'linkedin',
    // Hebrew
    'מנוי', 'subscription', 'חבילה'
  ];

  const hasKeyword = subscriptionKeywords.some(keyword => pattern.includes(keyword));
  const isMonthlyOrYearly = frequency === 'monthly' || frequency === 'yearly';
  const isHighConfidence = confidence >= 0.8;

  return hasKeyword || (isMonthlyOrYearly && isHighConfidence);
}

/**
 * Generate optimization suggestions
 */
function generateOptimizationSuggestions(pattern) {
  const suggestions = [];

  // Suggestion 1: Annual vs Monthly for subscriptions
  if (pattern.is_subscription && pattern.frequency === 'monthly') {
    const annualSavings = pattern.average_amount * 12 * 0.15; // Typical 15% annual discount
    suggestions.push({
      type: 'annual_plan',
      title: 'Switch to Annual Plan',
      description: 'Many services offer 10-20% discount for annual subscriptions',
      potential_savings: Math.round(annualSavings * 100) / 100,
      action: 'Contact provider or check account settings'
    });
  }

  // Suggestion 2: Cancellation for low-value subscriptions
  if (pattern.is_subscription && pattern.monthly_equivalent < 100) {
    suggestions.push({
      type: 'review_necessity',
      title: 'Review Necessity',
      description: 'Consider if this subscription is being actively used',
      potential_savings: pattern.monthly_equivalent,
      action: 'Review usage and consider cancellation if not needed'
    });
  }

  // Suggestion 3: Competitor comparison for utilities/services
  if (pattern.parent_category && ['תקשורת', 'חשבונות'].includes(pattern.parent_category)) {
    suggestions.push({
      type: 'competitor_comparison',
      title: 'Compare Competitors',
      description: 'Check if competitors offer better rates',
      potential_savings: pattern.monthly_equivalent * 0.2, // Estimate 20% potential
      action: 'Research alternative providers'
    });
  }

  // Suggestion 4: High-cost items - negotiate
  if (pattern.monthly_equivalent > 200) {
    suggestions.push({
      type: 'negotiate',
      title: 'Negotiate Better Rate',
      description: 'For high-value recurring charges, negotiation may reduce costs',
      potential_savings: pattern.monthly_equivalent * 0.1, // Estimate 10%
      action: 'Contact provider to discuss better rates or downgrade options'
    });
  }

  return suggestions;
}
