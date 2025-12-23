const database = require('../database.js');

/**
 * Get behavioral spending patterns
 * Analyzes programmed vs impulse spending, recurring patterns, and category averages
 */
async function getBehavioralPatterns() {
  // Get last 3 months of transactions for pattern analysis
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const transactionsResult = await database.query(
    `SELECT
      t.identifier,
      t.date,
      t.name,
      t.price,
      t.vendor,
      t.category_type,
      cd.id as category_id,
      cd.name as category_name,
      cd.icon as icon_name,
      parent_cd.name as parent_category,
      strftime('%Y-%m', t.date) as month,
      strftime('%w', t.date) as day_of_week
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
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
    WHERE t.status = 'completed'
      AND t.category_type = 'expense'
      AND t.price < 0
      AND t.date >= $1
      AND ap.id IS NULL
    ORDER BY t.date`,
    [threeMonthsAgo.toISOString()]
  );

  const transactions = transactionsResult.rows || [];

  // Detect recurring patterns
  const recurringPatterns = detectRecurringTransactions(transactions);

  // Calculate programmed vs impulse spending
  const programmedAmount = recurringPatterns.reduce((sum, p) => sum + (p.avgAmount * p.occurrences), 0);
  const totalAmount = transactions.reduce((sum, t) => sum + Math.abs(t.price), 0);
  const impulseAmount = totalAmount - programmedAmount;

  const programmedPercentage = totalAmount > 0 ? (programmedAmount / totalAmount) * 100 : 0;
  const impulsePercentage = totalAmount > 0 ? (impulseAmount / totalAmount) * 100 : 0;

  // Calculate category averages (with recurring percentage)
  const categoryAverages = calculateCategoryAverages(transactions, recurringPatterns);

  return {
    programmedAmount: Math.round(programmedAmount),
    impulseAmount: Math.round(impulseAmount),
    programmedPercentage,
    impulsePercentage,
    recurringPatterns: recurringPatterns.map(p => ({
      name: p.name,
      avgAmount: Math.round(p.avgAmount),
      occurrences: p.occurrences,
      frequency: p.frequency,
      isFixed: p.isFixed
    })),
    categoryAverages
  };
}

/**
 * Detect recurring transactions (subscriptions, fixed payments)
 */
function detectRecurringTransactions(transactions) {
  const groups = new Map();

  // Group transactions by name/vendor
  transactions.forEach(txn => {
    const name = (txn.name || txn.vendor || '').trim().toLowerCase();
    if (!name) return;

    if (!groups.has(name)) {
      groups.set(name, {
        displayName: txn.name || txn.vendor,
        amounts: [],
        months: new Set()
      });
    }

    const group = groups.get(name);
    group.amounts.push(Math.abs(txn.price));
    group.months.add(txn.month);
  });

  // Identify recurring patterns
  const recurring = [];

  groups.forEach((group, key) => {
    const amounts = group.amounts;
    const monthCount = group.months.size;

    // Must appear in at least 2 months
    if (monthCount < 2) return;

    // Calculate standard deviation to detect fixed amounts
    const avg = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    // Use sample variance (n-1) instead of population variance (n)
    const n = amounts.length;
    const variance = n > 1
      ? amounts.reduce((sum, a) => sum + Math.pow(a - avg, 2), 0) / (n - 1)
      : 0;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / avg;

    // Determine frequency
    const avgOccurrencesPerMonth = amounts.length / monthCount;
    let frequency = 'variable';
    
    if (avgOccurrencesPerMonth >= 0.8 && avgOccurrencesPerMonth <= 1.2) {
      frequency = 'monthly';
    } else if (avgOccurrencesPerMonth >= 1.8 && avgOccurrencesPerMonth <= 2.2) {
      frequency = 'biweekly';
    } else if (avgOccurrencesPerMonth >= 3.5 && avgOccurrencesPerMonth <= 4.5) {
      frequency = 'weekly';
    }

    recurring.push({
      name: group.displayName,
      avgAmount: avg,
      occurrences: amounts.length,
      frequency,
      isFixed: coefficientOfVariation < 0.1 // Less than 10% variation = fixed amount
    });
  });

  // Sort by total spending
  recurring.sort((a, b) => (b.avgAmount * b.occurrences) - (a.avgAmount * a.occurrences));

  return recurring.slice(0, 20); // Top 20 patterns
}

/**
 * Calculate average spending per category per week
 */
function calculateCategoryAverages(transactions, recurringPatterns) {
  const categoryData = new Map();
  const weekCount = new Set(transactions.map(t => {
    const date = new Date(t.date);
    const { year, week } = getWeekNumber(date);
    return `${year}-W${String(week).padStart(2, '0')}`;
  })).size;

  // Create a map of recurring transaction names for easy lookup
  const recurringNames = new Set(
    recurringPatterns.map(p => p.name.toLowerCase())
  );

  // Group by category
  transactions.forEach(txn => {
    const category = txn.category_name || txn.parent_category || 'Uncategorized';
    const txnName = (txn.name || txn.vendor || '').trim().toLowerCase();

    if (!categoryData.has(category)) {
      categoryData.set(category, {
        category,
        iconName: txn.icon_name || null,
        amounts: [],
        transactions: 0,
        recurringTransactions: 0,
        months: new Set()
      });
    }

    const data = categoryData.get(category);
    // Update icon_name if current transaction has one and stored doesn't
    if (txn.icon_name && !data.iconName) {
      data.iconName = txn.icon_name;
    }
    data.amounts.push(Math.abs(txn.price));
    data.transactions++;
    if (recurringNames.has(txnName)) {
      data.recurringTransactions++;
    }
    data.months.add(txn.month);
  });

  // Calculate averages
  const averages = [];
  
  categoryData.forEach((data, category) => {
    const totalAmount = data.amounts.reduce((sum, a) => sum + a, 0);
    const monthCount = data.months.size;
    
    // Calculate variance to detect recurring patterns
    const avg = totalAmount / data.amounts.length;
    const variance = data.amounts.reduce((sum, a) => sum + Math.pow(a - avg, 2), 0) / data.amounts.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / avg;
    
    // Calculate recurring percentage
    const recurringPercentage = data.transactions > 0 ? (data.recurringTransactions / data.transactions) * 100 : 0;

    averages.push({
      category,
      iconName: data.iconName || null,
      avgPerWeek: weekCount > 0 ? Math.round(totalAmount / weekCount) : 0,
      avgPerMonth: monthCount > 0 ? Math.round(totalAmount / monthCount) : 0,
      transactionsPerWeek: weekCount > 0 ? (data.transactions / weekCount) : 0,
      isRecurring: coefficientOfVariation < 0.3 && monthCount >= 2,
      recurringPercentage: Math.round(recurringPercentage)
    });
  });

  // Sort by monthly average
  averages.sort((a, b) => b.avgPerMonth - a.avgPerMonth);

  return averages.slice(0, 15); // Top 15 categories
}

/**
 * Get ISO week number and year
 * Returns { year, week } to handle year boundaries correctly
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

module.exports = {
  getBehavioralPatterns
};
