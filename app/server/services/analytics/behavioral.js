const database = require('../database.js');
const { getLocalizedCategoryName } = require('../../../lib/server/locale-utils.js');

// Frequency types with detection thresholds
const FREQUENCY_TYPES = {
  DAILY: { name: 'daily', minPerMonth: 20, maxPerMonth: 31, color: '#e91e63' },
  WEEKLY: { name: 'weekly', minPerMonth: 3.5, maxPerMonth: 5, color: '#9c27b0' },
  BIWEEKLY: { name: 'biweekly', minPerMonth: 1.8, maxPerMonth: 2.5, color: '#3f51b5' },
  MONTHLY: { name: 'monthly', minPerMonth: 0.8, maxPerMonth: 1.2, color: '#2196f3' },
  BIMONTHLY: { name: 'bimonthly', minPerMonth: 0.4, maxPerMonth: 0.6, color: '#00bcd4' },
  VARIABLE: { name: 'variable', minPerMonth: 0, maxPerMonth: Infinity, color: '#607d8b' }
};

/**
 * Detect frequency based on occurrences per month
 */
function detectFrequency(occurrencesPerMonth) {
  if (occurrencesPerMonth >= FREQUENCY_TYPES.DAILY.minPerMonth) return FREQUENCY_TYPES.DAILY;
  if (occurrencesPerMonth >= FREQUENCY_TYPES.WEEKLY.minPerMonth && occurrencesPerMonth <= FREQUENCY_TYPES.WEEKLY.maxPerMonth) return FREQUENCY_TYPES.WEEKLY;
  if (occurrencesPerMonth >= FREQUENCY_TYPES.BIWEEKLY.minPerMonth && occurrencesPerMonth <= FREQUENCY_TYPES.BIWEEKLY.maxPerMonth) return FREQUENCY_TYPES.BIWEEKLY;
  if (occurrencesPerMonth >= FREQUENCY_TYPES.MONTHLY.minPerMonth && occurrencesPerMonth <= FREQUENCY_TYPES.MONTHLY.maxPerMonth) return FREQUENCY_TYPES.MONTHLY;
  if (occurrencesPerMonth >= FREQUENCY_TYPES.BIMONTHLY.minPerMonth && occurrencesPerMonth <= FREQUENCY_TYPES.BIMONTHLY.maxPerMonth) return FREQUENCY_TYPES.BIMONTHLY;
  return FREQUENCY_TYPES.VARIABLE;
}

/**
 * Calculate interval consistency to detect recurring patterns
 * Returns a score from 0-1 where 1 is perfectly consistent intervals
 */
function calculateIntervalConsistency(dates, expectedIntervalDays) {
  if (dates.length < 2) return 0;
  
  const sortedDates = [...dates].sort((a, b) => new Date(a) - new Date(b));
  const intervals = [];
  
  for (let i = 1; i < sortedDates.length; i++) {
    const daysDiff = Math.round((new Date(sortedDates[i]) - new Date(sortedDates[i - 1])) / (1000 * 60 * 60 * 24));
    intervals.push(daysDiff);
  }
  
  if (intervals.length === 0) return 0;
  
  // Calculate how close each interval is to the expected interval
  const deviations = intervals.map(interval => Math.abs(interval - expectedIntervalDays) / expectedIntervalDays);
  const avgDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
  
  return Math.max(0, 1 - avgDeviation);
}

/**
 * Get behavioral spending patterns
 * Analyzes programmed vs impulse spending, recurring patterns at transaction/category/subcategory levels
 * @param {string} locale - User's locale for category name translations (he, en, fr)
 */
