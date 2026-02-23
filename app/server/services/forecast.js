/**
 * Financial Forecasting Service (in-process port of app/scripts/forecast-script-daily.js)
 * Generates day-by-day expenses, income, and investments without relying on temp JSON files.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
let databaseCtor = Database;

function parsePositiveInt(value, fallback) {
  const numberValue = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.floor(numberValue);
}

const DEFAULT_MONTE_CARLO_RUNS = parsePositiveInt(process.env.FORECAST_MONTE_CARLO_RUNS, 300);
const DEFAULT_HISTORY_MONTHS = parsePositiveInt(process.env.FORECAST_HISTORY_MONTHS, 24);
const DEFAULT_FORECAST_CACHE_TTL_MS = parsePositiveInt(process.env.FORECAST_CACHE_TTL_MS, 5 * 60 * 1000);
const MIN_EXPENSE_MONTHLY_MONTHS = parsePositiveInt(process.env.FORECAST_MIN_EXPENSE_MONTHLY_MONTHS, 3);
const MIN_EXPENSE_MONTHLY_OCCURRENCES = parsePositiveInt(process.env.FORECAST_MIN_EXPENSE_MONTHLY_OCCURRENCES, 3);

const forecastResultCache = new Map();

function resolveForecastDbPath() {
  if (process.env.SQLITE_DB_PATH) {
    return process.env.SQLITE_DB_PATH;
  }
  const preferredDbPath = path.join(__dirname, '../../dist/shekelsync.sqlite');
  const legacyDbPath = path.join(__dirname, '../../dist/clarify.sqlite');
  if (fs.existsSync(preferredDbPath)) {
    return preferredDbPath;
  }
  if (fs.existsSync(legacyDbPath)) {
    return legacyDbPath;
  }
  return preferredDbPath;
}

function openForecastDb() {
  const db = new databaseCtor(CONFIG.dbPath, { readonly: true });
  return db;
}

// ==================== CONFIGURATION ====================
const CONFIG = {
  // Prefer explicit DB path when provided (e.g., dev runs with SQLITE_DB_PATH)
  dbPath: resolveForecastDbPath(),
  verbose: false,
  forecastDays: null, // null = use forecastMonths horizon
  forecastMonths: 6,
  includeToday: false,
  monteCarloRuns: DEFAULT_MONTE_CARLO_RUNS,
};

const log = (...args) => {
  if (CONFIG.verbose) {
    console.log(...args);
  }
};

// ==================== DATABASE QUERIES ====================
function getAllTransactions(db, sinceDate = null) {
  const filter = sinceDate ? 'AND t.date >= ?' : '';
  const query = `
    SELECT
      t.date,
      t.name,
      t.price,
      t.category_type,
      cd.name as category_name,
      parent_cd.name as parent_category_name,
      strftime('%w', t.date) as day_of_week,
      CAST(strftime('%d', t.date) AS INTEGER) as day_of_month,
      strftime('%Y-%m', t.date) as month
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN category_definitions parent_cd ON cd.parent_id = parent_cd.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE t.status = 'completed'
      AND tpe.transaction_identifier IS NULL
      ${filter}
    ORDER BY t.date;
  `;
  const statement = db.prepare(query);
  return sinceDate ? statement.all(sinceDate) : statement.all();
}

function getCurrentMonthTransactions(db, currentMonth) {
  const query = `
    SELECT
      t.date,
      t.name,
      t.price,
      t.category_type,
      cd.name as category_name,
      strftime('%w', t.date) as day_of_week,
      CAST(strftime('%d', t.date) AS INTEGER) as day_of_month
    FROM transactions t
    LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
    LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
      ON t.identifier = tpe.transaction_identifier
      AND t.vendor = tpe.transaction_vendor
    WHERE strftime('%Y-%m', t.date) = ?
      AND t.status = 'completed'
      AND tpe.transaction_identifier IS NULL
    ORDER BY t.date;
  `;
  return db.prepare(query).all(currentMonth);
}

// ==================== UTILITY FUNCTIONS ====================
function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function isLastDayOfMonth(date) {
  return date.getDate() === getDaysInMonth(date.getFullYear(), date.getMonth());
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr) {
  if (!dateStr) return new Date(dateStr);
  if (typeof dateStr !== 'string') return new Date(dateStr);
  if (dateStr.includes('T')) return new Date(dateStr);

  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date(dateStr);
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function resolveForecastWindow(now, { includeToday, forecastDays, forecastMonths }) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = includeToday
    ? todayStart
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  if (typeof forecastDays === 'number') {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + forecastDays - 1);
    return { startDate, endDate };
  }

  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + forecastMonths, 0);
  return { startDate, endDate };
}

function getDayName(dayOfWeek) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek];
}

// ==================== PATTERN ANALYSIS ====================
function analyzeCategoryPatterns(transactions) {
  const patterns = {};
  if (transactions.length === 0) return patterns;

  const allMonths = new Set(transactions.map(t => t.month));
  const totalHistoricalMonths = allMonths.size;
  log(`Total historical months: ${totalHistoricalMonths}`);

  const excludeCategories = ['החזר קרן', 'ריבית מהשקעות', 'פיקדונות'];
  const tempPatterns = {};

  transactions.forEach(txn => {
    const categoryKey = txn.category_name || 'Uncategorized';
    if (excludeCategories.includes(categoryKey)) return;
    if (!tempPatterns[categoryKey]) tempPatterns[categoryKey] = [];
    tempPatterns[categoryKey].push(txn);
  });

  Object.entries(tempPatterns).forEach(([categoryKey, txns]) => {
    const categoryType = txns[0]?.category_type;

    // Some categories include multiple distinct recurring items (e.g., multiple salary sources).
    // Split only when we see repeatable transaction names; otherwise keep category-level grouping.
    const txnsByName = new Map();
    txns.forEach(txn => {
      const nameKey = typeof txn.name === 'string' ? txn.name.trim() : '';
      if (!txnsByName.has(nameKey)) txnsByName.set(nameKey, []);
      txnsByName.get(nameKey).push(txn);
    });

    const minOccurrencesForSplit = categoryType === 'expense' ? 2 : 3;
    const recurringNameGroups = Array.from(txnsByName.entries())
      .filter(([name]) => name)
      .filter(([, group]) => {
        const months = new Set(group.map(t => t.month)).size;
        return months >= 2 && group.length >= minOccurrencesForSplit;
      });

    // For expense categories, DON'T split by transaction name - this fragments patterns
    // and causes severe underestimation. Keep all transactions under the category.
    // Only split income patterns (e.g., multiple salary sources) where each source is distinct.
    const shouldSplit = categoryType === 'income' && recurringNameGroups.length >= 1;

    const addTxnToPattern = (patternKey, txn, { includeDailyTotals } = {}) => {
      if (!patterns[patternKey]) {
        patterns[patternKey] = {
          category: categoryKey,
          transactionName: txn.name || null,
          categoryType: txn.category_type,
          parentCategory: txn.parent_category_name,
          transactions: [],
          amounts: [],
          ...(includeDailyTotals ? { dailyTotals: {} } : {}),
          daysOfWeek: {},
          daysOfMonth: {},
          monthlyOccurrences: {},
          totalCount: 0,
          firstTransactionDate: null,
          lastTransactionDate: null,
        };
      }

      patterns[patternKey].transactions.push(txn);
      patterns[patternKey].amounts.push(Math.abs(txn.price));
      patterns[patternKey].totalCount++;

      // Track first and last transaction dates for accurate time span calculation
      const txnDate = txn.date;
      if (!patterns[patternKey].firstTransactionDate || txnDate < patterns[patternKey].firstTransactionDate) {
        patterns[patternKey].firstTransactionDate = txnDate;
      }
      if (!patterns[patternKey].lastTransactionDate || txnDate > patterns[patternKey].lastTransactionDate) {
        patterns[patternKey].lastTransactionDate = txnDate;
      }

      if (includeDailyTotals) {
        const day = txn.date.split('T')[0];
        patterns[patternKey].dailyTotals[day] = (patterns[patternKey].dailyTotals[day] || 0) + Math.abs(txn.price);
      }

      const dow = txn.day_of_week;
      patterns[patternKey].daysOfWeek[dow] = (patterns[patternKey].daysOfWeek[dow] || 0) + 1;
      const dom = txn.day_of_month;
      patterns[patternKey].daysOfMonth[dom] = (patterns[patternKey].daysOfMonth[dom] || 0) + 1;
      const month = txn.month;
      patterns[patternKey].monthlyOccurrences[month] = (patterns[patternKey].monthlyOccurrences[month] || 0) + 1;
    };

    if (shouldSplit) {
      const used = new Set();
      recurringNameGroups.forEach(([name, group]) => {
        group.forEach(txn => {
          used.add(txn);
          addTxnToPattern(name, txn);
        });
      });

      const leftovers = txns.filter(txn => !used.has(txn));
      leftovers.forEach(txn => {
        addTxnToPattern(categoryKey, txn, { includeDailyTotals: true });
      });
      if (leftovers.length > 0 && patterns[categoryKey]) {
        patterns[categoryKey].transactionName = null;
      }
    } else {
      txns.forEach(txn => {
        addTxnToPattern(categoryKey, txn, { includeDailyTotals: true });
      });
      patterns[categoryKey].transactionName = null;
    }
  });

  Object.keys(patterns).forEach(key => {
    const p = patterns[key];
    const uniqueMonths = Object.keys(p.monthlyOccurrences).length;
    p.monthsOfHistory = uniqueMonths;

    const hasMinimumMonths = uniqueMonths >= 2;
    const minimumOccurrencesThreshold = p.categoryType === 'expense' ? 2 : 3;
    const hasMinimumOccurrences = p.totalCount >= minimumOccurrencesThreshold;
    const passesExpenseRelax = p.categoryType === 'expense' && (hasMinimumMonths || hasMinimumOccurrences);

    if (!hasMinimumMonths && !hasMinimumOccurrences && !passesExpenseRelax) {
      if (p.categoryType === 'expense' && uniqueMonths === 1 && p.totalCount >= 1) {
        p.tailOnly = true;
        log(`  BASELINE-EXPENSE: ${key} - sparse data but retained as tailOnly baseline`);
      } else {
        p.insufficientData = true;
        log(`  FILTERED: ${key} - only ${uniqueMonths} months and ${p.totalCount} occurrences`);
        return;
      }
    }

    p.avgAmount = mean(p.amounts);
    p.stdDev = standardDeviation(p.amounts);
    p.minAmount = Math.min(...p.amounts);
    p.maxAmount = Math.max(...p.amounts);

    const outlierThreshold = p.avgAmount + 3 * p.stdDev;
    const nonOutlierAmounts = p.amounts.filter(amt => amt <= outlierThreshold);
    if (nonOutlierAmounts.length >= p.amounts.length * 0.8) {
      p.avgAmount = mean(nonOutlierAmounts);
      p.stdDev = standardDeviation(nonOutlierAmounts);
      p.amounts = nonOutlierAmounts;
    }

    p.coefficientOfVariation = p.stdDev / (p.avgAmount || 1);
    p.isFixedAmount = p.coefficientOfVariation < 0.1;

    // Calculate actual time span from first to last transaction (more accurate than counting months with transactions)
    const monthsWithTransactions = Object.keys(p.monthlyOccurrences).length;
    let actualMonthSpan = monthsWithTransactions;
    if (p.firstTransactionDate && p.lastTransactionDate) {
      const firstDate = parseLocalDate(p.firstTransactionDate);
      const lastDate = parseLocalDate(p.lastTransactionDate);
      // Calculate months between first and last transaction, minimum 1
      actualMonthSpan = Math.max(1, 
        (lastDate.getFullYear() - firstDate.getFullYear()) * 12 + 
        (lastDate.getMonth() - firstDate.getMonth()) + 1
      );
    }
    p.actualMonthSpan = actualMonthSpan;
    p.avgOccurrencesPerMonth = p.totalCount / Math.max(actualMonthSpan, 1);
    p.avgOccurrencesPerWeek = p.totalCount / Math.max(actualMonthSpan * 4.33, 1);

    // For high-frequency categories, use daily totals instead of individual transaction amounts
    // This provides more accurate forecasting for categories like supermarket, restaurants
    if (
      p.avgOccurrencesPerMonth >= 10 &&
      p.dailyTotals &&
      Object.keys(p.dailyTotals).length > 0 &&
      mean(Object.values(p.dailyTotals)) > 0
    ) {
      const dailyTotalValues = Object.values(p.dailyTotals);
      p.avgDailyTotal = mean(dailyTotalValues);
      p.stdDevDailyTotal = standardDeviation(dailyTotalValues);
      // Use daily total if coefficient of variation is reasonable, or if frequency is very high
      const dailyCV = p.stdDevDailyTotal / Math.max(p.avgDailyTotal, 1);
      if (dailyCV < 0.8 || p.avgOccurrencesPerMonth >= 20) {
        p.useDailyTotal = true;
      }
    }

    const totalDowCount = Object.values(p.daysOfWeek).reduce((sum, count) => sum + count, 0);
    p.dayOfWeekProb = {};
    Object.keys(p.daysOfWeek).forEach(dow => {
      p.dayOfWeekProb[dow] = p.daysOfWeek[dow] / totalDowCount;
    });

    const totalDomCount = Object.values(p.daysOfMonth).reduce((sum, count) => sum + count, 0);
    p.dayOfMonthProb = {};
    Object.keys(p.daysOfMonth).forEach(dom => {
      p.dayOfMonthProb[dom] = p.daysOfMonth[dom] / totalDomCount;
    });

    // For expense patterns with very high variability AND limited history,
    // treat as sporadic to avoid over-prediction from outlier purchases
    // But exempt high-frequency patterns (10+ tx/month) which naturally have variable amounts
    // Also exempt patterns with good history (3+ months) as they show recurring behavior
    const isHighFrequency = p.avgOccurrencesPerMonth >= 10;
    const isHighlyVariable = p.coefficientOfVariation > 1.2;
    const hasLimitedHistory = p.monthsOfHistory < 3;
    const hasLowOccurrences = p.totalCount < 6;
    // Only treat as sporadic if BOTH high variability AND limited history/occurrences
    const shouldTreatAsSporadic = p.categoryType === 'expense' && 
      !isHighFrequency &&
      isHighlyVariable && 
      (hasLimitedHistory || hasLowOccurrences);

    if (p.insufficientData) {
      p.patternType = 'insufficient_data';
    } else if (shouldTreatAsSporadic) {
      // High variability or limited data - treat conservatively
      // Mark as tailOnly to use minimal baseline predictions
      p.patternType = 'sporadic';
      p.tailOnly = true;
    } else if (p.avgOccurrencesPerMonth >= 10) {
      // High-frequency patterns (10+ per month) - treat as daily occurrence patterns
      p.patternType = 'daily';
    } else if (p.avgOccurrencesPerMonth >= 4) {
      p.patternType = 'weekly';
    } else if (p.avgOccurrencesPerMonth >= 1.8) {
      p.patternType = 'weekly';
    } else if (p.avgOccurrencesPerMonth >= 0.4 && p.avgOccurrencesPerMonth < 1.8) {
      if (p.avgOccurrencesPerMonth >= 0.9 && p.avgOccurrencesPerMonth <= 1.5) {
        p.patternType = 'monthly';
      } else {
        p.patternType = 'bi-monthly';
      }
    } else {
      p.patternType = 'sporadic';
    }

    if (p.categoryType === 'investment' && (p.patternType === 'sporadic' || p.insufficientData)) {
      p.tailOnly = true;
      p.insufficientData = true;
      p.skipReason = 'non_recurrent_investment';
    }

    const needsMoreMonthlyHistory = p.categoryType === 'expense' &&
      (p.patternType === 'monthly' || p.patternType === 'bi-monthly') &&
      (p.monthsOfHistory < MIN_EXPENSE_MONTHLY_MONTHS || p.totalCount < MIN_EXPENSE_MONTHLY_OCCURRENCES);
    if (needsMoreMonthlyHistory) {
      p.patternType = 'sporadic';
      p.tailOnly = true;
      p.insufficientData = true;
      p.skipReason = 'insufficient_monthly_history';
      log(`  DOWNGRADED: ${key} - monthly/bi-monthly with limited history (${p.monthsOfHistory} months, ${p.totalCount} occurrences)`);
    }

    p.mostLikelyDaysOfWeek = Object.entries(p.dayOfWeekProb)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([dow, prob]) => ({ day: parseInt(dow), dayName: getDayName(parseInt(dow)), probability: prob }));

    p.mostLikelyDaysOfMonth = Object.entries(p.dayOfMonthProb)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dom, prob]) => ({ day: parseInt(dom), probability: prob }));

    // For monthly patterns (esp. income), detect day-of-month clusters and prefer clustered days
    // over outliers. E.g., if salary comes on days 4,5,6,7 but once on day 28, prefer 4-7.
    if (p.patternType === 'monthly' && Object.keys(p.daysOfMonth).length >= 3) {
      const sortedDays = Object.keys(p.daysOfMonth).map(Number).sort((a, b) => a - b);
      
      // Find clusters: groups of days within 5 days of each other
      const clusters = [];
      let currentCluster = [sortedDays[0]];
      for (let i = 1; i < sortedDays.length; i++) {
        // Days within 5 of each other are in the same cluster (handles month boundaries)
        const gap = sortedDays[i] - sortedDays[i - 1];
        if (gap <= 5) {
          currentCluster.push(sortedDays[i]);
        } else {
          clusters.push(currentCluster);
          currentCluster = [sortedDays[i]];
        }
      }
      clusters.push(currentCluster);

      // Find the cluster with the most occurrences
      const clusterOccurrences = clusters.map(cluster => ({
        cluster,
        totalOccurrences: cluster.reduce((sum, day) => sum + (p.daysOfMonth[day] || 0), 0),
      }));
      clusterOccurrences.sort((a, b) => b.totalOccurrences - a.totalOccurrences);
      
      const dominantCluster = clusterOccurrences[0];
      const outlierClusters = clusterOccurrences.slice(1);
      
      // If dominant cluster has significantly more occurrences than outliers, apply a boost
      const outlierTotalOccurrences = outlierClusters.reduce((sum, c) => sum + c.totalOccurrences, 0);
      const shouldBoost = dominantCluster.totalOccurrences >= 2 && dominantCluster.totalOccurrences > outlierTotalOccurrences;
      if (shouldBoost) {
        p.dominantDayCluster = dominantCluster.cluster;
        // Apply a boost factor to cluster days (reduce outlier probability)
        const boostFactor = 1.5;
        const penaltyFactor = 0.3;
        const clusterDaysSet = new Set(dominantCluster.cluster);
        
        Object.keys(p.dayOfMonthProb).forEach(dom => {
          if (clusterDaysSet.has(Number(dom))) {
            p.dayOfMonthProb[dom] *= boostFactor;
          } else {
            p.dayOfMonthProb[dom] *= penaltyFactor;
          }
        });
        
        // Re-normalize probabilities
        const totalProb = Object.values(p.dayOfMonthProb).reduce((sum, prob) => sum + prob, 0);
        if (totalProb > 0) {
          Object.keys(p.dayOfMonthProb).forEach(dom => {
            p.dayOfMonthProb[dom] /= totalProb;
          });
        }
        
        // Update mostLikelyDaysOfMonth with new probabilities
        p.mostLikelyDaysOfMonth = Object.entries(p.dayOfMonthProb)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([dom, prob]) => ({ day: parseInt(dom), probability: prob }));
        
        log(`  CLUSTER: ${p.category || p.transactionName} - dominant cluster: [${dominantCluster.cluster.join(',')}] with ${dominantCluster.totalOccurrences} occurrences`);
      }
    }

    if (p.transactions.length > 0) {
      p.lastOccurrence = p.transactions[p.transactions.length - 1].date;
      const lastDate = parseLocalDate(p.lastOccurrence);
      const now = new Date();
      p.daysSinceLastOccurrence = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
    }

    delete p.transactions;
  });

  return patterns;
}

function logPatternSummary(patterns) {
  if (!CONFIG.verbose) return;
  const byType = {};
  const byCategoryType = {};
  Object.values(patterns).forEach(p => {
    byType[p.patternType] = (byType[p.patternType] || 0) + 1;
    byCategoryType[p.categoryType] = (byCategoryType[p.categoryType] || 0) + 1;
  });
  console.log('🔎 Pattern summary:', {
    total: Object.keys(patterns).length,
    byPatternType: byType,
    byCategoryType: byCategoryType,
  });
  const skippedInvestments = Object.values(patterns).filter(p => p.skipReason === 'non_recurrent_investment').length;
  if (skippedInvestments > 0) {
    console.log(`ℹ️ Skipped ${skippedInvestments} non-recurrent investment patterns`);
  }
}

function buildPatternCaches(patterns) {
  const patternEntries = Object.entries(patterns);

  patternEntries.forEach(([, pattern]) => {
    const cache = {};
    const avgOccurrencesPerMonth = Number(pattern.avgOccurrencesPerMonth || 0);
    const domDaysRaw = Array.isArray(pattern.mostLikelyDaysOfMonth)
      ? pattern.mostLikelyDaysOfMonth
        .map(d => Number(d?.day))
        .filter(d => Number.isFinite(d))
      : [];

    cache.avgOccurrencesPerMonth = avgOccurrencesPerMonth;
    cache.isLowFrequency = avgOccurrencesPerMonth > 0 && avgOccurrencesPerMonth < 0.5;
    cache.domDaysRaw = domDaysRaw;
    cache.monthlyKey = pattern.transactionName || pattern.category;

    const dayOfWeekProb = new Array(7).fill(0);
    let maxDayOfWeekProb = 0;
    for (let i = 0; i < 7; i += 1) {
      const prob = Number(pattern.dayOfWeekProb?.[i] || 0);
      dayOfWeekProb[i] = prob;
      if (prob > maxDayOfWeekProb) maxDayOfWeekProb = prob;
    }
    cache.dayOfWeekProb = dayOfWeekProb;
    cache.maxDayOfWeekProb = maxDayOfWeekProb || 1;

    const dayOfMonthProb = new Array(32).fill(0);
    if (pattern.dayOfMonthProb) {
      Object.keys(pattern.dayOfMonthProb).forEach((dom) => {
        const index = Number(dom);
        if (index >= 1 && index <= 31) {
          dayOfMonthProb[index] = Number(pattern.dayOfMonthProb[dom] || 0);
        }
      });
    }
    cache.dayOfMonthProb = dayOfMonthProb;

    const domDaysByMonthLength = {};
    [28, 29, 30, 31].forEach((daysInMonth) => {
      const topDomDays = domDaysRaw.map(day => Math.min(day, daysInMonth));
      const topDomDaysWithGrace = [];
      const seen = new Set();
      topDomDays.forEach((day) => {
        for (let offset = -1; offset <= 1; offset += 1) {
          const adjusted = day + offset;
          if (adjusted < 1 || adjusted > daysInMonth) continue;
          if (seen.has(adjusted)) continue;
          seen.add(adjusted);
          topDomDaysWithGrace.push(adjusted);
        }
      });
      domDaysByMonthLength[daysInMonth] = {
        topDomDays,
        topDomDaysWithGrace,
      };
    });
    cache.domDaysByMonthLength = domDaysByMonthLength;

    const cov = Number(pattern.coefficientOfVariation || 0);
    if (pattern.categoryType === 'income') {
      cache.probabilityThreshold = 0.02 * (1 + cov);
    } else if (pattern.patternType === 'monthly' || pattern.patternType === 'bi-monthly') {
      cache.probabilityThreshold = 0.01 * (1 + cov);
    } else {
      cache.probabilityThreshold = 0.05 * (1 + Math.min(cov, 1));
    }

    if (pattern.lastOccurrence) {
      const lastDate = parseLocalDate(pattern.lastOccurrence);
      const lastTime = lastDate ? lastDate.getTime() : Number.NaN;
      if (Number.isFinite(lastTime)) {
        cache.lastOccurrenceDate = lastDate;
        cache.lastOccurrenceTime = lastTime;
        cache.lastOccurrenceYear = lastDate.getFullYear();
        cache.lastOccurrenceMonth = lastDate.getMonth();
      }
    }

    if (Array.isArray(pattern.dominantDayCluster)) {
      cache.dominantDayClusterSet = new Set(pattern.dominantDayCluster.map(Number));
    }

    pattern._cache = cache;
  });

  return patternEntries;
}

function getProbabilityThreshold(pattern) {
  const cached = pattern._cache?.probabilityThreshold;
  if (Number.isFinite(cached)) return cached;
  const cov = Number(pattern.coefficientOfVariation || 0);
  if (pattern.categoryType === 'income') return 0.02 * (1 + cov);
  if (pattern.patternType === 'monthly' || pattern.patternType === 'bi-monthly') return 0.01 * (1 + cov);
  return 0.05 * (1 + Math.min(cov, 1));
}

// ==================== PROBABILITY CALCULATIONS ====================
function adjustProbabilitiesForCurrentMonth(patterns, currentMonthTransactions, currentDay) {
  const adjustments = {};
  const occurredCategories = {};
  const now = new Date();
  const daysInCurrentMonth = getDaysInMonth(now.getFullYear(), now.getMonth());

  currentMonthTransactions.forEach(txn => {
    const category = txn.category_name || 'Uncategorized';
    const transactionName = txn.name;
    const patternKey = patterns[transactionName] ? transactionName : category;
    if (!occurredCategories[patternKey]) {
      occurredCategories[patternKey] = [];
    }
    occurredCategories[patternKey].push({
      date: txn.date,
      day: txn.day_of_month,
      dayOfWeek: txn.day_of_week,
      amount: Math.abs(txn.price),
    });
  });

  Object.keys(patterns).forEach(patternKey => {
    const pattern = patterns[patternKey];
    const occurred = occurredCategories[patternKey] || [];

    adjustments[patternKey] = {
      alreadyOccurred: occurred.length,
      expectedRemaining: Math.max(0, pattern.avgOccurrencesPerMonth - occurred.length),
      lastOccurrenceThisMonth: occurred.length > 0 ? occurred[occurred.length - 1].day : null,
      probabilityMultiplier: 1.0,
    };

    if (pattern.patternType === 'monthly' && occurred.length > 0) {
      if (pattern.categoryType === 'income') {
        adjustments[patternKey].probabilityMultiplier = 0.0;
      } else {
        adjustments[patternKey].probabilityMultiplier = 0.2;
      }
    } else if (pattern.patternType === 'weekly' || pattern.patternType === 'daily') {
      const expectedByNow = (pattern.avgOccurrencesPerMonth / 30) * currentDay;
      if (occurred.length < expectedByNow) {
        adjustments[patternKey].probabilityMultiplier = 1.3;
      } else if (occurred.length > expectedByNow) {
        adjustments[patternKey].probabilityMultiplier = 0.7;
      }
    }

    if (occurred.length > 0) {
      const daysSinceLastOccurrence = currentDay - occurred[occurred.length - 1].day;
      if (daysSinceLastOccurrence <= 1) {
        adjustments[patternKey].probabilityMultiplier *= 0.5;
      } else if (daysSinceLastOccurrence <= 3) {
        adjustments[patternKey].probabilityMultiplier *= 0.8;
      }
    }

    if (pattern.patternType === 'monthly' && pattern.categoryType === 'expense' && occurred.length === 0 && currentDay > 0) {
      const dominantDays = Array.isArray(pattern.dominantDayCluster) && pattern.dominantDayCluster.length > 0
        ? pattern.dominantDayCluster
        : (pattern.mostLikelyDaysOfMonth || []).slice(0, 1).map(d => d.day);
      if (dominantDays.length > 0) {
        const latestLikelyDay = Math.max(...dominantDays.map(day => Math.min(day, daysInCurrentMonth)));
        const graceDays = 7;
        if (currentDay > latestLikelyDay + graceDays) {
          adjustments[patternKey].probabilityMultiplier = 0;
          adjustments[patternKey].expectedRemaining = 0;
        }
      }
    }
  });

  return adjustments;
}

function calculateDayProbability(pattern, date, adjustments, patternKey) {
  const cache = pattern._cache || {};
  const dayOfWeek = date.getDay();
  const dayOfMonth = date.getDate();
  const daysInMonthForDate = getDaysInMonth(date.getFullYear(), date.getMonth());
  const topDomDaysRaw = Array.isArray(cache.domDaysRaw)
    ? cache.domDaysRaw
    : (pattern.mostLikelyDaysOfMonth ? pattern.mostLikelyDaysOfMonth.map(d => d.day) : []);
  const domDaysCache = cache.domDaysByMonthLength?.[daysInMonthForDate];
  const topDomDays = domDaysCache?.topDomDays || topDomDaysRaw.map(d => Math.min(d, daysInMonthForDate));
  const topDomDaysWithGrace = domDaysCache?.topDomDaysWithGrace || Array.from(
    new Set(topDomDays.flatMap(d => [d - 1, d, d + 1]).filter(d => d >= 1 && d <= daysInMonthForDate))
  );
  const avgOccurrencesPerMonth = Number.isFinite(cache.avgOccurrencesPerMonth)
    ? cache.avgOccurrencesPerMonth
    : Number(pattern.avgOccurrencesPerMonth || 0);
  const isLowFrequency = typeof cache.isLowFrequency === 'boolean'
    ? cache.isLowFrequency
    : (avgOccurrencesPerMonth > 0 && avgOccurrencesPerMonth < 0.5);
  if (isLowFrequency && topDomDaysWithGrace.length > 0 && !topDomDaysWithGrace.includes(dayOfMonth)) {
    return 0;
  }

  let probability = 0;
  const dowProb = Array.isArray(cache.dayOfWeekProb)
    ? cache.dayOfWeekProb[dayOfWeek] || 0
    : pattern.dayOfWeekProb[dayOfWeek] || 0;
  let domProb = Array.isArray(cache.dayOfMonthProb)
    ? cache.dayOfMonthProb[dayOfMonth] || 0
    : pattern.dayOfMonthProb[dayOfMonth] || 0;
  if (domProb === 0 && dayOfMonth === daysInMonthForDate) {
    // Month-length edge case: if a pattern is tied to a day that doesn't exist in this month
    // (e.g. 30/31 in February), shift the day-of-month signal to the last day.
    const overflowDomDay = topDomDaysRaw.find(d => d > daysInMonthForDate);
    if (overflowDomDay) {
      domProb = Array.isArray(cache.dayOfMonthProb)
        ? cache.dayOfMonthProb[overflowDomDay] || 0
        : pattern.dayOfMonthProb[overflowDomDay] || 0;
    }
  }

  if (pattern.patternType === 'daily') {
    const avgDailyFrequency = pattern.avgOccurrencesPerMonth / 30;
    const maxDowProb = Number.isFinite(cache.maxDayOfWeekProb)
      ? cache.maxDayOfWeekProb
      : Math.max(...Object.values(pattern.dayOfWeekProb));
    const dowAdjustment = dowProb > 0 ? dowProb / Math.max(maxDowProb, 1) : 1.0;
    probability = avgDailyFrequency * dowAdjustment;
  } else if (pattern.patternType === 'monthly') {
    if (topDomDays.length > 0 && !topDomDaysWithGrace.includes(dayOfMonth)) {
      return 0;
    }
    
    // For monthly income with a dominant cluster, if:
    // 1. We're predicting for a day OUTSIDE the dominant cluster
    // 2. The last occurrence was within 45 days (suggesting the current month may be covered)
    // Then heavily penalize outlier days to avoid double-predicting
    if (pattern.categoryType === 'income' && pattern.dominantDayCluster && pattern.lastOccurrence) {
      const clusterDaysSet = cache.dominantDayClusterSet || new Set(pattern.dominantDayCluster);
      const isOutlierDay = !clusterDaysSet.has(dayOfMonth);
      
      if (isOutlierDay) {
        const lastDate = cache.lastOccurrenceDate || parseLocalDate(pattern.lastOccurrence);
        const daysSinceLast = Math.floor((date - lastDate) / (1000 * 60 * 60 * 24));
        // If last occurrence was within 45 days and this is an outlier day, 
        // reduce probability significantly - the outlier day was likely a one-time event
        if (daysSinceLast >= 0 && daysSinceLast <= 45) {
          return 0; // Skip outlier days if we had a recent occurrence
        }
      }
    }
    
    if (pattern.categoryType === 'income') {
      // For income, allow a small grace window (handled above) and let the monthly adjustment step
      // select a single occurrence for the month.
      probability = domProb * 0.95 + dowProb * 0.05;
    } else {
      probability = domProb * 0.8 + dowProb * 0.2;
    }
  } else if (pattern.patternType === 'weekly') {
    probability = dowProb * 0.7 + domProb * 0.3;
  } else if (pattern.patternType === 'bi-monthly') {
    probability = (dowProb + domProb) / 2;
  } else {
    probability = (dowProb + domProb) / 2;
  }

  const adjustment = adjustments[patternKey];
  if (adjustment) {
    probability *= adjustment.probabilityMultiplier;
  }

  if (pattern.lastOccurrence) {
    const lastDate = cache.lastOccurrenceDate || parseLocalDate(pattern.lastOccurrence);
    const daysSinceLast = Math.floor((date - lastDate) / (1000 * 60 * 60 * 24));
    if (!isNaN(daysSinceLast) && daysSinceLast >= 0) {
      const lastYear = Number.isFinite(cache.lastOccurrenceYear) ? cache.lastOccurrenceYear : lastDate.getFullYear();
      const lastMonth = Number.isFinite(cache.lastOccurrenceMonth) ? cache.lastOccurrenceMonth : lastDate.getMonth();
      const monthsSinceLast =
        (date.getFullYear() - lastYear) * 12 +
        (date.getMonth() - lastMonth);
      const expectedSpacing = 30 / Math.max(avgOccurrencesPerMonth || 0.001, 0.001);

      // Timeline-oriented guardrail: prevent "double counting" monthly patterns when a transaction
      // happens very late in the previous month (e.g., salary paid early) and would otherwise be
      // forecast again at the start of the next month.
      if ((pattern.patternType === 'monthly' || pattern.patternType === 'bi-monthly')) {
        const minGapDays = Math.max(7, Math.round(expectedSpacing * 0.5));
        if (daysSinceLast < minGapDays) {
          return 0;
        }
      }
      if (isLowFrequency) {
        const minGapDays = Math.max(30, Math.round(expectedSpacing * 0.8));
        if (daysSinceLast < minGapDays) {
          return 0;
        }
      }

      const allowShortGapAcrossMonths =
        (pattern.patternType === 'monthly' && monthsSinceLast >= 1) ||
        (pattern.patternType === 'bi-monthly' && monthsSinceLast >= 2);

      if (!allowShortGapAcrossMonths) {
        if (daysSinceLast < expectedSpacing * 0.7) {
          probability *= 0.15;
        } else if (daysSinceLast < expectedSpacing * 0.9) {
          probability *= 0.45;
        }
      }

      if (daysSinceLast > expectedSpacing * 1.3) {
        probability *= 1.2;
      }
    }
  }

  if (pattern.patternType !== 'daily') {
    if (pattern.patternType === 'monthly') {
      // Monthly patterns (both income and expense) should be boosted to ensure
      // they're predicted when on their typical days of the month
      // For monthly patterns, the probability is already based on day-of-month match,
      // we boost it to ensure it passes the threshold on likely days
      probability = probability * 12;
    } else if (pattern.patternType === 'bi-monthly') {
      // Bi-monthly patterns (0.4-0.9 occurrences per month) - boost moderately
      probability = probability * 6;
    } else if (pattern.patternType === 'weekly') {
      // Weekly patterns (1.8-10 occurrences per month)
      // The dow/dom probability already captures relative likelihood per day
      // Scale to target the expected daily frequency (avgOccurrencesPerMonth/30)
      // Base probability after dow/dom weighting is typically 0.15-0.30 on likely days
      // We want to scale so that sum of probabilities across month ≈ avgOccurrencesPerMonth
      const targetDailyProb = pattern.avgOccurrencesPerMonth / 30;
      // Assume avg dow/dom probability across all days is ~0.1, so likely days are ~2-3x that
      // Scale probability to make likely days contribute appropriately to monthly total
      const scaleFactor = Math.min(2.0, targetDailyProb * 10);
      probability = probability * scaleFactor;
    } else {
      // Sporadic patterns - minimal boost
      probability = probability * 2;
    }
  }

  if (pattern.categoryType === 'expense' && pattern.tailOnly) {
    probability = Math.max(probability, 0.04);
  }

  // For non-daily patterns, cap probability at reasonable levels
  // Daily patterns can have probability > 1 (representing multiple transactions per day)
  if (pattern.patternType !== 'daily') {
    if (pattern.categoryType === 'expense' && pattern.avgOccurrencesPerMonth >= 8) {
      probability = Math.min(probability, 0.7);
    }
    probability = Math.min(probability, 0.95);
  }
  
  probability = Math.max(probability, 0.0);
  return probability;
}

// ==================== SIMULATION ====================
function sampleAmount(avgAmount, stdDev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const amount = avgAmount + z * stdDev;
  return Math.max(0, amount);
}

function willOccur(probability) {
  return Math.random() < probability;
}

function buildChosenMonthlyOccurrenceDateByMonth(dailyForecasts) {
  const chosenMonthlyOccurrenceDateByMonth = {};
  dailyForecasts.forEach((day) => {
    const monthKey = typeof day?.date === 'string' ? day.date.slice(0, 7) : null;
    if (!monthKey) return;
    (day.predictions || []).forEach((pred) => {
      if (!pred?.isChosenOccurrence) return;
      const key = pred.transactionName || pred.category;
      if (!key) return;
      if (!chosenMonthlyOccurrenceDateByMonth[monthKey]) chosenMonthlyOccurrenceDateByMonth[monthKey] = {};
      chosenMonthlyOccurrenceDateByMonth[monthKey][key] = day.date;
    });
  });
  return chosenMonthlyOccurrenceDateByMonth;
}

function simulateScenario(simulationEntriesByDay, chosenMonthlyOccurrenceDateByMonth) {
  const scenario = {
    totalIncome: 0,
    totalExpenses: 0,
    totalInvestments: 0,
    dailyResults: [],
  };

  const monthlyOccurrences = {};

  simulationEntriesByDay.forEach(dayInfo => {
    const monthKey = dayInfo.monthKey;
    if (!monthlyOccurrences[monthKey]) {
      monthlyOccurrences[monthKey] = new Set();
    }

    let dayIncome = 0;
    let dayExpenses = 0;
    let dayInvestments = 0;

    dayInfo.entries.forEach(entry => {
      const effectiveProb = entry.probability;
      if (entry.patternType === 'monthly') {
        const monthlyKey = entry.monthlyKey;
        const monthSet = monthlyOccurrences[monthKey];
        if (monthSet.has(monthlyKey)) return;

        const chosenDate = chosenMonthlyOccurrenceDateByMonth[monthKey]?.[monthlyKey];
        if (chosenDate && chosenDate !== dayInfo.date) {
          return;
        }

        if (chosenDate ? true : willOccur(effectiveProb)) {
          monthSet.add(monthlyKey);
          const amount = sampleAmount(entry.avgAmount, entry.stdDev);
          if (entry.categoryType === 'income') dayIncome += amount;
          else if (entry.categoryType === 'expense') dayExpenses += amount;
          else if (entry.categoryType === 'investment') dayInvestments += amount;
        }
      } else {
        if (willOccur(effectiveProb)) {
          const amount = sampleAmount(entry.avgAmount, entry.stdDev);
          if (entry.categoryType === 'income') dayIncome += amount;
          else if (entry.categoryType === 'expense') dayExpenses += amount;
          else if (entry.categoryType === 'investment') dayInvestments += amount;
        }
      }
    });

    scenario.dailyResults.push({
      date: dayInfo.date,
      income: dayIncome,
      expenses: dayExpenses,
      investments: dayInvestments,
      cashFlow: dayIncome - dayExpenses,
    });

    scenario.totalIncome += dayIncome;
    scenario.totalExpenses += dayExpenses;
    scenario.totalInvestments += dayInvestments;
  });

  scenario.totalCashFlow = scenario.totalIncome - scenario.totalExpenses;
  return scenario;
}

function runMonteCarloSimulation(dailyForecasts, simulationEntriesByDay, numSimulations = CONFIG.monteCarloRuns) {
  const scenarios = [];
  const chosenMonthlyOccurrenceDateByMonth = buildChosenMonthlyOccurrenceDateByMonth(dailyForecasts);
  for (let i = 0; i < numSimulations; i++) {
    scenarios.push(simulateScenario(simulationEntriesByDay, chosenMonthlyOccurrenceDateByMonth));
  }
  scenarios.sort((a, b) => a.totalCashFlow - b.totalCashFlow);

  const p10Index = Math.floor(numSimulations * 0.10);
  const p50Index = Math.floor(numSimulations * 0.50);
  const p90Index = Math.floor(numSimulations * 0.90);

  return {
    numSimulations,
    worst: scenarios[p10Index],
    base: scenarios[p50Index],
    best: scenarios[p90Index],
    allScenarios: scenarios,
  };
}

// ==================== FORECASTING ====================
function forecastDay(date, patterns, adjustments, patternEntries, simulationEntries) {
  const predictions = [];
  let expectedIncome = 0;
  let expectedExpenses = 0;
  let expectedInvestments = 0;
  const monthlyExpenseFloorByCategory = {};
  const expectedExpensesByCategory = {};

  const entries = patternEntries || Object.entries(patterns);
  entries.forEach(([category, pattern]) => {
    if (pattern.insufficientData && !pattern.tailOnly) return;

    const probability = calculateDayProbability(pattern, date, adjustments, category);
    const effectiveProb = pattern.tailOnly ? Math.min(probability, 0.01) : probability;

    const threshold = getProbabilityThreshold(pattern);

    if (effectiveProb >= threshold) {
      const expectedAmount = pattern.useDailyTotal ? pattern.avgDailyTotal : pattern.avgAmount;
      const stdDev = pattern.useDailyTotal ? pattern.stdDevDailyTotal : pattern.stdDev;
      const transactionName = pattern._cache?.monthlyKey || pattern.transactionName || pattern.category;

      const prediction = {
        category: pattern.category,
        transactionName,
        categoryType: pattern.categoryType,
        parentCategory: pattern.parentCategory,
        probability: effectiveProb,
        expectedAmount: expectedAmount,
        amountRange: {
          low: Math.max(0, expectedAmount - stdDev),
          high: expectedAmount + stdDev,
        },
        probabilityWeightedAmount: effectiveProb * expectedAmount,
        useDailyTotal: pattern.useDailyTotal || false,
      };

      predictions.push(prediction);

      if (simulationEntries) {
        simulationEntries.push({
          patternKey: category,
          monthlyKey: transactionName,
          categoryType: pattern.categoryType,
          patternType: pattern.patternType,
          probability: effectiveProb,
          avgAmount: expectedAmount,
          stdDev,
        });
      }

      if (pattern.categoryType === 'income') {
        expectedIncome += prediction.probabilityWeightedAmount;
      } else if (pattern.categoryType === 'expense') {
        expectedExpenses += prediction.probabilityWeightedAmount;
        expectedExpensesByCategory[prediction.category] = (expectedExpensesByCategory[prediction.category] || 0) + prediction.probabilityWeightedAmount;
        if (pattern.avgAmount && pattern.avgOccurrencesPerMonth) {
          const monthlyAvg = pattern.avgAmount * pattern.avgOccurrencesPerMonth;
          const isHighFrequency = pattern.avgOccurrencesPerMonth >= 8;
          monthlyExpenseFloorByCategory[pattern.category] = Math.max(
            monthlyExpenseFloorByCategory[pattern.category] || 0,
            isHighFrequency ? monthlyAvg : monthlyAvg * 1.0
          );
        }
      } else if (pattern.categoryType === 'investment') {
        expectedInvestments += prediction.probabilityWeightedAmount;
      }
    }
  });

  const daysInMonthForDate = getDaysInMonth(date.getFullYear(), date.getMonth());
  Object.entries(monthlyExpenseFloorByCategory).forEach(([cat, monthlyFloor]) => {
    const floorPerDay = monthlyFloor / daysInMonthForDate;
    const alreadyExpected = expectedExpensesByCategory[cat] || 0;
    if (floorPerDay > alreadyExpected) {
      const delta = floorPerDay - alreadyExpected;
      expectedExpenses += delta;
    }
  });

  predictions.sort((a, b) => b.probability - a.probability);

  return {
    date: formatDate(date),
    dayOfWeek: date.getDay(),
    dayOfWeekName: getDayName(date.getDay()),
    dayOfMonth: date.getDate(),
    predictions,
    expectedIncome,
    expectedExpenses,
    expectedInvestments,
    expectedCashFlow: expectedIncome - expectedExpenses,
    topPredictions: predictions.slice(0, 5),
  };
}

function adjustMonthlyPatternForecasts(dailyForecasts, patterns, adjustments) {
  const monthlyPatterns = Object.entries(patterns)
    .filter(([key, pattern]) => {
      const adjustment = adjustments[key];
      return pattern.patternType === 'monthly' && (!adjustment || adjustment.probabilityMultiplier > 0);
    })
    .map(([key, pattern]) => ({
      key,
      transactionName: pattern.transactionName || pattern.category,
      category: pattern.category,
      categoryType: pattern.categoryType,
      avgAmount: pattern.avgAmount,
    }));

  if (monthlyPatterns.length > 0) {
    const monthlyKeys = new Set(monthlyPatterns.map(p => p.transactionName));
    const predictionsByKey = new Map();

    dailyForecasts.forEach((day, dayIndex) => {
      if (!Array.isArray(day.predictions)) return;
      day.predictions.forEach(pred => {
        const key = pred.transactionName || pred.category;
        if (!monthlyKeys.has(key)) return;
        if (!predictionsByKey.has(key)) predictionsByKey.set(key, []);
        predictionsByKey.get(key).push({ dayIndex, prediction: pred, probability: pred.probability });
      });
    });

    monthlyPatterns.forEach(monthlyPattern => {
      const patternKey = monthlyPattern.transactionName;
      const daysWithPattern = predictionsByKey.get(patternKey);
      if (!daysWithPattern || daysWithPattern.length === 0) return;
      const maxProbDay = daysWithPattern.reduce((max, curr) => (curr.probability > max.probability ? curr : max));

      daysWithPattern.forEach(({ dayIndex, prediction }) => {
        const day = dailyForecasts[dayIndex];
        if (dayIndex === maxProbDay.dayIndex) {
          const adjustmentDelta = prediction.expectedAmount - prediction.probabilityWeightedAmount;
          if (monthlyPattern.categoryType === 'income') day.expectedIncome += adjustmentDelta;
          else if (monthlyPattern.categoryType === 'expense') day.expectedExpenses += adjustmentDelta;
          day.expectedCashFlow = day.expectedIncome - day.expectedExpenses;
          prediction.probability = 1;
          prediction.probabilityWeightedAmount = prediction.expectedAmount;
          prediction.isChosenOccurrence = true;
        } else {
          const adjustmentDelta = -prediction.probabilityWeightedAmount;
          if (monthlyPattern.categoryType === 'income') day.expectedIncome += adjustmentDelta;
          else if (monthlyPattern.categoryType === 'expense') day.expectedExpenses += adjustmentDelta;
          day.expectedCashFlow = day.expectedIncome - day.expectedExpenses;
          prediction.probability = 0;
          prediction.probabilityWeightedAmount = 0;
          prediction.isChosenOccurrence = false;
        }
      });
    });
  }

  // Re-sort predictions/topPredictions since monthly normalization changes probabilities.
  dailyForecasts.forEach((day) => {
    if (!Array.isArray(day.predictions)) return;
    day.predictions.sort((a, b) => {
      const probDiff = (Number(b?.probability) || 0) - (Number(a?.probability) || 0);
      if (probDiff !== 0) return probDiff;
      return (Number(b?.expectedAmount) || 0) - (Number(a?.expectedAmount) || 0);
    });
    day.topPredictions = day.predictions
      .filter((p) => (Number(p?.probabilityWeightedAmount) || 0) > 0)
      .slice(0, 5);
  });
}

function generateForecastAcrossMonths(patterns, patternEntries, db, startDate, endDate, now, currentMonthTransactions) {
  const dailyForecasts = [];
  const simulationEntriesByDay = [];
  const adjustmentsByMonth = {};
  let cursor = new Date(startDate);

  while (cursor <= endDate) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    const monthStart = new Date(cursor);
    const monthEndOfMonth = new Date(year, month + 1, 0);
    const monthEnd = monthEndOfMonth < endDate ? monthEndOfMonth : endDate;

    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    const monthTransactions = isCurrentMonth
      ? (currentMonthTransactions || getCurrentMonthTransactions(db, monthKey))
      : [];
    const currentDayForAdjustments = isCurrentMonth ? now.getDate() : 0;
    const monthAdjustments = adjustProbabilitiesForCurrentMonth(patterns, monthTransactions, currentDayForAdjustments);
    adjustmentsByMonth[monthKey] = monthAdjustments;
    log(`📅 Month ${monthKey}: txns=${monthTransactions.length} days=${formatDate(monthStart)}→${formatDate(monthEnd)}`);

    const monthForecasts = [];
    let dayCursor = new Date(monthStart);
    while (dayCursor <= monthEnd) {
      const simulationEntries = [];
      const dayForecast = forecastDay(dayCursor, patterns, monthAdjustments, patternEntries, simulationEntries);
      monthForecasts.push(dayForecast);
      simulationEntriesByDay.push({
        date: dayForecast.date,
        monthKey,
        entries: simulationEntries,
      });
      dayCursor.setDate(dayCursor.getDate() + 1);
    }

    adjustMonthlyPatternForecasts(monthForecasts, patterns, monthAdjustments);
    log(`  ↳ Adjusted monthly patterns for ${monthKey}: ${monthForecasts.length} day(s)`);

    dailyForecasts.push(...monthForecasts);
    cursor = new Date(year, month + 1, 1);
  }

  return { dailyForecasts, adjustmentsByMonth, simulationEntriesByDay };
}

// ==================== MAIN EXPORT ====================
async function generateDailyForecast(options = {}) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentDay = now.getDate();

  const cacheDurationMs = Number.isFinite(options.cacheDurationMs)
    ? Math.max(0, Math.floor(Number(options.cacheDurationMs)))
    : DEFAULT_FORECAST_CACHE_TTL_MS;
  const skipCache =
    cacheDurationMs === 0 ||
    options.noCache === true ||
    options.noCache === 'true' ||
    options.noCache === '1';

  const includeToday = options.includeToday ?? false;
  const forecastMonths = Number.isFinite(options.forecastMonths) ? options.forecastMonths : 6;
  const monteCarloRuns = Number.isFinite(options.monteCarloRuns)
    ? Math.max(0, Math.floor(Number(options.monteCarloRuns)))
    : DEFAULT_MONTE_CARLO_RUNS;
  const historyMonths = Number.isFinite(options.historyMonths)
    ? Math.max(0, Math.floor(Number(options.historyMonths)))
    : DEFAULT_HISTORY_MONTHS;

  // Treat each call as self-contained; do not rely on previous CONFIG state.
  CONFIG.verbose = !!options.verbose;
  CONFIG.includeToday = includeToday;
  CONFIG.forecastMonths = forecastMonths;
  CONFIG.monteCarloRuns = monteCarloRuns;
  if (options.forecastDays === undefined || options.forecastDays === null || Number.isNaN(options.forecastDays)) {
    CONFIG.forecastDays = null;
  } else {
    const forecastDays = Number(options.forecastDays);
    CONFIG.forecastDays = Number.isFinite(forecastDays) ? Math.max(0, forecastDays) : null;
  }

  const cacheKey = JSON.stringify({
    date: formatDate(now),
    includeToday: CONFIG.includeToday,
    forecastDays: CONFIG.forecastDays,
    forecastMonths: CONFIG.forecastMonths,
    monteCarloRuns: CONFIG.monteCarloRuns,
    historyMonths,
  });

  if (!skipCache) {
    const cached = forecastResultCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }
  }

  const db = openForecastDb();

  try {
    let historySince = null;
    if (historyMonths > 0) {
      const since = new Date(now);
      since.setMonth(since.getMonth() - historyMonths);
      since.setHours(0, 0, 0, 0);
      historySince = formatDate(since);
    }

    let allTransactions = historySince ? getAllTransactions(db, historySince) : getAllTransactions(db);
    if (allTransactions.length === 0 && historySince) {
      allTransactions = getAllTransactions(db);
      historySince = null;
    }
    if (allTransactions.length === 0) throw new Error('No transactions found in database');

    const patterns = analyzeCategoryPatterns(allTransactions);
    const patternEntries = buildPatternCaches(patterns);
    const currentMonthTransactions = allTransactions.filter(txn => txn.month === currentMonth);
    const categoryCount = Object.keys(patterns).length;
    logPatternSummary(patterns);

    const { startDate: forecastStartDate, endDate: forecastEndDate } = resolveForecastWindow(now, {
      includeToday: CONFIG.includeToday,
      forecastDays: CONFIG.forecastDays,
      forecastMonths: CONFIG.forecastMonths,
    });
    if (!CONFIG.includeToday && isLastDayOfMonth(now)) {
      log('ℹ️ Today is the last day of the month; starting forecast from next month.');
    }

    const { dailyForecasts, adjustmentsByMonth, simulationEntriesByDay } = generateForecastAcrossMonths(
      patterns,
      patternEntries,
      db,
      forecastStartDate,
      forecastEndDate,
      now,
      currentMonthTransactions
    );
    const monteCarloResults = runMonteCarloSimulation(dailyForecasts, simulationEntriesByDay, CONFIG.monteCarloRuns);

    let cumulativeCashFlow = 0;
    dailyForecasts.forEach(day => {
      cumulativeCashFlow += day.expectedCashFlow;
      day.cumulativeCashFlow = cumulativeCashFlow;
    });

    const results = {
      generated: new Date().toISOString(),
      analysisInfo: {
        totalTransactions: allTransactions.length,
        firstTransaction: allTransactions[0].date,
        lastTransaction: allTransactions[allTransactions.length - 1].date,
        totalCategories: categoryCount,
        currentMonth,
        currentDay,
        currentMonthTransactions: currentMonthTransactions.length,
        historySince,
      },
      forecastPeriod: {
        start: formatDate(forecastStartDate),
        end: formatDate(forecastEndDate),
        days: dailyForecasts.length,
      },
      dailyForecasts,
      monteCarloResults: {
        worstCase: monteCarloResults.worst,
        baseCase: monteCarloResults.base,
        bestCase: monteCarloResults.best,
        numSimulations: monteCarloResults.numSimulations,
      },
      scenarios: {}, // filled below with cumulative cash flow per scenario
      categoryPatterns: Object.values(patterns).map(p => ({
        category: p.category,
        categoryType: p.categoryType,
        patternType: p.patternType,
        avgAmount: p.avgAmount,
        stdDev: p.stdDev,
        avgOccurrencesPerMonth: p.avgOccurrencesPerMonth,
        mostLikelyDaysOfWeek: p.mostLikelyDaysOfWeek,
        mostLikelyDaysOfMonth: p.mostLikelyDaysOfMonth,
        lastOccurrence: p.lastOccurrence,
        daysSinceLastOccurrence: p.daysSinceLastOccurrence,
      })),
      monthlyAdjustments: adjustmentsByMonth,
    };

  // Derive scenarios with cumulative cash flow (p10/p50/p90) for frontend consumers
function withCumulative(scenario) {
  let cum = 0;
  const dailyWithCum = (scenario.dailyResults || []).map(d => {
    cum += (d.cashFlow || 0);
    return { ...d, cumulativeCashFlow: cum };
  });
  return { ...scenario, dailyResults: dailyWithCum };
}

results.scenarios = {
  p10: withCumulative(monteCarloResults.worst),
  p50: withCumulative(monteCarloResults.base),
  p90: withCumulative(monteCarloResults.best),
};

    if (!skipCache) {
      forecastResultCache.set(cacheKey, { value: results, expiresAt: Date.now() + cacheDurationMs });
    }
    return results;
  } finally {
    db.close();
  }
}

/**
 * Helper: load category definitions once (expense only)
 */
function loadCategoryDefinitions(db) {
  const categoryDefinitionsByName = {};
  const categoryDefinitionsById = {};

  try {
    const categoryQuery = `
      SELECT id, name, name_en, name_fr, icon, color, parent_id
      FROM category_definitions
      WHERE category_type = 'expense'
    `;
    const categories = db.prepare(categoryQuery).all();
    categories.forEach(cat => {
      categoryDefinitionsByName[cat.name] = cat;
      if (cat.name_en) categoryDefinitionsByName[cat.name_en] = cat;
      categoryDefinitionsById[cat.id] = cat;
    });
  } catch (err) {
    console.warn('[Forecast] Could not load category definitions for forecast service:', err.message);
  }

  return { categoryDefinitionsByName, categoryDefinitionsById };
}

/**
 * Build budget outlook using the same logic as the forecast route,
 * so downstream consumers (e.g., quests) get consistent data.
 */
function buildBudgetOutlook(result) {
  const today = new Date();
  const todayStr = formatDate(today);
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthEndStr = formatDate(monthEnd);

  const db = openForecastDb();
  const { categoryDefinitionsByName, categoryDefinitionsById } = loadCategoryDefinitions(db);

  // Actual spend this month by category
  let actualSpendingRows = [];
  try {
    const actualSpendingQuery = `
      SELECT
        cd.id AS category_definition_id,
        cd.name AS category_name,
        cd.name_en AS category_name_en,
        cd.name_fr AS category_name_fr,
        cd.icon AS category_icon,
        cd.color AS category_color,
        cd.parent_id AS parent_category_id,
        SUM(ABS(t.price)) AS spent
      FROM transactions t
      LEFT JOIN category_definitions cd ON t.category_definition_id = cd.id
      LEFT JOIN (SELECT DISTINCT transaction_identifier, transaction_vendor FROM transaction_pairing_exclusions) tpe
        ON t.identifier = tpe.transaction_identifier
        AND t.vendor = tpe.transaction_vendor
      WHERE t.status = 'completed'
        AND t.category_type = 'expense'
        AND tpe.transaction_identifier IS NULL
        AND strftime('%Y-%m', t.date) = ?
      GROUP BY cd.id, cd.name, cd.name_en, cd.name_fr, cd.icon, cd.color, cd.parent_id
    `;
    actualSpendingRows = db.prepare(actualSpendingQuery).all(monthKey);
  } catch (err) {
    console.warn('[Forecast] Could not load actual spending for quests:', err.message);
  }

  // Budgets
  let budgetRows = [];
  try {
    const budgetsQuery = `
      SELECT
        cb.id AS budget_id,
        cb.category_definition_id,
        cb.period_type,
        cb.budget_limit,
        cb.is_active,
        cd.name AS category_name,
        cd.name_en AS category_name_en,
        cd.name_fr AS category_name_fr,
        cd.icon AS category_icon,
        cd.color AS category_color,
        cd.parent_id AS parent_category_id
      FROM category_budgets cb
      JOIN category_definitions cd ON cd.id = cb.category_definition_id
      WHERE cb.is_active = 1
        AND cb.period_type = 'monthly'
    `;
    budgetRows = db.prepare(budgetsQuery).all();
  } catch (err) {
    console.warn('[Forecast] Could not load budgets for quests:', err.message);
  }

  // Forecasted remaining spend by category (p50 baseline) for the rest of this month
  const forecastRemainingByCategory = new Map();
  const makeCategoryKey = (categoryDefinitionId, categoryName) =>
    categoryDefinitionId ? `id:${categoryDefinitionId}` : `name:${categoryName || 'unknown'}`;

  (result.dailyForecasts || [])
    .filter(d => d.date >= todayStr && d.date <= monthEndStr)
    .forEach(day => {
      (day.predictions || [])
        .filter(p => p.categoryType === 'expense')
        .forEach(p => {
          const catDef = categoryDefinitionsByName[p.category] || categoryDefinitionsByName[p.transactionName];
          const catId = catDef?.id || null;
          const catName = catDef?.name || p.category;
          const key = makeCategoryKey(catId, catName);
          const current = forecastRemainingByCategory.get(key) || { amount: 0, categoryDefinitionId: catId, categoryName: catName };
          current.amount += p.probabilityWeightedAmount || 0;
          current.categoryDefinitionId = catId || current.categoryDefinitionId;
          current.categoryName = catName || current.categoryName;
          forecastRemainingByCategory.set(key, current);
        });
    });

  // Scenario ratios to scale p10/p90 relative to p50 totals
  const monthEndExpenses = { p10: 0, p50: 0, p90: 0 };
  (result.scenarios?.p10?.dailyResults || []).filter(d => d.date >= todayStr && d.date <= monthEndStr).forEach(day => { monthEndExpenses.p10 += day.expenses || 0; });
  (result.scenarios?.p50?.dailyResults || []).filter(d => d.date >= todayStr && d.date <= monthEndStr).forEach(day => { monthEndExpenses.p50 += day.expenses || 0; });
  (result.scenarios?.p90?.dailyResults || []).filter(d => d.date >= todayStr && d.date <= monthEndStr).forEach(day => { monthEndExpenses.p90 += day.expenses || 0; });
  const p50ScenarioExpenses = monthEndExpenses.p50 || 0;
  const p10Ratio = p50ScenarioExpenses > 0 ? monthEndExpenses.p10 / p50ScenarioExpenses : 1;
  const p90Ratio = p50ScenarioExpenses > 0 ? monthEndExpenses.p90 / p50ScenarioExpenses : 1;

  // Build per-category aggregates
  const categoryData = new Map();
  const getCategoryEntry = (categoryDefinitionId, categoryName) => {
    const key = makeCategoryKey(categoryDefinitionId, categoryName);
    if (!categoryData.has(key)) {
      const catDef = categoryDefinitionId ? categoryDefinitionsById[categoryDefinitionId] : categoryDefinitionsByName[categoryName];
      categoryData.set(key, {
        key,
        budgetId: null,
        categoryDefinitionId: catDef?.id || categoryDefinitionId || null,
        categoryName: catDef?.name || categoryName || 'Unknown',
        categoryNameEn: catDef?.name_en || categoryName || 'Unknown',
        categoryNameFr: catDef?.name_fr || categoryName || 'Unknown',
        categoryIcon: catDef?.icon || null,
        categoryColor: catDef?.color || null,
        parentCategoryId: catDef?.parent_id ?? null,
        limit: 0,
        actualSpent: 0,
        forecasted: 0,
        projectedTotal: 0,
        utilization: 0,
        status: 'on_track',
        risk: 0,
        alertThreshold: 0.8,
        nextLikelyHitDate: null,
        actions: [],
        scenarios: { p10: 0, p50: 0, p90: 0 }
      });
    }
    return categoryData.get(key);
  };

  // Apply actual spending
  actualSpendingRows.forEach(row => {
    const spent = Math.round(row.spent || 0);
    if (!spent) return;
    const entry = getCategoryEntry(row.category_definition_id, row.category_name);
    entry.actualSpent += spent;
    if (row.parent_category_id && !entry.parentCategoryId) {
      entry.parentCategoryId = row.parent_category_id;
    }
    entry.categoryNameEn = entry.categoryNameEn || row.category_name_en || entry.categoryName;
    entry.categoryNameFr = entry.categoryNameFr || row.category_name_fr || entry.categoryName;
    entry.categoryIcon = entry.categoryIcon || row.category_icon || null;
    entry.categoryColor = entry.categoryColor || row.category_color || null;
  });

  // Apply budgets
  budgetRows.forEach(row => {
    const limit = Number.parseFloat(row.budget_limit);
    if (!Number.isFinite(limit) || limit <= 0) return;
    const entry = getCategoryEntry(row.category_definition_id, row.category_name);
    entry.limit = limit;
    entry.budgetId = row.budget_id || null;
    if (row.parent_category_id && !entry.parentCategoryId) {
      entry.parentCategoryId = row.parent_category_id;
    }
    entry.categoryNameEn = entry.categoryNameEn || row.category_name_en || entry.categoryName;
    entry.categoryNameFr = entry.categoryNameFr || row.category_name_fr || entry.categoryName;
    entry.categoryIcon = entry.categoryIcon || row.category_icon || null;
    entry.categoryColor = entry.categoryColor || row.category_color || null;
  });

  // Apply forecasted remaining spend
  forecastRemainingByCategory.forEach(forecast => {
    const entry = getCategoryEntry(forecast.categoryDefinitionId, forecast.categoryName);
    entry.forecasted += Math.round(forecast.amount || 0);
  });

  // Derive scenarios and status
  categoryData.forEach(entry => {
    const p50Remaining = entry.forecasted;
    const p10Remaining = Math.round(p50Remaining * p10Ratio);
    const p90Remaining = Math.round(p50Remaining * p90Ratio);

    entry.scenarios = {
      p10: entry.actualSpent + p10Remaining,
      p50: entry.actualSpent + p50Remaining,
      p90: entry.actualSpent + p90Remaining
    };

    entry.projectedTotal = entry.scenarios.p50;
    if (entry.limit > 0) {
      const projectedUtilization = entry.projectedTotal / entry.limit;
      const actualUtilization = entry.actualSpent / entry.limit;

      if (entry.actualSpent >= entry.limit) {
        entry.status = 'exceeded';
        entry.risk = 1;
      } else if (projectedUtilization >= 1 || projectedUtilization >= 0.9 || actualUtilization >= 0.9) {
        entry.status = 'at_risk';
        entry.risk = Math.min(1, projectedUtilization);
      } else if (projectedUtilization >= 0.75) {
        entry.status = 'at_risk';
        entry.risk = Math.max(entry.risk, projectedUtilization);
      } else {
        entry.status = 'on_track';
        entry.risk = Math.max(entry.risk, projectedUtilization * 0.5);
      }

      entry.utilization = projectedUtilization * 100;
    } else {
      const p50Total = entry.scenarios.p50;
      const p90Total = entry.scenarios.p90;
      const p10Total = entry.scenarios.p10;

      if (entry.actualSpent > p90Total && p90Total > 0) {
        entry.status = 'exceeded';
        entry.risk = 1;
      } else if (entry.actualSpent > p50Total) {
        entry.status = 'at_risk';
        entry.risk = 0.7;
      } else if (entry.actualSpent > p10Total) {
        entry.status = 'at_risk';
        entry.risk = 0.4;
      } else {
        entry.status = 'on_track';
        entry.risk = 0.2;
      }

      entry.utilization = p50Total > 0 ? (entry.actualSpent / p50Total) * 100 : 0;
    }
  });

  const budgetOutlook = Array.from(categoryData.values()).filter(entry =>
    entry.limit > 0 || entry.actualSpent > 0 || entry.forecasted > 0
  );

  const budgetSummary = {
    totalBudgets: budgetOutlook.length,
    highRisk: budgetOutlook.filter(b => b.status === 'at_risk').length,
    exceeded: budgetOutlook.filter(b => b.status === 'exceeded').length,
    totalProjectedOverrun: budgetOutlook.reduce((sum, b) => {
      if (b.limit > 0) {
        return sum + Math.max(0, b.projectedTotal - b.limit);
      }
      return sum;
    }, 0)
  };

  db.close();
  return { budgetOutlook, budgetSummary, categoryDefinitionsByName, categoryDefinitionsById };
}