async function getBehavioralPatterns(locale = 'he') {
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
      cd.name_en as category_name_en,
      cd.name_fr as category_name_fr,
      cd.icon as icon_name,
      parent_cd.id as parent_category_id,
      parent_cd.name as parent_category,
      parent_cd.name_en as parent_category_en,
      parent_cd.name_fr as parent_category_fr,
      parent_cd.icon as parent_icon,
      strftime('%Y-%m', t.date) as month,
      strftime('%W', t.date) as week,
      strftime('%w', t.date) as day_of_week
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.status = 'completed'
      AND t.category_type = 'expense'
      AND t.price < 0
      AND t.date >= $1
      AND tpe.transaction_identifier IS NULL
    ORDER BY t.date`,
    [threeMonthsAgo.toISOString()]
  );

  const transactions = transactionsResult.rows || [];
  
  // Apply localization to transaction category names
  const localizedTransactions = transactions.map(txn => ({
    ...txn,
    localizedCategory: getLocalizedCategoryName({
      name: txn.category_name,
      name_en: txn.category_name_en,
      name_fr: txn.category_name_fr
    }, locale),
    localizedParentCategory: getLocalizedCategoryName({
      name: txn.parent_category,
      name_en: txn.parent_category_en,
      name_fr: txn.parent_category_fr
    }, locale)
  }));

  // Detect recurring patterns at transaction level
  const recurringPatterns = detectRecurringTransactions(localizedTransactions);
  
  // Detect patterns at category and subcategory levels
  const categoryPatterns = detectCategoryPatterns(localizedTransactions);
  const subcategoryPatterns = detectSubcategoryPatterns(localizedTransactions);
  
  // Group patterns by frequency for the UI
  const patternsByFrequency = groupPatternsByFrequency(recurringPatterns, categoryPatterns, subcategoryPatterns);

  // Calculate programmed vs impulse spending
  const programmedAmount = recurringPatterns.reduce((sum, p) => sum + (p.avgAmount * p.occurrences), 0);
  const totalAmount = transactions.reduce((sum, t) => sum + Math.abs(t.price), 0);
  const impulseAmount = totalAmount - programmedAmount;

  const programmedPercentage = totalAmount > 0 ? (programmedAmount / totalAmount) * 100 : 0;
  const impulsePercentage = totalAmount > 0 ? (impulseAmount / totalAmount) * 100 : 0;

  // Calculate category averages (with recurring percentage)
  const categoryAverages = calculateCategoryAverages(localizedTransactions, recurringPatterns);

  return {
    programmedAmount: Math.round(programmedAmount),
    impulseAmount: Math.round(impulseAmount),
    programmedPercentage,
    impulsePercentage,
    recurringPatterns: recurringPatterns.map(p => ({
      name: p.name,
      avgAmount: Math.round(p.avgAmount),
      occurrences: p.occurrences,
      occurrencesPerMonth: p.occurrencesPerMonth,
      monthsObserved: p.monthsObserved,
      frequency: p.frequency,
      frequencyColor: p.frequencyColor,
      isFixed: p.isFixed,
      consistency: p.consistency,
      category: p.category,
      subcategory: p.subcategory
    })),
    patternsByFrequency,
    categoryPatterns: categoryPatterns.map(p => ({
      category: p.category,
      iconName: p.iconName,
      frequency: p.frequency,
      frequencyColor: p.frequencyColor,
      avgAmount: Math.round(p.avgAmount),
      totalAmount: Math.round(p.totalAmount),
      occurrences: p.occurrences,
      consistency: p.consistency
    })),
    subcategoryPatterns: subcategoryPatterns.map(p => ({
      subcategory: p.subcategory,
      category: p.category,
      iconName: p.iconName,
      frequency: p.frequency,
      frequencyColor: p.frequencyColor,
      avgAmount: Math.round(p.avgAmount),
      totalAmount: Math.round(p.totalAmount),
      occurrences: p.occurrences,
      consistency: p.consistency
    })),
    categoryAverages
  };
}

/**
 * Group all patterns by frequency type
 */
function groupPatternsByFrequency(transactionPatterns, categoryPatterns, subcategoryPatterns) {
  const result = {
    daily: { transactions: [], categories: [], subcategories: [], color: FREQUENCY_TYPES.DAILY.color },
    weekly: { transactions: [], categories: [], subcategories: [], color: FREQUENCY_TYPES.WEEKLY.color },
    biweekly: { transactions: [], categories: [], subcategories: [], color: FREQUENCY_TYPES.BIWEEKLY.color },
    monthly: { transactions: [], categories: [], subcategories: [], color: FREQUENCY_TYPES.MONTHLY.color },
    bimonthly: { transactions: [], categories: [], subcategories: [], color: FREQUENCY_TYPES.BIMONTHLY.color }
  };

  transactionPatterns.forEach(p => {
    if (result[p.frequency]) {
      result[p.frequency].transactions.push(p);
    }
  });

  categoryPatterns.forEach(p => {
    if (result[p.frequency]) {
      result[p.frequency].categories.push(p);
    }
  });

  subcategoryPatterns.forEach(p => {
    if (result[p.frequency]) {
      result[p.frequency].subcategories.push(p);
    }
  });

  return result;
}

/**
 * Detect recurring transactions (subscriptions, fixed payments)
 * Enhanced with better frequency detection and interval analysis
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
        dates: [],
        months: new Set(),
        category: txn.localizedParentCategory || txn.localizedCategory || 'Uncategorized',
        subcategory: txn.localizedCategory || null,
        iconName: txn.icon_name
      });
    }

    const group = groups.get(name);
    group.amounts.push(Math.abs(txn.price));
    group.dates.push(txn.date);
    group.months.add(txn.month);
  });

  const monthCount = new Set(transactions.map(t => t.month)).size || 1;
  const recurring = [];

  groups.forEach((group, key) => {
    const amounts = group.amounts;
    const occurrences = amounts.length;

    // Must have at least 2 occurrences
    if (occurrences < 2) return;

    // Calculate average amount and variation
    const avg = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    const n = amounts.length;
    const variance = n > 1
      ? amounts.reduce((sum, a) => sum + Math.pow(a - avg, 2), 0) / (n - 1)
      : 0;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = avg > 0 ? stdDev / avg : 0;

    // Determine frequency based on occurrences per month
    const occurrencesPerMonth = occurrences / monthCount;
    const frequencyInfo = detectFrequency(occurrencesPerMonth);

    // Skip variable frequency items unless they have significant spending
    if (frequencyInfo.name === 'variable' && avg < 50) return;

    // Calculate interval consistency for recurring pattern confidence
    const expectedIntervalDays = {
      daily: 1,
      weekly: 7,
      biweekly: 14,
      monthly: 30,
      bimonthly: 60
    }[frequencyInfo.name] || 30;

    const consistency = calculateIntervalConsistency(group.dates, expectedIntervalDays);

    // Only include if it shows recurring behavior (consistency > 0.3 or appears in multiple months)
    if (consistency < 0.3 && group.months.size < 2) return;

    recurring.push({
      name: group.displayName,
      avgAmount: avg,
      occurrences,
      occurrencesPerMonth,
      monthsObserved: monthCount,
      frequency: frequencyInfo.name,
      frequencyColor: frequencyInfo.color,
      isFixed: coefficientOfVariation < 0.1,
      consistency: Math.round(consistency * 100),
      category: group.category,
      subcategory: group.subcategory,
      iconName: group.iconName
    });
  });

  // Sort by total spending
  recurring.sort((a, b) => (b.avgAmount * b.occurrences) - (a.avgAmount * a.occurrences));

  return recurring.slice(0, 30); // Top 30 patterns
}

/**
 * Detect patterns at category level
 */
function detectCategoryPatterns(transactions) {
  const categoryGroups = new Map();

  transactions.forEach(txn => {
    const category = txn.localizedParentCategory || txn.localizedCategory || 'Uncategorized';
    
    if (!categoryGroups.has(category)) {
      categoryGroups.set(category, {
        category,
        iconName: txn.parent_icon || txn.icon_name,
        amounts: [],
        dates: [],
        months: new Set()
      });
    }

    const group = categoryGroups.get(category);
    group.amounts.push(Math.abs(txn.price));
    group.dates.push(txn.date);
    group.months.add(txn.month);
  });

  const monthCount = new Set(transactions.map(t => t.month)).size || 1;
  const patterns = [];

  categoryGroups.forEach((group) => {
    const occurrences = group.amounts.length;
    const totalAmount = group.amounts.reduce((sum, a) => sum + a, 0);
    const avgAmount = totalAmount / occurrences;
    const occurrencesPerMonth = occurrences / monthCount;

    const frequencyInfo = detectFrequency(occurrencesPerMonth);
    const expectedIntervalDays = {
      daily: 1, weekly: 7, biweekly: 14, monthly: 30, bimonthly: 60
    }[frequencyInfo.name] || 30;

    const consistency = calculateIntervalConsistency(group.dates, expectedIntervalDays);

    patterns.push({
      category: group.category,
      iconName: group.iconName,
      frequency: frequencyInfo.name,
      frequencyColor: frequencyInfo.color,
      avgAmount,
      totalAmount,
      occurrences,
      consistency: Math.round(consistency * 100)
    });
  });

  patterns.sort((a, b) => b.totalAmount - a.totalAmount);
  return patterns.slice(0, 15);
}

/**
 * Detect patterns at subcategory level
 */
function detectSubcategoryPatterns(transactions) {
  const subcategoryGroups = new Map();

  transactions.forEach(txn => {
    // Only include transactions that have both category and subcategory
    if (!txn.localizedCategory || !txn.localizedParentCategory) return;
    
    const key = `${txn.localizedParentCategory}::${txn.localizedCategory}`;
    
    if (!subcategoryGroups.has(key)) {
      subcategoryGroups.set(key, {
        category: txn.localizedParentCategory,
        subcategory: txn.localizedCategory,
        iconName: txn.icon_name,
        amounts: [],
        dates: [],
        months: new Set()
      });
    }

    const group = subcategoryGroups.get(key);
    group.amounts.push(Math.abs(txn.price));
    group.dates.push(txn.date);
    group.months.add(txn.month);
  });

  const monthCount = new Set(transactions.map(t => t.month)).size || 1;
  const patterns = [];

  subcategoryGroups.forEach((group) => {
    const occurrences = group.amounts.length;
    if (occurrences < 2) return; // Need at least 2 occurrences

    const totalAmount = group.amounts.reduce((sum, a) => sum + a, 0);
    const avgAmount = totalAmount / occurrences;
    const occurrencesPerMonth = occurrences / monthCount;

    const frequencyInfo = detectFrequency(occurrencesPerMonth);
    const expectedIntervalDays = {
      daily: 1, weekly: 7, biweekly: 14, monthly: 30, bimonthly: 60
    }[frequencyInfo.name] || 30;

    const consistency = calculateIntervalConsistency(group.dates, expectedIntervalDays);

    patterns.push({
      category: group.category,
      subcategory: group.subcategory,
      iconName: group.iconName,
      frequency: frequencyInfo.name,
      frequencyColor: frequencyInfo.color,
      avgAmount,
      totalAmount,
      occurrences,
      consistency: Math.round(consistency * 100)
    });
  });

  patterns.sort((a, b) => b.totalAmount - a.totalAmount);
  return patterns.slice(0, 20);
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
    const category = txn.localizedCategory || txn.localizedParentCategory || 'Uncategorized';
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