/**
 * Provide a richer forecast bundle for analytics/quests consumers
 */
async function getForecast(options = {}) {
  const result = await generateDailyForecast(options);
  const { budgetOutlook, budgetSummary, categoryDefinitionsByName } = buildBudgetOutlook(result);

  // Enrich patterns with category IDs and names
  const patterns = (result.categoryPatterns || []).map(p => {
    const catDef = categoryDefinitionsByName[p.category];
    const confidence = Number.isFinite(p.confidence) ? p.confidence : 0.6;
    const monthsOfHistory = Number.isFinite(p.monthsOfHistory) ? p.monthsOfHistory : 1;
    const isLikelyFixedRecurring =
      (p.patternType === 'monthly' || p.patternType === 'bi-monthly') &&
      p.isFixedAmount &&
      (p.avgOccurrencesPerMonth || 0) >= 0.8;
    const fixedDayOfMonth = Array.isArray(p.mostLikelyDaysOfMonth) && p.mostLikelyDaysOfMonth.length > 0
      ? p.mostLikelyDaysOfMonth[0].day
      : null;
    return {
      category: p.category,
      categoryDefinitionId: catDef?.id || null,
      categoryName: catDef?.name || p.category,
      categoryNameEn: catDef?.name_en || p.category,
      categoryNameFr: catDef?.name_fr || p.category,
      patternType: p.patternType,
      avgAmount: p.avgAmount,
      stdDev: p.stdDev,
      avgOccurrencesPerMonth: p.avgOccurrencesPerMonth,
      avgOccurrencesPerWeek: p.avgOccurrencesPerWeek,
      minAmount: p.minAmount,
      maxAmount: p.maxAmount,
      coefficientOfVariation: p.coefficientOfVariation,
      isFixedAmount: p.isFixedAmount,
      mostLikelyDaysOfWeek: p.mostLikelyDaysOfWeek,
      mostLikelyDaysOfMonth: p.mostLikelyDaysOfMonth,
      lastOccurrence: p.lastOccurrence,
      daysSinceLastOccurrence: p.daysSinceLastOccurrence,
      confidence,
      monthsOfHistory,
      isFixedRecurring: isLikelyFixedRecurring,
      fixedAmount: isLikelyFixedRecurring ? p.avgAmount : null,
      fixedDayOfMonth,
    };
  });

  return {
    ...result,
    budgetOutlook,
    budgetSummary,
    patterns,
    forecastByCategory: new Map(),
  };
}

module.exports = {
  generateDailyForecast,
  getForecast,
  __setDatabaseCtor(mockCtor) {
    databaseCtor = mockCtor || Database;
  },
  __resetDatabaseCtor() {
    databaseCtor = Database;
  },
  _internal: {
    analyzeCategoryPatterns,
    adjustProbabilitiesForCurrentMonth,
    adjustMonthlyPatternForecasts,
    buildBudgetOutlook,
    buildChosenMonthlyOccurrenceDateByMonth,
    buildPatternCaches,
    calculateDayProbability,
    formatDate,
    generateForecastAcrossMonths,
    forecastDay,
    getAllTransactions,
    getCurrentMonthTransactions,
    getDayName,
    getDaysInMonth,
    getProbabilityThreshold,
    isLastDayOfMonth,
    loadCategoryDefinitions,
    logPatternSummary,
    mean,
    openForecastDb,
    parseLocalDate,
    parsePositiveInt,
    resolveForecastDbPath,
    resolveForecastWindow,
    runMonteCarloSimulation,
    sampleAmount,
    simulateScenario,
    standardDeviation,
    willOccur,
  },
};
